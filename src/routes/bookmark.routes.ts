import * as orm from "drizzle-orm";
import { BOOKMARK_FILTERS } from "@/constants";
import { collabFolder } from "@/db/schema/collab-folder.schema";
import { folder } from "@/db/schema/folder.schema";
import { throwError } from "@/errors/handlers";
import {
  addBookmarksToFolder,
  createBookmark,
  deleteBookmarkById,
  deleteBookmarkInBulk,
  getBookmarkById,
  getBookmarkByTagId,
  getBookmarks,
  getBookmarksByFolderId,
  getBookmarkUrls,
  getTotalBookmarksCount,
  tooggleBookmarkFlag,
  updateBookmark,
  updateBookmarkThumbnail,
} from "@/openapi/routes/bookmark";
import type { LinkPreviewResponsse } from "@/types/link-preview.types";
import { getImageMedatata, type Metadata } from "@/utils/image-metadata";
import { fetchLinkPreview } from "@/utils/link-preview";
import { deleteImageFromBucket, storeImageToBucket } from "@/utils/minio";
import { generatePublicId } from "@/utils/nanoid";
import { getCleanUrl } from "@/utils/parse-url";
import { db } from "../db";
import { bookmark, bookmarkSelectSchema } from "../db/schema/bookmark.schema";
import { bookmarkTag } from "../db/schema/bookmark-tag.schema";
import { tag } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import { type BookmarkType, bookmarkFlags } from "../types/schema.types";
import { getOrderDirection, getPagination, getUserId, pick } from "../utils";
import { getFolder as getFolderInfo } from "./folder.routes";

const router = createRouter();
const BUCKET = "thumbnails";

const getFavIcon = (url: string) => {
  return `https://www.google.com/s2/favicons?domain=${url}&sz=128`;
};

const authorizeAndFetchFolderId = async (
  folderId: string | undefined,
  userId: string,
) => {
  // Allow user if folderId not found, means user can add bookmark
  if (!folderId) return;

  const folderInfo = await getFolderInfo(folderId, userId);
  const role = folderInfo?.permissionLevel;

  if (role != null && !["admin", "editor"].includes(role ?? "")) {
    throwError(
      "UNAUTHORIZED",
      "Action not permitted: You do not have the necessary permissions",
      "",
    );
  }

  return folderInfo?.id;
};

const getFilterCondition = (
  query: Record<string, string | undefined>,
): orm.SQL<unknown> => {
  const flags = BOOKMARK_FILTERS;

  if (query?.filter && !flags.includes(query?.filter)) {
    throwError(
      "INVALID_PARAMETER",
      `Invalid flag, expected [ ${flags.join(" | ")} ] but got ${query?.filter}`,
      "bookmarks.get",
    );
  }

  let condition: orm.SQL<unknown> = orm.isNotNull(bookmark.id);

  switch (query?.filter) {
    case "pinned":
      condition = orm.eq(bookmark.isPinned, true);
      break;
    case "archived":
      condition = orm.eq(bookmark.isArchived, true);
      break;
    case "favorites":
      condition = orm.eq(bookmark.isFavourite, true);
      break;
    case "encrypted":
      condition = orm.eq(bookmark.isEncrypted, true);
      break;
  }

  // Encrypted
  return condition;
};

const getTagIds = async (
  userId: string,
  tagPublicIds: string[] | undefined,
): Promise<number[] | undefined> => {
  if (!tagPublicIds) return undefined;

  const tags = await db.query.tag.findMany({
    where: orm.and(
      orm.eq(bookmark.userId, userId),
      orm.inArray(tag.publicId, tagPublicIds),
    ),
    columns: { id: true },
  });

  if (tags.length === 0) {
    throwError("NOT_FOUND", "No tags found", "bookmarks.tags.get");
  }

  return tags.map(({ id }) => id);
};

