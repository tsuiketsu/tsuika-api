import { throwError } from "@/errors/handlers";
import type { LinkPreviewResponsse } from "@/types/link-preview.types";
import { getImageMedatata } from "@/utils/image-metadata";
import { fetchLinkPreview } from "@/utils/link-preview";
import { generatePublicId } from "@/utils/nanoid";
import { getCleanUrl } from "@/utils/parse-url";
import * as orm from "drizzle-orm";
import type { Context } from "hono";
import type { Metadata } from "sharp";
import { z } from "zod";
import { db } from "../db";
import { bookmarkTag } from "../db/schema/bookmark-tag.schema";
import {
  bookmark,
  bookmarkInsertSchema,
  bookmarkSelectSchema,
} from "../db/schema/bookmark.schema";
import { folder } from "../db/schema/folder.schema";
import { tag } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import type { PaginatedSuccessResponse, SuccessResponse } from "../types";
import type { BookmarkType } from "../types/schema.types";
import { getOrderDirection, getPagination, getUserId } from "../utils";
import { deleteFromImageKit, uploadOnImageKit } from "../utils/imagekit";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

const getFavIcon = (url: string) => {
  return `https://www.google.com/s2/favicons?domain=${url}&sz=128`;
};

const whereUserId = (userId: string) => {
  return orm.eq(bookmark.userId, userId);
};

const wherePublicId = (publicId: string) => {
  return orm.eq(bookmark.publicId, publicId);
};

const whereBookmarkByUserAndPublicId = (userId: string, publicId: string) => {
  return orm.and(whereUserId(userId), wherePublicId(publicId));
};

const getBookmarkIdParam = (c: Context) => {
  const id = c.req.param("id");

  if (!id) {
    throwError("MISSING_PARAMETER", "Bookmark ID is required", "bookmarks.get");
  }

  return id;
};

const getBookmarkById = async (c: Context) => {
  const id = getBookmarkIdParam(c);
  const userId = await getUserId(c);

  const prev = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(userId, id),

    columns: { id: true, url: true },
  });

  if (!prev) {
    throwError(
      "NOT_FOUND",
      `Bookmark with id ${id} does not exists`,
      "bookmars.get",
    );
  }

  return { ...prev, url: prev.url ?? "" };
};

export const getBookmarkId = async (c: Context) => {
  const id = getBookmarkIdParam(c);

  if (!id) {
    throwError("MISSING_PARAMETER", "Bookmark ID is required", "bookmarks.get");
  }

  c.set("bookmarkId", id);

  const isBookmarkExists = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(await getUserId(c), id),
    columns: { id: true },
  });

  if (!isBookmarkExists) {
    throwError(
      "NOT_FOUND",
      `Bookmark with id ${id} does not exists`,
      "bookmarks.get",
    );
  }

  return id;
};

// Get folder row's id (primary key)
const getFolderId = async (userId: string, publicId: string) => {
  const data = await db.query.folder.findFirst({
    where: orm.and(whereUserId(userId), orm.eq(folder.publicId, publicId)),
    columns: { id: true },
  });

  if (!data) {
    throwError(
      "NOT_FOUND",
      `Folder with id ${publicId} no found`,
      "bookmarks.folders.get",
    );
  }

  return data.id;
};

const setBookmarkFlag = async (
  c: Context,
  field: "isPinned" | "isArchived" | "isFavourite",
) => {
  const bookmarkId = await getBookmarkId(c);
  const { state } = await c.req.json();

  if (state == null) {
    throwError("REQUIRED_FIELD", "State is required", "bookmarks.patch");
  }

  const result = await db
    .update(bookmark)
    .set({ [field]: state })
    .where(whereBookmarkByUserAndPublicId(await getUserId(c), bookmarkId));

  if (result.rowCount === 0) {
    throwError(
      "DATABASE_ERROR",
      `Failed to change ${field} state`,
      "bookmarks.patch",
    );
  }

  return c.json<SuccessResponse>(
    { success: true, message: `Successfully set ${field} state` },
    200,
  );
};

