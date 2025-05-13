import type { z } from "zod";
import {
  bookmarkInsertSchema,
  type bookmarkSelectSchema,
} from "../db/schema/bookmark.schema";

export const createBookmarkSchema = bookmarkInsertSchema.pick({
  title: true,
  description: true,
  url: true,
});

export type BookmarkType = z.infer<typeof bookmarkSelectSchema>;
