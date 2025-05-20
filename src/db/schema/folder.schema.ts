import { pgTable, serial, text } from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { user } from "./auth.schema";
import { timestamps } from "./constants";

export const folder = pgTable("folders", {
  id: serial("id").notNull().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  ...timestamps,
});

export const folderSelectSchema = createSelectSchema(folder);
export const folderInsertSchema = createInsertSchema(folder).pick({
  name: true,
  description: true,
});
