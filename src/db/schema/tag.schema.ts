import { relations } from "drizzle-orm";
import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";
import { bookmarkTag } from "./bookmark-tag.schema";
import { timestamps } from "./constants";

export const tag = pgTable("tags", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  useCount: integer("use_count").default(0),
  ...timestamps,
});

export const tagRelations = relations(tag, ({ one, many }) => ({
  owner: one(user, {
    fields: [tag.userId],
    references: [user.id],
    relationName: "owner",
  }),

  bookmarkTag: many(bookmarkTag),
}));

export const tagSelectSchema = createSelectSchema(tag);

export const tagInsertSchema = createInsertSchema(tag, {
  name: z.string({ message: "Tag Name is required" }).max(30),
  color: z.string({ message: "Tag Color is required" }).min(6).max(15),
}).omit({ userId: true });

export const tagUpdateSchema = createUpdateSchema(tag, {
  name: z.string().max(30).optional(),
  color: z.string().min(6).max(15).optional(),
}).omit({ userId: true });