const insertTags = async (
  userId: string,
  bookmarkId: number | undefined,
  tags: number[] | undefined,
): Promise<boolean> => {
  let tagsInserted = false;
  if (bookmarkId && tags && tags.length > 0) {
    const response = await db
      .insert(bookmarkTag)
      .values(tags.map((tagId) => ({ userId, tagId, bookmarkId })))
      .onConflictDoNothing()
      .returning({ bookmarkId: bookmarkTag.bookmarkId });

    if (response.length > 0 && response[0] != null) {
      tagsInserted = true;
    }
  }
  return tagsInserted;
};

// Check if user is authorized by permissionLevel and userId match allowed
// to delete bookmark or not
async function verifyUserAccessByBookmark(
  publicId: string,
  userId: string,
  isReadAllowed = false,
) {
  const selectedBookmark = await db.query.bookmark.findFirst({
    where: orm.eq(bookmark.publicId, publicId),
    columns: { id: true, userId: true },
  });

  if (!selectedBookmark?.id) {
    throwError("NOT_FOUND", `Bookmark with id ${publicId} not found`, "");
  }

  const collabFolderCheck = orm.and(
    orm.eq(collabFolder.folderId, bookmark.folderId),
    orm.eq(collabFolder.sharedWithUserId, userId),
  );

  const response = await db
    .select({ id: bookmark.id, permissionLevel: collabFolder.permissionLevel })
    .from(bookmark)
    .leftJoin(collabFolder, collabFolderCheck)
    .where(orm.eq(bookmark.id, selectedBookmark.id));

  if (!response[0]?.id) {
    throwError("NOT_FOUND", `Bookmark with id ${publicId} not found`, "");
  }

  const role = response[0]?.permissionLevel;

  const roles = ["editor", "admin"];

  if (isReadAllowed) roles.push("viewer");

  if (role == null && selectedBookmark.userId !== userId) {
    throwError("NOT_FOUND", `Bookmark with id ${publicId} not found`, "");
  }

  if (role !== null && !roles.includes(role ?? "")) {
    throwError("UNAUTHORIZED", "Action not permitted", "");
  }
}

const bookmarkJoins = {
  bookmarkFolder: {
    columns: { publicId: true },
  },
  bookmarkTag: {
    columns: { appliedAt: true },
    with: {
      tag: {
        columns: {
          publicId: true,
          name: true,
          color: true,
        },
      },
    },
  },
} satisfies NonNullable<
  Parameters<(typeof db)["query"]["bookmark"]["findFirst" | "findMany"]>[0]
>["with"];

// Fields that should be selected and allowed to be returned as public values
export const bookmarkPublicFields = {
  id: bookmark.publicId,
  ...pick(bookmark, [
    "title",
    "description",
    "url",
    "faviconUrl",
    "thumbnail",
    "thumbnailHeight",
    "thumbnailWidth",
    "isPinned",
    "isEncrypted",
    "nonce",
    "isFavourite",
    "isArchived",
    "createdAt",
    "updatedAt",
  ]),
};

