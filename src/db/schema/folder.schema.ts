import { bigserial, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";
import { timestamps } from "./constants";

export const folder = pgTable("folders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicId: text("public_id").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  ...timestamps,
});

export const folderSelectSchema = createSelectSchema(folder, {
  id: z.string(),
}).omit({
  publicId: true,
  userId: true,
});

export const folderInsertSchema = createInsertSchema(folder).pick({
  name: true,
  description: true,
});
