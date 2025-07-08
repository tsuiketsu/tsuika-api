import { relations } from "drizzle-orm";
import {
  bigserial,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { timestamps } from "../constants";
import { user } from "./auth.schema";
import { folder } from "./folder.schema";

export const sharedFolder = pgTable("shared_folders", {
  id: bigserial({ mode: "number" }).primaryKey(),
  publicId: text().unique().notNull(),
  folderId: integer()
    .notNull()
    .references(() => folder.id, { onDelete: "cascade" }),
  createdBy: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text(),
  note: text(),
  isPublic: boolean().notNull().default(true),
  viewCount: integer(),
  lastViewdAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  unpublishedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export const sharedFolderRelations = relations(sharedFolder, ({ one }) => ({
  author: one(user, {
    fields: [sharedFolder.createdBy],
    references: [user.id],
  }),

  folder: one(folder, {
    fields: [sharedFolder.folderId],
    references: [folder.id],
  }),
}));

export const sharedFolderSelectSchema = createInsertSchema(sharedFolder);
export const sharedFolderInsertSchema = createInsertSchema(sharedFolder, {
  folderId: z.string(),
}).omit({ publicId: true, createdBy: true });
export const sharedFolderUpdateSchema = createInsertSchema(sharedFolder);