// -----------------------------------------
// ADD NEW BOOKMARK
// -----------------------------------------
router.openapi(createBookmark, async (c) => {
  const source = "bookmarks.post";

  const {
    folderId,
    title,
    description,
    thumbnail,
    faviconUrl,
    url,
    tags,
    isEncrypted,
    nonce,
  } = c.req.valid("json");

  if (!isEncrypted && !url) {
    throwError("INVALID_PARAMETER", "Url is required", "bookmarks.post");
  }

  const userId = await getUserId(c);
  const folderInfo = await getFolderInfo(folderId, userId);

  if (
    folderInfo?.permissionLevel != null &&
    !["admin", "editor"].includes(folderInfo?.permissionLevel ?? "")
  ) {
    throwError(
      "UNAUTHORIZED",
      "Action not permitted: You do not have the necessary permissions",
      source,
    );
  }

  // NOTE: Whole thing is not very robust, db.transaction is better choice
  // but that doesn't work with neon-http, also db.batch which is not
  // very ideal for this situation since I need bookmarkId
  let siteMeta: LinkPreviewResponsse | undefined;

  if (!isEncrypted) {
    siteMeta = await fetchLinkPreview(url);

    if (!siteMeta.data) {
      console.error(
        `Failed to fetch metadata of url ${url}`,
        siteMeta.message || "",
      );
    }
  }

  const image = siteMeta?.data?.images?.[0];
  let imageMeta: Metadata | null = null;

  if (image && image.trim() !== "") {
    imageMeta = await getImageMedatata(image);
  }

  const payload = isEncrypted
    ? {
        title: title || "Untitled",
        description,
        url,
        thumbnail,
        faviconUrl,
        isEncrypted: true,
        nonce,
      }
    : {
        title: title || siteMeta?.data?.title || "Untitled",
        description: description || siteMeta?.data?.description,
        url,
        thumbnail: siteMeta?.data?.images?.[0],
        faviconUrl: siteMeta?.data?.favicons?.[0] ?? getFavIcon(url),
        thumbnailHeight: imageMeta?.height,
        thumbnailWidth: imageMeta?.width,
      };

  // Get the owner of folder, required when another user adding bookmark
  // as member of folder
  let ownerUserId = userId;

  // permissionLevel null assumes folder is not a collaborative folder
  if (folderInfo?.permissionLevel !== null) {
    const selectedFolder = await db.query.folder.findFirst({
      where: orm.eq(folder.id, folderInfo!.id),
      columns: { userId: true },
    });

    if (selectedFolder) {
      ownerUserId = selectedFolder.userId;
    }
  }

  const data: (Omit<BookmarkType, "id" | "folderId"> & { id: number })[] =
    await db
      .insert(bookmark)
      .values({
        publicId: generatePublicId(),
        folderId: folderInfo?.id,
        userId: ownerUserId,
        ...payload,
      })
      .returning();

  if (data.length === 0 || typeof data[0] === "undefined") {
    throwError("INTERNAL_ERROR", "Failed to add bookmark", source);
  }

  const bookmarkId = data[0].id;

  // Insert tags if given
  let tagsInserted = false;

  if (tags && tags.length > 0) {
    const tagIds = await getTagIds(
      userId,
      tags?.map((tag) => tag.id),
    );
    tagsInserted = await insertTags(userId, bookmarkId, tagIds);
  }

  const { publicId, ...rest } = data[0];

  return c.json(
    {
      success: true,
      message: "Bookmark added successfully 🔖",
      data: bookmarkSelectSchema.parse({
        ...rest,
        id: publicId,
        folderId,
        ...(tagsInserted ? { tags } : {}),
      }),
    },
    200,
  );
});

// -----------------------------------------
// GET TOTAL BOOKMARKS COUNT
// -----------------------------------------
// FIX: Maybe include collaborative folder's bookmarks
router.openapi(getTotalBookmarksCount, async (c) => {
  const condition = getFilterCondition(c.req.query());
  const userId = await getUserId(c);

  const data = await db
    .select({ count: orm.count() })
    .from(bookmark)
    .where(orm.and(orm.eq(bookmark.userId, userId), condition));

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "No bookmarks found", "bookmarks.get");
  }

  return c.json(
    {
      success: true,
      data: { total: data[0].count },
      message: "Successfully fetched total bookmarks count",
    },
    200,
  );
});

// -----------------------------------------
// GET ALL BOOKMARK URLS
// -----------------------------------------
router.openapi(getBookmarkUrls, async (c) => {
  const folderPublicId = c.req.query("folderId");
  const successMessage = "Successfully fetched urls";
  const errorMessage = "Failed to fetch urls";
  const source = "bookmarks.get";
  const userId = await getUserId(c);

  if (folderPublicId) {
    const folderInfo = await getFolderInfo(folderPublicId, userId);

    if (folderInfo?.id) {
      const bookmarks = await db.query.bookmark.findMany({
        where: orm.eq(bookmark.folderId, folderInfo.id),
        columns: { url: true },
      });

      if (!bookmarks || bookmarks.length === 0) {
        throwError("INTERNAL_ERROR", errorMessage, source);
      }

      return c.json(
        {
          success: true,
          data: { urls: bookmarks.map((b) => b.url) },
          message: successMessage,
        },
        200,
      );
    }

    throwError("INTERNAL_ERROR", errorMessage, source);
  }

  const bookmarks = await db.query.bookmark.findMany({
    where: orm.eq(bookmark.userId, userId),
    columns: { url: true },
  });

  if (!bookmarks || bookmarks.length === 0) {
    throwError("INTERNAL_ERROR", errorMessage, source);
  }

  return c.json(
    {
      success: true,
      data: { urls: bookmarks.map((b) => b.url) },
      message: successMessage,
    },
    200,
  );
});

