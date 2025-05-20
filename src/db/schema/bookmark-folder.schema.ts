import { relations } from "drizzle-orm";
import { integer, pgTable, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { bookmark } from "./bookmark.schema";
import { folder } from "./folder.schema";

export const bookmarkFolder = pgTable(
  "bookmark_folders",
  {
    folderId: integer("folder_id")
      .notNull()
      .references(() => folder.id, { onDelete: "cascade" }),
    bookmarkId: integer("bookmark_id")
      .notNull()
      .references(() => bookmark.id, { onDelete: "cascade" }),
    addedAt: timestamp("added-at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.folderId, table.bookmarkId] })],
);

export const BookmarkFolderRelations = relations(bookmarkFolder, ({ one }) => ({
  folder: one(folder, {
    fields: [bookmarkFolder.folderId],
    references: [folder.id],
  }),
  bookmark: one(bookmark, {
    fields: [bookmarkFolder.bookmarkId],
    references: [bookmark.id],
  }),
}));
