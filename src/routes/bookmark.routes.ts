import { fetchLinkPreview } from "@/utils/ link-preview";
import { type SQL, and, eq, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { z } from "zod";
import { db } from "../db";
import { bookmarkTag } from "../db/schema/bookmark-tag.schema";
import { bookmark } from "../db/schema/bookmark.schema";
import { folder } from "../db/schema/folder.schema";
import { tag, type tagSelectSchema } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import type { PaginatedSuccessResponse, SuccessResponse } from "../types";
import { type BookmarkType, createBookmarkSchema } from "../types/schema.types";
import { getOrderDirection, getPagination, getUserId } from "../utils";
import { ApiError } from "../utils/api-error";
import { deleteFromImageKit, uploadOnImageKit } from "../utils/imagekit";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

const getFavIcon = (url: string) => {
  return `https://www.google.com/s2/favicons?domain=${url}&sz=128`;
};

const verifyBookmarkExistence = async (c: Context) => {
  const id = Number.parseInt(c.req.param("id"));

  if (!id) {
    throw new ApiError(400, "Bookmark ID is required");
  }

  c.set("bookmarkId", id);

  const isBookmarkExists = await db.query.bookmark.findFirst({
    where: and(eq(bookmark.userId, c.get("user").id), eq(bookmark.id, id)),

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
  const bookmarkId = await verifyBookmarkExistence(c);
  const { state } = await c.req.json();

  if (state == null) {
    throw new ApiError(400, "State is required");
  }

  const result = await db
    .update(bookmark)
    .set({
      [field]: state,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(eq(bookmark.userId, c.get("user").id), eq(bookmark.id, bookmarkId)),
    );

  if (result.rowCount === 0) {
    throw new ApiError(502, `Failed to change ${field} state`);
  }

  return c.json<SuccessResponse>(
    { success: true, message: `Successfully set ${field} state` },
    200,
  );
};

const bookmarkWithTags = {
  bookmarkTag: {
    columns: { appliedAt: true },
    with: {
      tag: {
        columns: {
          name: true,
          color: true,
        },
      },
    },
  },
} satisfies NonNullable<
  Parameters<(typeof db)["query"]["bookmark"]["findFirst" | "findMany"]>[0]
>["with"];

const insertTags = async (
  userId: string,
  bookmarkId: number | undefined,
  tags:
    | z.infer<
        ReturnType<
          typeof tagSelectSchema.pick<{ id: true; name: true; color: true }>
        >
      >[]
    | undefined,
): Promise<boolean> => {
  let tagsInserted = false;
  if (bookmarkId && tags && tags.length > 0) {
    const response = await db
      .insert(bookmarkTag)
      .values(
        tags.map(({ id }) => ({ userId, tagId: id, bookmarkId: bookmarkId })),
      )
      .returning({ bookmarkId: bookmarkTag.bookmarkId });

    if (response.length > 0 && response[0] != null) {
      tagsInserted = true;
    }
  }
  return tagsInserted;
};

// -----------------------------------------
// ADD NEW BOOKMARK
// -----------------------------------------
router.post("/", zValidator("json", createBookmarkSchema), async (c) => {
  const { folderId, title, url, tags } = c.req.valid("json");

  if (!url) {
    throw new ApiError(400, "Url is required", "INVALID_PARAMETERS");
  }

  const userId = await getUserId(c);

  // NOTE: Whole thing is not very robust, db.transaction is better choice
  // but that doesn't work with neon-http, also db.batch which is not
  // very ideal for this situation since I need bookmarkId

  const meta = await fetchLinkPreview(url);

  if (!meta.data) {
    console.error(`Fialed to fetch metadata of url ${url}`, meta.message || "");
  }

  const data: BookmarkType[] = await db
    .insert(bookmark)
    .values({
      folderId,
      userId: userId,
      title: meta.data?.title || "Untitled",
      description: meta.data?.description || "",
      url,
      thumbnail: meta.data?.images?.[0] ?? null,
      faviconUrl: meta.data?.favicons?.[0] ?? getFavIcon(url),
    })
    .returning();

  if (data.length === 0 || typeof data[0] === "undefined") {
    throw new ApiError(502, "Failed to add bookmark");
  }

  const bookmarkId = data[0].id;
  const tagsInserted = await insertTags(userId, bookmarkId, tags);

  return c.json<SuccessResponse<BookmarkType>>(
    {
      success: true,
      message: "Bookmark added successfully 🔖",
      data: Object.assign({}, data[0], tagsInserted ? { tags } : {}),
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
    where: eq(bookmark.userId, userId),
    with: bookmarkWithTags,
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
    throw new ApiError(400, "No tags found");
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
    success: true,
    message: "Successfully fetched all bookmarks",
    data: data.map(({ bookmarkTag, ...rest }) => ({
      ...rest,
      tags: bookmarkTag.map(({ tag, appliedAt }) => ({ ...tag, appliedAt })),
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
// GET BOOKMARKS BY TAG
// -----------------------------------------
router.get("/tag/:tagSlug", async (c) => {
  const userId = await getUserId(c);
  const tagName = c.req.param("tagSlug");

  if (!tagName || tagName.trim() === "") {
    throw new ApiError(400, "Invalid tag name", "INVALID_PARAMETERS");
  }

  const tagData = await db.query.tag.findFirst({
    where: and(eq(tag.userId, userId), eq(tag.name, tagName)),
    columns: {
      id: true,
    },
  });

  if (!tagData) {
    throw new ApiError(
      400,
      `Tag with tagname ${tagName} not found`,
      "INVALID_TAG_NAME",
    );
  }

  const { page, limit, offset } = getPagination(c.req.query());

  const data = await db.query.bookmarkTag.findMany({
    where: and(
      eq(bookmarkTag.userId, userId),
      eq(bookmarkTag.tagId, tagData.id),
    ),
    with: { bookmark: true },
    limit,
    offset,
  });

  if (!data || data.length === 0) {
    throw new ApiError(
      400,
      `No bookmarks associated with tag ${tagName}`,
      "BOOKMARK_NOT_FOUND",
    );
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
    success: true,
    data: data.map(({ bookmark }) => bookmark),
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
// GET BOOKMARKS BY FOLDER SLUG
// -----------------------------------------
router.get("/folder/:folderSlug", async (c) => {
  const userId = await getUserId(c);
  const folderName = c.req.param("folderSlug");

  if (!folderName || folderName.trim() === "") {
    throw new ApiError(400, "Invalid folder name", "INVALID_FOLDER_NAME");
  }

  let condition: SQL<unknown> | undefined;

  switch (folderName.toLowerCase().trim()) {
    case "archived":
      condition = eq(bookmark.isArchived, true);
      break;
    case "favorites":
      condition = eq(bookmark.isFavourite, true);
      break;
    case "unsorted":
      condition = isNull(bookmark.folderId);
      break;
    default: {
      const folderObj = await db.query.folder.findFirst({
        where: and(
          eq(folder.userId, userId),
          eq(folder.slug, folderName.trim()),
        ),
        columns: {
          id: true,
        },
      });

      if (!folderObj?.id) {
        throw new ApiError(
          404,
          `Folder with slug ${folderName} not found`,
          "FOLDER_NOT_FOUND",
        );
      }

      condition = eq(bookmark.folderId, folderObj.id);
    }
  }

  const { page, limit, offset } = getPagination(c.req.query());
  const orderBy = getOrderDirection(c.req.query());

  const data = await db.query.bookmark.findMany({
    where: and(eq(bookmark.userId, userId), condition),
    with: bookmarkWithTags,
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
      400,
      `No bookmarks exists in folder ${folderName}`,
      "BOOKMARK_NOT_FOUND",
    );
  }

  return c.json<PaginatedSuccessResponse<BookmarkType[]>>({
    success: true,
    message: "Successfully fetched all bookmarks",
    data: data.map(({ bookmarkTag, ...rest }) => ({
      ...rest,
      tags: bookmarkTag.map(({ tag, appliedAt }) => ({ ...tag, appliedAt })),
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

  const bookmarkId = Number.parseInt(c.req.param("id"));

  if (!bookmarkId) {
    throw new ApiError(400, "Bookmark ID is required");
  }

  const data = await db.query.bookmark.findFirst({
    where: and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)),
    with: bookmarkWithTags,
  });

  if (!data) {
    throw new ApiError(
      400,
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

  const { bookmarkTag, ...rest } = updatedData;

  return c.json<SuccessResponse<BookmarkType>>(
    {
      success: true,
      data: rest,
      message: "Successfully fetched bookmark",
    },
    200,
  );
});

// -----------------------------------------
// UPDATE BOOKMARK
// -----------------------------------------
router.put(":id", zValidator("json", createBookmarkSchema), async (c) => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  const bookmarkId = await verifyBookmarkExistence(c);

  const { folderId, title, url, description, tags } = c.req.valid("json");

  const user = c.get("user");

  if (!user) {
    throw new ApiError(401, "Failed to add bookmark, user not found");
  }

  const meta = await fetchLinkPreview(url);

  if (!meta.data) {
    console.error(`Fialed to fetch metadata of url ${url}`, meta.message || "");
  }

  const data: BookmarkType[] = await db
    .update(bookmark)
    .set({
      folderId,
      title: title ?? (meta.data?.title || "Untitled"),
      description: description ?? (meta.data?.description || ""),
      url,
      thumbnail: meta.data?.images?.[0] ?? null,
      faviconUrl: meta.data?.favicons?.[0] ?? getFavIcon(url),
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)))
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(502, "Failed to updated bookmark");
  }

  const tagsInserted = await insertTags(userId, bookmarkId, tags);

  return c.json<SuccessResponse<BookmarkType>>(
    {
      success: true,
      message: "Bookmark updated successfully 🔖",
      data: Object.assign({}, data[0], tagsInserted ? { tags } : {}),
    },
    200,
  );
});

// -----------------------------------------
// DELETE BOOKMARK
// -----------------------------------------
router.delete(":id", async (c) => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  const bookmarkId = await verifyBookmarkExistence(c);

  // Remove bookmark from database
  const data: { deleteId: number }[] = await db
    .delete(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)))
    .returning({
      deleteId: bookmark.id,
    });

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
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  const bookmarkId = await verifyBookmarkExistence(c);

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
    where: and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)),

    columns: {
      thumbnail: true,
    },
  });

  // Update thumbnail
  const data: { thumbnail: string | null }[] = await db
    .update(bookmark)
    .set({
      thumbnail: thumbnail.fileId,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)))
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
