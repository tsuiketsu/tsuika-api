import { bigserial, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { timestamps } from "../constants";
import { user } from "./auth.schema";

export const folder = pgTable("folders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicId: text("public_id").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  keyDerivation: jsonb("key_derivation"),
  ...timestamps,
});

export const folderSelectSchema = createSelectSchema(folder, {
  id: z.string(),
  keyDerivation: z.any(),
}).omit({
  publicId: true,
  userId: true,
});

export const folderInsertSchema = createInsertSchema(folder)
  .pick({
    name: true,
    description: true,
  })
  .extend({
    keyDerivation: z
      .object({
        salt: z.string(),
        nonce: z.string(),
        kdf_algorithm: z.number(),
        kdf_opslimit: z.number(),
        kdf_memlimit: z.number(),
      })
      .optional(),
  });
