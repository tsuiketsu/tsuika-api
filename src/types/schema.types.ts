import { z } from "zod";
import type { bookmarkTagSelectSchema } from "../db/schema/bookmark-tag.schema";
import {
  bookmarkInsertSchema,
  type bookmarkSelectSchema,
} from "../db/schema/bookmark.schema";
import type { folderSelectSchema } from "../db/schema/folder.schema";
import { tagSelectSchema } from "../db/schema/tag.schema";

export const createBookmarkSchema = bookmarkInsertSchema
  .pick({
    title: true,
    description: true,
    url: true,
  })
  .extend({
    tags: z
      .array(tagSelectSchema.pick({ id: true, name: true, color: true }))
      .optional(),
  });

export type BookmarkType = z.infer<typeof bookmarkSelectSchema>;
export type TagType = z.infer<typeof tagSelectSchema>;

export type BookmarkTagType = z.infer<typeof bookmarkTagSelectSchema>;
export const bookmarkTagInsertSchema = z.object({
  bookmarkId: z.number(),
  tagIds: z.array(z.number()),
});

export type FolderType = z.infer<typeof folderSelectSchema>;