// -----------------------------------------
// GET ALL BOOKMARKS OR QUERY BY PARAM
// -----------------------------------------
// FIX: Maybe include collaborative folder's bookmarks
router.openapi(getBookmarks, async (c) => {
  const source = "bookmarks.get";
  const userId = await getUserId(c);

  // Fetch bookmarks by url if query param given
  // const queryUrl = c.req.query("url");
  // if (queryUrl && queryUrl.trim() !== "") {
  //   const data = await db.query.bookmark.findFirst({
  //     where: orm.and(
  //       orm.eq(bookmark.userId, userId),
  //       orm.ilike(bookmark.url, `%${queryUrl}%`),
  //     ),
  //     with: bookmarkJoins,
  //   });
  //
  //   if (!data) {
  //     const errMsg = `Bookmark with url "${queryUrl}" not found`;
  //     throwError("NOT_FOUND", errMsg, source);
  //   }
  //
  //   const tags = data.bookmarkTag.map(({ appliedAt, tag }) => ({
  //     ...tag,
  //     appliedAt,
  //   }));
  //
  //   const updatedData = {
  //     ...data,
  //     tags,
  //   };
  //
  //   const { bookmarkFolder, publicId, ...rest } = updatedData;
  //
  //   return c.json<SuccessResponse<BookmarkType>>(
  //     {
  //       success: true,
  //       data: {
  //         ...rest,
  //         id: publicId,
  //         folderId: bookmarkFolder?.publicId,
  //         tags: rest.tags.map((tag) => ({ ...tag, id: tag.publicId })),
  //       },
  //       message: `Successfully fetched bookmark with url ${queryUrl}`,
  //     },
  //     200,
  //   );
  // }

  // Fetch all bookmarks with pagination if `url` param not found
  const condition = getFilterCondition(c.req.query());
  const orderBy = getOrderDirection(c.req.query(), "bookmarks.get");

  // Gets pagination query parameters
  const { page, limit, offset } = getPagination(c.req.query());

  const data = await db.query.bookmark.findMany({
    with: bookmarkJoins,
    where: orm.and(
      orm.eq(bookmark.userId, userId),
      orm.eq(bookmark.isEncrypted, false),
      condition,
    ),
    orderBy: () => {
      if (orderBy) {
        return orderBy === "desc"
          ? orm.desc(bookmark.updatedAt)
          : orm.asc(bookmark.updatedAt);
      }

      return orm.desc(bookmark.updatedAt);
    },
    columns: { userId: false },
    limit,
    offset,
  });

  if (data.length === 0) {
    throwError("NOT_FOUND", "No bookmarks found", source);
  }

  return c.json(
    {
      success: true,
      message: "Successfully fetched all bookmarks",
      data: data.map(({ publicId, bookmarkFolder, bookmarkTag, ...rest }) => ({
        ...rest,
        id: publicId,
        folderId: bookmarkFolder?.publicId,
        tags: bookmarkTag.map(({ tag, appliedAt }) => ({
          ...tag,
          id: tag.publicId,
          appliedAt,
        })),
      })) as BookmarkType[],
      pagination: {
        page,
        limit,
        total: data.length,
        hasMore: data.length === limit,
      },
    },
    200,
  );
});

