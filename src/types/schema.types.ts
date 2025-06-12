import type { profileSelectSchema } from "@/db/schema/profile.schema";
import type { reminderSelectSchema } from "@/db/schema/reminder.schema";
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

// Reminder Types
export type Reminder = z.infer<typeof reminderSelectSchema> & {
  type: ContentCategoryType;
};

export const contentCategoryTypes = {
  BOOKMARK: "bookmark",
  NOTE: "note",
  CODE_SNIPPET: "code_snippet",
} as const;

export type ContentCategoryType =
  (typeof contentCategoryTypes)[keyof typeof contentCategoryTypes];

export enum ReminderStatus {
  PENDING = "pending",
  DISMISSED = "dismissed",
  DONE = "done",
}

export enum ReminderPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
}

export type ReminderType = z.infer<typeof reminderSelectSchema>;