const getFolder = async (folderId: string | undefined, userId: string) => {
  let data: { id: number } | undefined;

  if (folderId) {
    data = await db.query.folder.findFirst({
      where: orm.and(whereUserId(userId), orm.eq(folder.publicId, folderId)),
      columns: { id: true },
    });

    if (!data?.id) {
      throwError(
        "NOT_FOUND",
        `Failed to get folder by id ${folderId}`,
        "bookmarks.folders.get",
      );
    }
  }

  return data;
};

const getFilterCondition = (
  query: Record<string, string | undefined>,
): orm.SQL<unknown> => {
  const flags = ["pinned", "archived", "favorites", "unsorted"];

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

const getTagIds = async (
  userId: string,
  tagPublicIds: string[] | undefined,
): Promise<number[] | undefined> => {
  if (!tagPublicIds) return undefined;

  const tags = await db.query.tag.findMany({
    where: orm.and(
      whereUserId(userId),
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

export const bookmarkPublicFields = {
  id: bookmark.publicId,
  title: bookmark.title,
  description: bookmark.description,
  url: bookmark.url,
  faviconUrl: bookmark.faviconUrl,
  thumbnail: bookmark.thumbnail,
  thumbnailWidth: bookmark.thumbnailWidth,
  thumbnailHeight: bookmark.thumbnailHeight,
  isPinned: bookmark.isPinned,
  isEncrypted: bookmark.isEncrypted,
  isFavourite: bookmark.isFavourite,
  isArchived: bookmark.isArchived,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
};

// -----------------------------------------
// ADD NEW BOOKMARK
// -----------------------------------------
router.post("/", zValidator("json", bookmarkInsertSchema), async (c) => {
  const {
    folderId,
    title,
    description,
    thumbnail,
    faviconUrl,
    url,
    tags,
    isEncrypted,
  } = c.req.valid("json");
  console.log("Its not reaching here");

  if (!isEncrypted && !url) {
    throwError("INVALID_PARAMETER", "Url is required", "bookmarks.post");
  }

  const userId = await getUserId(c);

  const folderData = await getFolder(folderId, userId);

  // NOTE: Whole thing is not very robust, db.transaction is better choice
  // but that doesn't work with neon-http, also db.batch which is not
  // very ideal for this situation since I need bookmarkId

  let siteMeta: LinkPreviewResponsse | undefined = undefined;

  if (!isEncrypted) {
    siteMeta = await fetchLinkPreview(url);

    if (!siteMeta.data) {
      console.error(
        `Fialed to fetch metadata of url ${url}`,
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

  const data: (Omit<BookmarkType, "id" | "folderId"> & { id: number })[] =
    await db
      .insert(bookmark)
      .values({
        publicId: generatePublicId(),
        folderId: folderData?.id,
        userId: userId,
        ...payload,
      })
      .returning();

  if (data.length === 0 || typeof data[0] === "undefined") {
    throwError("INTERNAL_ERROR", "Failed to add bookmark", "bookmarks.post");
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
  return c.json<SuccessResponse<BookmarkType>>(
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
router.get("/total-count", async (c) => {
  const condition = getFilterCondition(c.req.query());
  const userId = await getUserId(c);

  const data = await db
    .select({ count: orm.count() })
    .from(bookmark)
    .where(orm.and(whereUserId(userId), condition));

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "No bookmarks found", "bookmarks.get");
  }

  return c.json<SuccessResponse<{ total: number }>>(
    {
      success: true,
      data: { total: data[0].count },
      message: "Successfully fetched total bookmarks count",
    },
    200,
  );
});

// -----------------------------------------
// GET ALL BOOKMARKS
// -----------------------------------------
router.get("/", async (c) => {
  const { page, limit, offset } = getPagination(c.req.query());
  const condition = getFilterCondition(c.req.query());

  const orderBy = getOrderDirection(c.req.query(), "bookmarks.get");

  const userId = await getUserId(c);

  const data = await db.query.bookmark.findMany({
    where: (b, { and, eq }) =>
      and(whereUserId(userId), eq(b.isEncrypted, false), condition),
    with: bookmarkJoins,
    columns: { userId: false },
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
    throwError("NOT_FOUND", "No bookmarks found", "bookmarks.get");
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>(
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
// GET BOOKMARKS BY TAG PUBLIC ID
// -----------------------------------------
router.get("/tag/:publicId", async (c) => {
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

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>(
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
router.get("/folder/:id", async (c) => {
  const userId = await getUserId(c);
  const folderId = c.req.param("id");

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
      const folderObj = await db.query.folder.findFirst({
        where: orm.and(
          orm.eq(folder.userId, userId),
          orm.eq(folder.publicId, folderId.trim()),
        ),
        columns: {
          id: true,
        },
      });

      if (!folderObj?.id) {
        throwError(
          "NOT_FOUND",
          `Folder with slug ${folderId} not found`,
          "bookmarks.folders.get",
        );
      }

      const filterFlag = c.req.query("filter");

      condition = orm.and(
        orm.eq(bookmark.folderId, folderObj.id),
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

  let queryCondition: orm.SQL<unknown> | undefined = undefined;

  if (bookmarkQuery && bookmarkQuery.trim() !== "") {
    queryCondition = orm.or(
      orm.ilike(bookmark.title, `%${bookmarkQuery}%`),
      orm.ilike(bookmark.url, `%${bookmarkQuery}%`),
    );
  }

  const orderBy = getOrderDirection(c.req.query(), "folders.get");

  const data = await db.query.bookmark.findMany({
    where: orm.and(orm.eq(bookmark.userId, userId), condition, queryCondition),
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
    throwError(
      "NOT_FOUND",
      `No bookmarks exists in folder ${folderId}`,
      "bookmarks.get",
    );
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>(
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
router.get(":id", async (c) => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throwError("UNAUTHORIZED", "Unauthorized access detected", "bookmarks.get");
  }

  const bookmarkId = await getBookmarkId(c);

  if (!bookmarkId) {
    throwError("MISSING_PARAMETER", "Bookmark ID is required", "bookmarks.get");
  }

  const data = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(userId, bookmarkId),
    with: bookmarkJoins,
  });

  if (!data) {
    throwError(
      "NOT_FOUND",
      `Bookmark with ${bookmarkId} not found`,
      "bookmarks.get",
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

  const {
    userId: omitThis,
    bookmarkFolder,
    bookmarkTag,
    publicId,
    ...rest
  } = updatedData;

  return c.json<SuccessResponse<BookmarkType>>(
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
router.put(":id", zValidator("json", bookmarkInsertSchema), async (c) => {
  const userId = await getUserId(c);

  // Get previous bookmark id and url
  const prev = await getBookmarkById(c);

  const { folderId, title, url, description, tags } = c.req.valid("json");

  const folderData = await getFolder(folderId, userId);

  let siteMeta: LinkPreviewResponsse | undefined;

  // If current and prev.url same don't fetch site's metadata
  if (getCleanUrl(prev.url) !== getCleanUrl(url)) {
    siteMeta = await fetchLinkPreview(url);
  }

  if (!siteMeta?.data) {
    console.error(
      `Fialed to fetch metadata of url ${url}`,
      siteMeta?.message || "",
    );
  }

  const image = siteMeta?.data?.images?.[0] || undefined;
  let imageMeta: Metadata | null = null;

  // Fetch image's metadata
  if (image && image.trim() !== "") {
    imageMeta = await getImageMedatata(image);
  }

  const newThumbnail = siteMeta?.data?.images?.[0];

  const data: Omit<BookmarkType, "folderId">[] = await db
    .update(bookmark)
    .set({
      folderId: folderData?.id,
      title: title ?? (siteMeta?.data?.title || "Untitled"),
      description: description ?? (siteMeta?.data?.description || ""),
      url,
      faviconUrl: siteMeta?.data?.favicons?.[0] ?? getFavIcon(url),
      updatedAt: orm.sql`NOW()`,
      thumbnailHeight: imageMeta?.height,
      thumbnailWidth: imageMeta?.width,
      ...(newThumbnail ? { thumbnail: newThumbnail } : {}),
    })
    .where(
      orm.and(orm.eq(bookmark.userId, userId), orm.eq(bookmark.id, prev.id)),
    )
    .returning(bookmarkPublicFields);

  if (data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to updated bookmark", "bookmarks.put");
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

  return c.json<SuccessResponse<BookmarkType>>(
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
router.delete("/bulk", async (c) => {
  const userId = await getUserId(c);
  const { bookmarkIds } = await c.req.json();

  if (!bookmarkIds || bookmarkIds.length === 0) {
    throwError(
      "MISSING_PARAMETER",
      "Bookmark IDs are required",
      "bookmarks.delete",
    );
  }

  // Remove bookmark from database
  const data = await db
    .delete(bookmark)
    .where(
      orm.and(whereUserId(userId), orm.inArray(bookmark.publicId, bookmarkIds)),
    )
    .returning({ deletedBookmarkId: bookmark.publicId });

  if (data.length === 0) {
    throwError(
      "INTERNAL_ERROR",
      "Failed to delete bookmark",
      "bookmark.delete",
    );
  }

  return c.json<SuccessResponse<string[]>>(
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
router.delete(":id", async (c) => {
  const userId = await getUserId(c);
  const bookmarkId = await getBookmarkId(c);

  // Remove bookmark from database
  const data: { deletedBookmarkId: string }[] = await db
    .delete(bookmark)
    .where(whereBookmarkByUserAndPublicId(userId, bookmarkId))
    .returning({ deletedBookmarkId: bookmark.publicId });

  if (data.length === 0) {
    throwError(
      "INTERNAL_ERROR",
      "Failed to delete bookmark",
      "bookmarks.delete",
    );
  }

  return c.json(
    {
      success: true,
      message: "Successfully deleted bookmark 🔖",
    },
    200,
  );
});

// -----------------------------------------
// UPDATE BOOKMARK THUMBNAIL
// -----------------------------------------
router.patch(":id/thumbnail", async (c) => {
  const userId = await getUserId(c);
  const bookmarkId = await getBookmarkId(c);

  // Verify if thumbnail path provided
  const body = await c.req.parseBody();

  const localThumbnailUrl = body["path"];

  if (!localThumbnailUrl || !(localThumbnailUrl instanceof File)) {
    throwError(
      "REQUIRED_FIELD",
      "Thumbnail image file is required",
      "bookmarks.patch",
    );
  }

  // Upload thumbnail on imagekit
  const thumbnail = await uploadOnImageKit(localThumbnailUrl);

  if (!thumbnail || !thumbnail.fileId) {
    throwError(
      "THIRD_PARTY_SERVICE_FAILED",
      thumbnail.message || "Failed to updated thumbnail",
      "bookmarks.patch",
    );
  }

  // Get previous thumbnail url before updating
  const prevThumbnail = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(userId, bookmarkId),
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
    .where(whereBookmarkByUserAndPublicId(userId, bookmarkId))
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
    await deleteFromImageKit(prevThumbnail.thumbnail);
  }

  return c.json<SuccessResponse<{ thumbnail: string }>>(
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
const bulkAssignSchema = z.object({
  bookmarkIds: z.array(z.string()),
});

router.patch(
  "/folder/:folderId/bulk-assign-folder",
  zValidator("json", bulkAssignSchema),
  async (c) => {
    const folderId = c.req.param("folderId");

    if (!folderId) {
      throwError("MISSING_PARAMETER", "folderId  required", "bookmarks.patch");
    }

    const { bookmarkIds } = c.req.valid("json");

    if (bookmarkIds.length === 0) {
      throwError(
        "INVALID_PARAMETER",
        "bookmarkIds are empty",
        "bookmarks.patch",
      );
    }

    const userId = await getUserId(c);
    const folderNumericId = await getFolderId(userId, folderId);

    const data = await db
      .update(bookmark)
      .set({
        folderId: folderNumericId,
      })
      .where(orm.inArray(bookmark.publicId, bookmarkIds));

    if (!data) {
      throwError(
        "DATABASE_ERROR",
        "Failed to add bookmarks to folder",
        "bookmarks.patch",
      );
    }

    return c.json<SuccessResponse<null>>(
      {
        success: true,
        data: null,
        message: `Bookmarks added to selected folder with id ${folderId}`,
      },
      200,
    );
  },
);

// -----------------------------------------
// TOGGLE BOOKMARK PIN, FAVORITE, ARCHIVE
// -----------------------------------------
router.patch(":id/pin", (c) => setBookmarkFlag(c, "isPinned"));
router.patch(":id/favorite", (c) => setBookmarkFlag(c, "isFavourite"));
router.patch(":id/archive", (c) => setBookmarkFlag(c, "isArchived"));

export default router;