// -----------------------------------------
// GET BOOKMARKS BY TAG PUBLIC ID
// -----------------------------------------
// FIX: Maybe include collaborative folder's bookmarks
router.openapi(getBookmarkByTagId, async (c) => {
  const userId = await getUserId(c);
  const publicId = c.req.param("publicId");

  if (!publicId || publicId.trim() === "") {
    throwError("INVALID_PARAMETER", "Invalid tag id", "bookmark.get");
  }

  const tagData = await db.query.tag.findFirst({
    where: orm.and(orm.eq(tag.userId, userId), orm.eq(tag.publicId, publicId)),
    columns: {
      id: true,
    },
  });

  if (!tagData) {
    throwError(
      "NOT_FOUND",
      `Tag with tagname ${publicId} not found`,
      "bookmarks.tags.get",
    );
  }

  const { page, limit, offset } = getPagination(c.req.query());

  const isPinned = c.req.query("isPinned");

  const data = await db
    .select({ ...bookmarkPublicFields, folderId: folder.publicId })
    .from(bookmark)
    .leftJoin(bookmarkTag, orm.eq(bookmark.id, bookmarkTag.bookmarkId))
    .leftJoin(tag, orm.eq(bookmarkTag.tagId, tag.id))
    .rightJoin(folder, orm.eq(folder.id, bookmark.folderId))
    .where(
      orm.and(
        orm.eq(bookmark.isArchived, false),
        orm.eq(tag.publicId, publicId),
        typeof isPinned === "undefined"
          ? undefined
          : orm.eq(bookmark.isPinned, isPinned === "true"),
      ),
    )
    .offset(offset)
    .limit(limit)
    .execute();

  if (!data || data.length === 0) {
    throwError(
      "NOT_FOUND",
      `No bookmarks associated with tag ${publicId}`,
      "bookmarks.get",
    );
  }

  return c.json(
    {
      success: true,
      data: data as BookmarkType[],
      message: "Successfully fetched bookmarks",
      pagination: {
        page,
        limit,
        total: data.length,
        hasMore: data.length === limit,
      },
    },
    200,
  );
});

// -----------------------------------------
// GET BOOKMARKS BY FOLDER ID
// -----------------------------------------
router.openapi(getBookmarksByFolderId, async (c) => {
  const source = "bookmarks.get";
  const folderId = c.req.param("id");
  const userId = await getUserId(c);

  if (!folderId || folderId.trim() === "") {
    throwError("INVALID_PARAMETER", "Invalid folder name", "bookmarks.get");
  }

  let condition: orm.SQL<unknown> | undefined;
  switch (folderId.toLowerCase().trim()) {
    case "pinned":
      condition = orm.eq(bookmark.isPinned, true);
      break;
    case "archived":
      condition = orm.eq(bookmark.isArchived, true);
      break;
    case "favorites":
      condition = orm.eq(bookmark.isFavourite, true);
      break;
    case "unsorted":
      condition = orm.isNull(bookmark.folderId);
      break;
    default: {
      const folderRowId = (await getFolderInfo(folderId, userId))?.id;

      if (!folderRowId) {
        throwError("NOT_FOUND", `Folder with id ${folderId} not found`, source);
      }

      const filterFlag = c.req.query("filter");

      condition = orm.and(
        orm.eq(bookmark.folderId, folderRowId),
        ...(filterFlag !== "" && filterFlag !== "archived"
          ? [getFilterCondition(c.req.query())]
          : [
              orm.eq(bookmark.isEncrypted, false),
              orm.eq(bookmark.isArchived, false),
              orm.eq(bookmark.isPinned, false),
            ]),
      );
    }
  }

  const { page, limit, offset } = getPagination(c.req.query());

  // Add optional bookmark query by title or url
  const bookmarkQuery = c.req.query("query");

  let queryCondition: orm.SQL<unknown> | undefined;

  if (bookmarkQuery && bookmarkQuery.trim() !== "") {
    queryCondition = orm.or(
      orm.ilike(bookmark.title, `%${bookmarkQuery}%`),
      orm.ilike(bookmark.url, `%${bookmarkQuery}%`),
    );
  }

  const orderBy = getOrderDirection(c.req.query(), "folders.get");

  // If folder type is bookmark flag type include user_id check else omit
  const isUserCondition = [
    "pinned",
    "archived",
    "favorites",
    "unsorted",
  ].includes(folderId.toLowerCase().trim())
    ? orm.eq(folder.userId, userId)
    : undefined;

  const data = await db.query.bookmark.findMany({
    where: orm.and(isUserCondition, condition, queryCondition),
    with: bookmarkJoins,
    orderBy: ({ updatedAt }, { desc, asc }) => {
      if (orderBy) {
        return orderBy === "desc" ? desc(updatedAt) : asc(updatedAt);
      }

      return desc(updatedAt);
    },
    limit,
    offset,
  });

  if (data.length === 0) {
    throwError("NOT_FOUND", "No bookmarks exists in the folder", source);
  }

  return c.json(
    {
      success: true,
      message: "Successfully fetched all bookmarks",
      data: data.map(({ publicId, bookmarkFolder, bookmarkTag, ...rest }) => ({
        ...rest,
        id: publicId,
        folderId: bookmarkFolder?.publicId,
        tags: bookmarkTag.map(({ tag, appliedAt }) => ({
          ...tag,
          id: tag.publicId,
          appliedAt,
        })),
      })),
      pagination: {
        page,
        limit,
        total: data.length,
        hasMore: data.length === limit,
      },
    },
    200,
  );
});

