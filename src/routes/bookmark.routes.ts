import type { LinkPreviewResponsse } from "@/types/link-preview.types";
import { getImageMedatata } from "@/utils/image-metadata";
import { fetchLinkPreview } from "@/utils/link-preview";
import { generatePublicId } from "@/utils/nanoid";
import { getCleanUrl } from "@/utils/parse-url";
import * as orm from "drizzle-orm";
import type { Context } from "hono";
import type { Metadata } from "sharp";
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
import { ApiError } from "../utils/api-error";
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
    throw new ApiError(400, "Bookmark ID is required");
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
    throw new ApiError(404, `Bookmark with id ${id} does not exists`);
  }

  return { ...prev, url: prev.url ?? "" };
};

const getBookmarkId = async (c: Context) => {
  const id = getBookmarkIdParam(c);

  if (!id) {
    throw new ApiError(400, "Bookmark ID is required");
  }

  c.set("bookmarkId", id);

  const isBookmarkExists = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(await getUserId(c), id),
    columns: { id: true },
  });

  if (!isBookmarkExists) {
    throw new ApiError(404, `Bookmark with id ${id} does not exists`);
  }

  return id;
};

const setBookmarkFlag = async (
  c: Context,
  field: "isPinned" | "isArchived" | "isFavourite",
) => {
  const bookmarkId = await getBookmarkId(c);
  const { state } = await c.req.json();

  if (state == null) {
    throw new ApiError(400, "State is required");
  }

  const result = await db
    .update(bookmark)
    .set({ [field]: state })
    .where(whereBookmarkByUserAndPublicId(await getUserId(c), bookmarkId));

  if (result.rowCount === 0) {
    throw new ApiError(502, `Failed to change ${field} state`);
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
      throw new ApiError(
        500,
        `Failed to get folder by id ${folderId}`,
        "FOLDER_NOT_FOUND",
      );
    }
  }

  return data;
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
    throw new ApiError(404, "No tags found", "TAG_NOT_FOUND");
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

const bookmarkPublicFields = {
  id: bookmark.publicId,
  title: bookmark.title,
  description: bookmark.description,
  url: bookmark.url,
  faviconUrl: bookmark.faviconUrl,
  thumbnail: bookmark.thumbnail,
  thumbnailWidth: bookmark.thumbnailWidth,
  thumbnailHeight: bookmark.thumbnailHeight,
  isPinned: bookmark.isPinned,
  isFavourite: bookmark.isFavourite,
  isArchived: bookmark.isArchived,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
};

