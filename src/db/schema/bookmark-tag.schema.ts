import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth.schema";
import { bookmark } from "./bookmark.schema";
import { tag } from "./tag.schema";

export const bookmarkTag = pgTable(
  "bookmark_tags",
  {
    tagId: integer("tag_id").references(() => tag.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookmarkId: integer("bookmark_id").references(() => bookmark.id, {
      onDelete: "cascade",
    }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // (table) => [primaryKey({ columns: [table.bookmarkId, table.tagId] })],
);

export const bookmarkTagRelations = relations(bookmarkTag, ({ one }) => ({
  owner: one(user, {
    fields: [bookmarkTag.userId],
    references: [user.id],
    relationName: "owner",
  }),

  bookmark: one(bookmark, {
    fields: [bookmarkTag.bookmarkId],
    references: [bookmark.id],
  }),

  tag: one(tag, {
    fields: [bookmarkTag.tagId],
    references: [tag.id],
  }),
}));

export const bookmarkTagSelectSchema = createSelectSchema(bookmarkTag);
export const bookmarkTagInsertSchema = createInsertSchema(bookmarkTag);