// -----------------------------------------
// GET BOOKMARK BY ID
// -----------------------------------------
router.openapi(getBookmarkById, async (c) => {
  const source = "bookmarks.get";
  const userId = await getUserId(c);

  const bookmarkPublicId = c.req.param("id");

  if (!bookmarkPublicId) {
    throwError("MISSING_PARAMETER", "Bookmark ID is required", source);
  }

  await verifyUserAccessByBookmark(bookmarkPublicId, userId, true);

  const data = await db.query.bookmark.findFirst({
    where: orm.eq(bookmark.publicId, bookmarkPublicId),
    with: bookmarkJoins,
  });

  if (!data) {
    throwError(
      "NOT_FOUND",
      `Bookmark with ${bookmarkPublicId} not found`,
      source,
    );
  }

  const tags = data.bookmarkTag.map(({ appliedAt, tag }) => ({
    ...tag,
    appliedAt,
  }));

  const updatedData = {
    ...data,
    tags,
  };

  const { bookmarkFolder, publicId, ...rest } = updatedData;

  return c.json(
    {
      success: true,
      data: {
        ...rest,
        id: publicId,
        folderId: bookmarkFolder?.publicId,
        tags: rest.tags.map((tag) => ({ ...tag, id: tag.publicId })),
      },
      message: "Successfully fetched bookmark",
    },
    200,
  );
});

