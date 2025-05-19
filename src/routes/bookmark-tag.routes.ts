import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth.schema";
import { bookmarkTag } from "../db/schema/bookmark-tag.schema";
import { bookmark } from "../db/schema/bookmark.schema";
import { tag } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import type { SuccessResponse } from "../types";
import {
  type BookmarkTagType,
  bookmarkTagInsertSchema,
} from "../types/schema.types";
import { getUserId } from "../utils";
import { ApiError } from "../utils/api-error";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

// -----------------------------------------
// ADD BOOKMARK TAGS
// -----------------------------------------
router.post("/", zValidator("json", bookmarkTagInsertSchema), async (c) => {
  const { tagIds, bookmarkId } = c.req.valid("json");

  if (!bookmarkId || !tagIds || tagIds.length === 0) {
    throw new ApiError(400, "bookmarkId and at least one tagId are required.");
  }

  const userId = await getUserId(c);

  const data: BookmarkTagType[] = await db
    .insert(bookmarkTag)
    .values(
      tagIds.map((tagId) => ({
        bookmarkId,
        tagId,
        userId,
      })),
    )
    .onConflictDoNothing()
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(
      400,
      "Failed to add tags to bookmark. One or more tags may already be associated with this bookmark.",
    );
  }

  return c.json<SuccessResponse<BookmarkTagType[]>>(
    {
      success: true,
      data,
      message: "Successfully added tags to bookmark",
    },
    200,
  );
});

// -----------------------------------------
// REMOVE BOOKMARK TAGS
// -----------------------------------------
router.delete("/", zValidator("json", bookmarkTagInsertSchema), async (c) => {
  const { tagIds, bookmarkId } = c.req.valid("json");

  if (!bookmarkId || !tagIds || tagIds.length === 0) {
    throw new ApiError(400, "bookmarkId and at least one tagId are required.");
  }

  const userId = await getUserId(c);

  const data: BookmarkTagType[] = await db
    .delete(bookmarkTag)
    .where(
      and(
        eq(bookmarkTag.userId, userId),
        eq(bookmarkTag.bookmarkId, bookmarkId),
        inArray(bookmarkTag.tagId, tagIds),
      ),
    )
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(
      400,
      "Failed to remove tags from bookmark. One or more tags may not be associated with this bookmark",
    );
  }

  return c.json<SuccessResponse<BookmarkTagType[]>>(
    {
      success: true,
      data,
      message: "Successfully deleted one or more tags from bookmark",
    },
    200,
  );
});

export default router;
