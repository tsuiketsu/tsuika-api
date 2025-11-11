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
  toggleBookmarkFlag,
  updateBookmark,
  updateBookmarkThumbnail,
} from "@/openapi/routes/bookmark";
import type { LinkPreviewResponse } from "@/types/link-preview.types";
import { getImageMetadata, type Metadata } from "@/utils/image-metadata";
import { fetchLinkPreview } from "@/utils/link-preview";
import {
  type CreateObjectResponse,
  createBucketObject,
  createObjectStoreURL,
  deleteObjectFromBucket,
  deleteObjectsFromBucket,
} from "@/utils/minio";
import { generatePublicId } from "@/utils/nanoid";
import { getCleanUrl } from "@/utils/parse-url";
import { db } from "../db";
import { bookmark, bookmarkSelectSchema } from "../db/schema/bookmark.schema";
import { bookmarkTag } from "../db/schema/bookmark-tag.schema";
import { tag } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import { type BookmarkType, bookmarkFlags } from "../types/schema.types";
import {
  getOrderDirection,
  getPagination,
  getUserId,
  hasHttpPrefix,
  pick,
} from "../utils";
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

const createThumbnailURL = (thumbnail: string | null) => {
  if (thumbnail) {
    return hasHttpPrefix(thumbnail)
      ? thumbnail
      : createObjectStoreURL(BUCKET, thumbnail);
  }

  return null;
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

  let siteMeta: LinkPreviewResponse | undefined;
  let attachment: CreateObjectResponse | null = null;

  if (!isEncrypted) {
    siteMeta = await fetchLinkPreview(url);

    if (!siteMeta.data) {
      console.error(
        `Failed to fetch metadata of url ${url}`,
        siteMeta.message || "",
      );
    }
  }

  const siteMetaImage = siteMeta?.data?.images?.[0];
  let imageMeta: Metadata | null = null;

  if (siteMetaImage && siteMetaImage.trim() !== "") {
    imageMeta = await getImageMetadata(siteMetaImage);

    // Cache thumbnail to objectStore
    attachment = await createBucketObject({
      origin: "remote",
      fileUri: siteMetaImage,
      bucket: BUCKET,
    });
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
        thumbnail: attachment?.fileId ?? siteMetaImage,
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
      // where: orm.eq(folder.id, folderInfo?.id!),
      ...(folderInfo?.id ? { where: orm.eq(folder.id, folderInfo.id) } : {}),
      columns: { userId: true },
    });

    if (selectedFolder) {
      ownerUserId = selectedFolder.userId;
    }
  }

  const data = await db.transaction(async (tx) => {
    const bmark = await tx
      .insert(bookmark)
      .values({
        publicId: generatePublicId(),
        folderId: folderInfo?.id,
        userId: ownerUserId,
        ...payload,
      })
      .returning();

    const bookmarkId = bmark[0]?.id;

    if (!bookmarkId) {
      throwError("INTERNAL_ERROR", "Failed to add bookmark", source);
    }

    const tagIds =
      (
        await tx.query.tag.findMany({
          where: orm.and(
            orm.eq(bookmark.userId, userId),
            orm.inArray(tag.publicId, tags?.map((tag) => tag.id) ?? []),
          ),
          columns: { id: true },
        })
      )?.map((tag) => tag.id) ?? [];

    let isTagsInserted = false;

    if (tagIds.length > 0) {
      const tagsResponse = await tx
        .insert(bookmarkTag)
        .values(tagIds.map((tagId) => ({ userId, tagId, bookmarkId })))
        .onConflictDoNothing()
        .returning({ bookmarkId: bookmarkTag.bookmarkId });

      if (!tagsResponse || tagsResponse[0] == null) {
        tx.rollback();
        throwError("INTERNAL_ERROR", "Failed to update bookmark", source);
      }

      isTagsInserted = true;
    }

    return { bookmark: bmark[0], isTagsInserted };
  });

  if (!data || !data.bookmark) {
    throwError("INTERNAL_ERROR", "Failed to add bookmark", source);
  }

  const { publicId, ...rest } = data.bookmark;

  return c.json(
    {
      success: true,
      message: "Bookmark added successfully 🔖",
      data: bookmarkSelectSchema.parse({
        ...rest,
        id: publicId,
        thumbnail: attachment?.url ?? rest.thumbnail,
        folderId,
        ...(data.isTagsInserted ? { tags } : {}),
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

  if (!data || data.length === 0) {
    throwError("NOT_FOUND", "No bookmarks found", source);
  }

  return c.json(
    {
      success: true,
      message: "Successfully fetched all bookmarks",
      data: data.map(
        ({ thumbnail, publicId, bookmarkFolder, bookmarkTag, ...rest }) => ({
          ...rest,
          id: publicId,
          folderId: bookmarkFolder?.publicId,
          thumbnail: !rest.isEncrypted
            ? createThumbnailURL(thumbnail)
            : thumbnail || null,
          tags: bookmarkTag.map(({ tag, appliedAt }) => ({
            ...tag,
            id: tag.publicId,
            appliedAt,
          })),
        }),
      ) as BookmarkType[],
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
      data: {
        ...data.map((b) =>
          Object.assign({}, b, {
            thumbnail: !b.isEncrypted
              ? createThumbnailURL(b.thumbnail)
              : b.thumbnail || null,
          }),
        ),
      } as BookmarkType[],
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
      data: data.map(
        ({ publicId, thumbnail, bookmarkFolder, bookmarkTag, ...rest }) => ({
          ...rest,
          id: publicId,
          folderId: bookmarkFolder?.publicId,
          thumbnail: !rest.isEncrypted
            ? createThumbnailURL(thumbnail)
            : thumbnail || null,
          tags: bookmarkTag.map(({ tag, appliedAt }) => ({
            ...tag,
            id: tag.publicId,
            appliedAt,
          })),
        }),
      ),
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

  const { bookmarkFolder, publicId, thumbnail, ...rest } = updatedData;

  return c.json(
    {
      success: true,
      data: {
        ...rest,
        id: publicId,
        folderId: bookmarkFolder?.publicId,
        thumbnail: !rest.isEncrypted
          ? createThumbnailURL(thumbnail)
          : thumbnail || null,
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
    columns: { id: true, url: true, thumbnail: true },
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

  let siteMeta: LinkPreviewResponse | undefined;

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

  const newThumbnail = siteMeta?.data?.images?.[0] || undefined;
  let imageMeta: Metadata | null = null;
  let attachment: CreateObjectResponse | null = null;

  // Fetch image's metadata
  if (newThumbnail && newThumbnail.trim() !== "") {
    imageMeta = await getImageMetadata(newThumbnail);

    // Cleanup previous thumbnail from object store

    if (prev.thumbnail && !hasHttpPrefix(prev.thumbnail)) {
      await deleteObjectFromBucket(BUCKET, prev.thumbnail);
    }

    attachment = await createBucketObject({
      origin: "remote",
      fileUri: newThumbnail,
      bucket: BUCKET,
    });
  }

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
        ...(newThumbnail
          ? { thumbnail: attachment?.fileId ?? newThumbnail }
          : {}),
      };

  const data = await db.transaction(async (tx) => {
    const bmark = await tx
      .update(bookmark)
      .set(payload)
      .where(orm.eq(bookmark.id, prev.id))
      .returning(bookmarkPublicFields);

    if (!bmark || bmark[0] == null) {
      throwError("INTERNAL_ERROR", "Failed to update bookmark", source);
    }

    if (!tags || tags.length === 0) {
      return { bookmark: bmark[0], isTagsInserted: false };
    }

    const tagIds =
      (
        await tx.query.tag.findMany({
          where: orm.and(
            orm.eq(bookmark.userId, userId),
            orm.inArray(
              tag.publicId,
              tags?.map((tag) => tag.id),
            ),
          ),
          columns: { id: true },
        })
      )?.map((tag) => tag.id) ?? [];

    let isTagsInserted = false;

    if (tagIds.length > 0) {
      const tagsResponse = await tx
        .insert(bookmarkTag)
        .values(tagIds.map((tagId) => ({ userId, tagId, bookmarkId: prev.id })))
        .onConflictDoNothing()
        .returning({ bookmarkId: bookmarkTag.bookmarkId });

      if (!tagsResponse || tagsResponse[0] == null) {
        tx.rollback();
        throwError("INTERNAL_ERROR", "Failed to update bookmark", source);
      }

      isTagsInserted = true;
    }

    return {
      bookmark: bmark[0],
      isTagsInserted,
    };
  });

  return c.json(
    {
      success: true,
      message: "Bookmark updated successfully 🔖",
      data: {
        ...data.bookmark,
        folderId: folderId,
        thumbnail: !isEncrypted
          ? createThumbnailURL(data.bookmark?.thumbnail)
          : thumbnail || null,
        ...(data.isTagsInserted ? { tags } : {}),
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
    .returning({
      deletedBookmarkId: bookmark.publicId,
      thumbnail: bookmark.thumbnail,
    });

  if (data.length === 0) {
    throwError("INTERNAL_ERROR", "Failed to delete bookmark", source);
  }

  // Cleanup objectStore thumbnail
  const objectIds = data
    .map((d) => d.thumbnail)
    .filter((t) => !hasHttpPrefix(t))
    .filter((t) => t !== null);

  if (objectIds.length > 0) {
    await deleteObjectsFromBucket(BUCKET, objectIds);
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
  const data: { deletedBookmarkId: string; thumbnail: string | null }[] =
    await db
      .delete(bookmark)
      .where(orm.eq(bookmark.publicId, c.req.param("id")))
      .returning({
        deletedBookmarkId: bookmark.publicId,
        thumbnail: bookmark.thumbnail,
      });

  if (data.length === 0) {
    throwError("INTERNAL_ERROR", "Failed to delete bookmark", source);
  }

  // Delete objectStore thumbnail
  if (data[0]?.thumbnail && !hasHttpPrefix(data[0].thumbnail)) {
    await deleteObjectFromBucket(BUCKET, data[0].thumbnail);
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

  // Upload thumbnail on Minio bucket
  const thumbnail = await createBucketObject({
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
    await deleteObjectFromBucket(BUCKET, prevThumbnail.thumbnail);
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
      "At least one bookmarkId is required",
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
router.openapi(toggleBookmarkFlag, async (c) => {
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