// -----------------------------------------
// UPDATE BOOKMARK
// -----------------------------------------
router.openapi(updateBookmark, async (c) => {
  const source = "bookmarks.put";
  const userId = await getUserId(c);
  const publicId = c.req.param("id");

  await verifyUserAccessByBookmark(publicId, userId);

  // Get previous bookmark id and url
  const prev = await db.query.bookmark.findFirst({
    where: orm.eq(bookmark.publicId, publicId),
    columns: { id: true, url: true },
  });

  if (!prev) {
    throwError("NOT_FOUND", "Bookmark not found", source);
  }

  const {
    folderId,
    title,
    url,
    description,
    tags,
    isEncrypted,
    thumbnail,
    faviconUrl,
    nonce,
  } = c.req.valid("json");

  const folderRowId = await authorizeAndFetchFolderId(folderId, userId);

  let siteMeta: LinkPreviewResponsse | undefined;

  // If current and prev.url same don't fetch site's metadata
  if (getCleanUrl(prev.url) !== getCleanUrl(url)) {
    siteMeta = await fetchLinkPreview(url);

    if (!siteMeta?.data) {
      console.error(
        `Failed to fetch metadata of url ${url}`,
        siteMeta?.message || "",
      );
    }
  }

  const image = siteMeta?.data?.images?.[0] || undefined;
  let imageMeta: Metadata | null = null;

  // Fetch image's metadata
  if (image && image.trim() !== "") {
    imageMeta = await getImageMedatata(image);
  }

  const newThumbnail = siteMeta?.data?.images?.[0];

  const payload = isEncrypted
    ? {
        folderId: folderRowId,
        title,
        description,
        url,
        faviconUrl,
        thumbnail,
        nonce,
        updatedAt: orm.sql`NOW()`,
      }
    : {
        folderId: folderRowId,
        title: title ?? (siteMeta?.data?.title || "Untitled"),
        description: description ?? (siteMeta?.data?.description || ""),
        url,
        faviconUrl:
          faviconUrl || (siteMeta?.data?.favicons?.[0] ?? getFavIcon(url)),
        updatedAt: orm.sql`NOW()`,
        thumbnailHeight: imageMeta?.height,
        thumbnailWidth: imageMeta?.width,
        ...(newThumbnail ? { thumbnail: newThumbnail } : {}),
      };

  const data: Omit<BookmarkType, "folderId">[] = await db
    .update(bookmark)
    .set(payload)
    .where(orm.eq(bookmark.id, prev.id))
    .returning(bookmarkPublicFields);

  if (data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to update bookmark", source);
  }

  // Insert tags if found
  let tagsInserted = false;

  if (tags && tags.length > 0) {
    const tagIds = await getTagIds(
      userId,
      tags?.map((tag) => tag.id),
    );
    tagsInserted = await insertTags(userId, prev.id, tagIds);
  }

  return c.json(
    {
      success: true,
      message: "Bookmark updated successfully 🔖",
      data: {
        ...data[0],
        folderId: folderId,
        ...(tagsInserted ? { tags } : {}),
      },
    },
    200,
  );
});

// -----------------------------------------
// DELETE BOOKMARKS IN BULK
// -----------------------------------------
router.openapi(deleteBookmarkInBulk, async (c) => {
  const source = "bookmarks.delete";
  const userId = await getUserId(c);
  const { bookmarkIds } = await c.req.json();

  await verifyUserAccessByBookmark(bookmarkIds[0], userId);

  if (!bookmarkIds || bookmarkIds.length === 0) {
    throwError("MISSING_PARAMETER", "Bookmark IDs are required", source);
  }

  // Remove bookmark from database
  const data = await db
    .delete(bookmark)
    .where(orm.inArray(bookmark.publicId, bookmarkIds))
    .returning({ deletedBookmarkId: bookmark.publicId });

  if (data.length === 0) {
    throwError("INTERNAL_ERROR", "Failed to delete bookmark", source);
  }

  return c.json(
    {
      success: true,
      data: data.map((item) => item.deletedBookmarkId),
      message: "Successfully deleted selected bookmarks",
    },
    200,
  );
});

// -----------------------------------------
// DELETE BOOKMARK
// -----------------------------------------
router.openapi(deleteBookmarkById, async (c) => {
  const source = "bookmarks.delete";
  const userId = await getUserId(c);

  await verifyUserAccessByBookmark(c.req.param("id"), userId);

  // Remove bookmark from database
  const data: { deletedBookmarkId: string }[] = await db
    .delete(bookmark)
    .where(orm.eq(bookmark.publicId, c.req.param("id")))
    .returning({ deletedBookmarkId: bookmark.publicId });

  if (data.length === 0) {
    throwError("INTERNAL_ERROR", "Failed to delete bookmark", source);
  }

  return c.json(
    {
      success: true,
      data: null,
      message: "Successfully deleted bookmark 🔖",
    },
    200,
  );
});

