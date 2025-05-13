import { relations } from "drizzle-orm";
import { boolean, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";
import { timestamps } from "./constants";

export const bookmark = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  faviconUrl: text("favicon_url"),
  thumbnail: text("thumbnail"),
  isPinned: boolean().default(false),
  isFavourite: boolean().default(false),
  isArchived: boolean().default(false),
  ...timestamps,
});

export const bookmarkRelations = relations(bookmark, ({ one }) => ({
  owner: one(user, {
    fields: [bookmark.userId],
    references: [user.id],
    relationName: "owner",
  }),
}));

export const bookmarkSelectSchema = createSelectSchema(bookmark);
export const bookmarkInsertSchema = createInsertSchema(bookmark, {
  title: z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
  url: z.string().url("Must be a valid URL"),
  faviconUrl: z.string().optional(),
  thumbnail: z.string().optional(),
});
