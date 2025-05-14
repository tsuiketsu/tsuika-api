import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import {
  bookmark,
  bookmarkInsertSchema,
  bookmarkSelectSchema,
} from "../db/schema/bookmark.schema";
import { createRouter } from "../lib/create-app";
import type { ImageKitReponse, SuccessResponse } from "../types";
import { type BookmarkType, createBookmarkSchema } from "../types/schema.types";
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

// -----------------------------------------
// ADD NEW BOOKMARK
// -----------------------------------------
router.post("/", zValidator("json", createBookmarkSchema), async (c) => {
  const { title, url, description } = c.req.valid("json");

  if (!title || !url) {
    throw new ApiError(400, "Title & url are required");
  }

  const user = c.get("user");

  if (!user) {
    throw new ApiError(401, "Failed to add bookmark, user not found");
  }

  const data: BookmarkType[] = await db
    .insert(bookmark)
    .values({
      userId: user.id,
      title,
      description,
      url,
      faviconUrl: getFavIcon(url),
    })
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(502, "Failed to add bookmark");
  }

  return c.json<SuccessResponse<BookmarkType>>(
    {
      success: true,
      message: "Bookmark added successfully 🔖",
      data: data[0],
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
    throw new ApiError(401, "Unauthorized access detected");
  }

  const bookmarkId = Number.parseInt(c.req.param("id"));

  if (!bookmarkId) {
    throw new ApiError(400, "Bookmark ID is required");
  }

  const data = await db.query.bookmark.findFirst({
    where: and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)),
  });

  if (!data) {
    throw new ApiError(400, "Bookmark not found");
  }

  return c.json<SuccessResponse<BookmarkType>>(
    {
      success: true,
      message: "Successfully fetched bookmark",
      data: bookmarkSelectSchema.parse(data),
    },
    200,
  );
});

// -----------------------------------------
// UPDATE BOOKMARK
// -----------------------------------------
router.put(
  ":id",
  zValidator(
    "json",
    bookmarkInsertSchema.pick({ title: true, url: true, description: true }),
  ),
  async (c) => {
    const userId = c.get("user")?.id;

    if (!userId) {
      throw new ApiError(401, "Unauthorized access detected");
    }

    const bookmarkId = await verifyBookmarkExistence(c);

    const { title, url, description } = c.req.valid("json");

    const user = c.get("user");

    if (!user) {
      throw new ApiError(401, "Failed to add bookmark, user not found");
    }

    const data: BookmarkType[] = await db
      .update(bookmark)
      .set({
        title,
        description,
        url,
        faviconUrl: getFavIcon(url),
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(bookmark.userId, userId), eq(bookmark.id, bookmarkId)))
      .returning();

    if (data.length === 0 || data[0] == null) {
      throw new ApiError(502, "Failed to updated bookmark");
    }

    return c.json<SuccessResponse<BookmarkType>>(
      {
        success: true,
        message: "Bookmark updated successfully 🔖",
        data: data[0],
      },
      200,
    );
  },
);

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