// -----------------------------------------
// UPDATE BOOKMARK THUMBNAIL
// -----------------------------------------
router.openapi(updateBookmarkThumbnail, async (c) => {
  const source = "bookmarks.patch";
  const userId = await getUserId(c);

  const publicId = c.req.param("id");
  await verifyUserAccessByBookmark(publicId, userId);

  // Verify if thumbnail path provided
  const body = await c.req.parseBody();

  const localThumbnailUrl = body["path"];

  if (!localThumbnailUrl || !(localThumbnailUrl instanceof File)) {
    throwError("REQUIRED_FIELD", "Thumbnail image file is required", source);
  }

  // Upload thumbnail on imagekit
  const thumbnail = await storeImageToBucket({
    origin: "local",
    fileUri: localThumbnailUrl,
    bucket: BUCKET,
  });

  if (!thumbnail || !thumbnail.fileId) {
    throwError(
      "THIRD_PARTY_SERVICE_FAILED",
      "Failed to update thumbnail",
      source,
    );
  }

  // Get previous thumbnail url before updating
  const prevThumbnail = await db.query.bookmark.findFirst({
    where: orm.eq(bookmark.publicId, publicId),
    columns: {
      thumbnail: true,
    },
  });

  // Update thumbnail
  const data: { thumbnail: string | null }[] = await db
    .update(bookmark)
    .set({
      thumbnail: thumbnail.fileId,
      updatedAt: orm.sql`NOW()`,
    })
    .where(orm.eq(bookmark.publicId, publicId))
    .returning({
      thumbnail: bookmark.thumbnail,
    });

  if (data.length === 0 || data[0] == null || data[0]?.thumbnail == null) {
    throwError(
      "THIRD_PARTY_SERVICE_FAILED",
      "Failed to update thumbnail",
      "bookmarks.patch",
    );
  }

  // Delete & purge old thumbnail
  if (prevThumbnail?.thumbnail) {
    await deleteImageFromBucket(BUCKET, prevThumbnail.thumbnail);
  }

  return c.json(
    {
      success: true,
      message: "Successfully updated thumbnail",
      data: {
        thumbnail: data[0]?.thumbnail ?? "https://placehold.co/1280x698",
      },
    },
    200,
  );
});

// -----------------------------------------
// ADD BOOKMARKS TO A FOLDER IN BULK
// -----------------------------------------
router.openapi(addBookmarksToFolder, async (c) => {
  const source = "bookmarks.patch";
  const folderId = c.req.param("folderId");

  if (!folderId) {
    throwError("MISSING_PARAMETER", "folderId  required", "bookmarks.patch");
  }

  const { bookmarkIds } = c.req.valid("json");

  if (bookmarkIds.length === 0) {
    throwError(
      "INVALID_PARAMETER",
      "Atleast one bookmarkId is required",
      source,
    );
  }

  const userId = await getUserId(c);
  const folderRowId = await authorizeAndFetchFolderId(folderId, userId);

  const data = await db
    .update(bookmark)
    .set({
      folderId: folderRowId,
    })
    .where(orm.inArray(bookmark.publicId, bookmarkIds));

  if (!data) {
    throwError("INTERNAL_ERROR", "Failed to add bookmarks to folder", source);
  }

  return c.json(
    {
      success: true,
      data: null,
      message: `Bookmarks added to selected folder with id ${folderId}`,
    },
    200,
  );
});

// -----------------------------------------
// TOGGLE BOOKMARK PIN, FAVORITE, ARCHIVE
// -----------------------------------------
router.openapi(tooggleBookmarkFlag, async (c) => {
  const source = "bookmarks.patch";
  const { state } = c.req.valid("json");
  const publicId = c.req.param("id");
  const flag = c.req.param("flag");
  const userId = await getUserId(c);

  if (!publicId || !flag) {
    throwError("MISSING_PARAMETER", "id or flag is missing", "bookmarks.get");
  }

  if (!Object.values(bookmarkFlags).includes(flag)) {
    throwError("INVALID_PARAMETER", "Invalid bookmark flag", "bookmarks.get");
  }

  if (state == null) {
    throwError("REQUIRED_FIELD", "State is required", source);
  }

  // Check if user authorized to changing anything related to bookmark
  await verifyUserAccessByBookmark(publicId, userId);

  const result = await db
    .update(bookmark)
    .set({ [flag]: state })
    .where(orm.eq(bookmark.publicId, publicId));

  if (result.rowCount === 0) {
    throwError("INTERNAL_ERROR", `Failed to change ${flag} state`, source);
  }

  return c.json(
    {
      success: true,
      message: "Successfully set flag",
    },
    200,
  );
});

export default router;
