import type { profileSelectSchema } from "@/db/schema/profile.schema";
import { z } from "zod";
import type { bookmarkTagSelectSchema } from "../db/schema/bookmark-tag.schema";
import type { bookmarkSelectSchema } from "../db/schema/bookmark.schema";
import type { folderSelectSchema } from "../db/schema/folder.schema";
import type { tagSelectSchema } from "../db/schema/tag.schema";

export type ProfileType = z.infer<typeof profileSelectSchema>;
export type BookmarkType = z.infer<typeof bookmarkSelectSchema>;
export type TagType = z.infer<typeof tagSelectSchema>;

export type BookmarkTagType = z.infer<typeof bookmarkTagSelectSchema>;
export const bookmarkTagInsertSchema = z.object({
  bookmarkId: z.number(),
  tagIds: z.array(z.number()),
});

export type FolderType = z.infer<typeof folderSelectSchema>;