// -----------------------------------------
// ADD NEW BOOKMARK
// -----------------------------------------
router.post("/", zValidator("json", bookmarkInsertSchema), async (c) => {
  const { folderId, title, url, tags } = c.req.valid("json");
  console.log("Its not reaching here");

  if (!url) {
    throw new ApiError(400, "Url is required", "INVALID_PARAMETERS");
  }

  const userId = await getUserId(c);

  const folderData = await getFolder(folderId, userId);

  // NOTE: Whole thing is not very robust, db.transaction is better choice
  // but that doesn't work with neon-http, also db.batch which is not
  // very ideal for this situation since I need bookmarkId

  const siteMeta = await fetchLinkPreview(url);

  if (!siteMeta.data) {
    console.error(
      `Fialed to fetch metadata of url ${url}`,
      siteMeta.message || "",
    );
  }
  const image = siteMeta.data?.images?.[0];
  let imageMeta: Metadata | null = null;

  if (image && image.trim() !== "") {
    imageMeta = await getImageMedatata(image);
  }

  const data: (Omit<BookmarkType, "id" | "folderId"> & { id: number })[] =
    await db
      .insert(bookmark)
      .values({
        publicId: generatePublicId(),
        folderId: folderData?.id,
        userId: userId,
        title: title || siteMeta.data?.title || "Untitled",
        description: siteMeta.data?.description || "",
        url,
        thumbnail: siteMeta.data?.images?.[0] ?? null,
        faviconUrl: siteMeta.data?.favicons?.[0] ?? getFavIcon(url),
        thumbnailHeight: imageMeta?.height,
        thumbnailWidth: imageMeta?.width,
      })
      .returning();

  if (data.length === 0 || typeof data[0] === "undefined") {
    throw new ApiError(502, "Failed to add bookmark");
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
// GET ALL BOOKMARKS
// -----------------------------------------
router.get("/", async (c) => {
  const userId = await getUserId(c);
  const { page, limit, offset } = getPagination(c.req.query());

  const orderBy = getOrderDirection(c.req.query());

  const data = await db.query.bookmark.findMany({
    where: orm.eq(bookmark.userId, userId),
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
    throw new ApiError(404, "No bookmarks found");
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
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
  });
});

// -----------------------------------------
// GET BOOKMARKS BY TAG PUBLIC ID
// -----------------------------------------
router.get("/tag/:publicId", async (c) => {
  const userId = await getUserId(c);
  const publicId = c.req.param("publicId");

  if (!publicId || publicId.trim() === "") {
    throw new ApiError(400, "Invalid tag id", "INVALID_PARAMETERS");
  }

  const tagData = await db.query.tag.findFirst({
    where: orm.and(orm.eq(tag.userId, userId), orm.eq(tag.publicId, publicId)),
    columns: {
      id: true,
    },
  });

  if (!tagData) {
    throw new ApiError(
      404,
      `Tag with tagname ${publicId} not found`,
      "INVALID_TAG_NAME",
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
    throw new ApiError(
      404,
      `No bookmarks associated with tag ${publicId}`,
      "BOOKMARK_NOT_FOUND",
    );
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
    success: true,
    data: data as BookmarkType[],
    message: "Successfully fetched bookmarks",
    pagination: {
      page,
      limit,
      total: data.length,
      hasMore: data.length === limit,
    },
  });
});

// -----------------------------------------
// GET BOOKMARKS BY FOLDER ID
// -----------------------------------------
router.get("/folder/:id", async (c) => {
  const userId = await getUserId(c);
  const folderId = c.req.param("id");

  if (!folderId || folderId.trim() === "") {
    throw new ApiError(400, "Invalid folder name", "INVALID_FOLDER_NAME");
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
        throw new ApiError(
          404,
          `Folder with slug ${folderId} not found`,
          "FOLDER_NOT_FOUND",
        );
      }

      condition = orm.and(
        orm.eq(bookmark.folderId, folderObj.id),
        orm.eq(bookmark.isArchived, false),
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

  const orderBy = getOrderDirection(c.req.query());
  const isPinned = c.req.query("isPinned");

  const data = await db.query.bookmark.findMany({
    where: orm.and(
      orm.eq(bookmark.userId, userId),
      condition,
      ...(typeof isPinned !== "undefined"
        ? [orm.eq(bookmark.isPinned, isPinned === "true")]
        : []),
      queryCondition,
    ),
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
    throw new ApiError(
      404,
      `No bookmarks exists in folder ${folderId}`,
      "BOOKMARK_NOT_FOUND",
    );
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
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
  });
});

// -----------------------------------------
// GET BOOKMARK BY ID
// -----------------------------------------
router.get(":id", async (c) => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  const bookmarkId = await getBookmarkId(c);

  if (!bookmarkId) {
    throw new ApiError(400, "Bookmark ID is required");
  }

  const data = await db.query.bookmark.findFirst({
    where: whereBookmarkByUserAndPublicId(userId, bookmarkId),
    with: bookmarkJoins,
  });

  if (!data) {
    throw new ApiError(
      404,
      `Bookmark with ${bookmarkId} not found`,
      "BOOKMARK_NOT_FOUND",
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
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  // Get previous bookmark id and url
  const prev = await getBookmarkById(c);

  const { folderId, title, url, description, tags } = c.req.valid("json");

  const user = c.get("user");
  const folderData = await getFolder(folderId, userId);

  if (!user) {
    throw new ApiError(401, "Failed to add bookmark, user not found");
  }

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
    throw new ApiError(502, "Failed to updated bookmark");
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
    throw new ApiError(502, "Failed to delete bookmark");
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
    throw new ApiError(400, "Thumbnail image file is required");
  }

  // Upload thumbnail on imagekit
  const thumbnail = await uploadOnImageKit(localThumbnailUrl);

  if (!thumbnail || !thumbnail.fileId) {
    throw new ApiError(thumbnail?.status || 502, thumbnail?.message);
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
    throw new ApiError(502, "Failed to update thumbnail");
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
// TOGGLE BOOKMARK PIN, FAVORITE, ARCHIVE
// -----------------------------------------
router.patch(":id/pin", (c) => setBookmarkFlag(c, "isPinned"));
router.patch(":id/favorite", (c) => setBookmarkFlag(c, "isFavourite"));
router.patch(":id/archive", (c) => setBookmarkFlag(c, "isArchived"));

export default router;
