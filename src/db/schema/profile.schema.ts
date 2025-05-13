import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";

export const profile = pgTable("profiles", {
  userId: text("user_id").references(() => user.id, {
    onDelete: "cascade",
  }),
  avatar: text(),
  coverImage: text(),
  preferencesJson: jsonb(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow(),
});

export const profileInsertSchema = createInsertSchema(profile, {
  userId: z.string().optional(),
  avatar: z.string().optional(),
  coverImage: z.string().optional(),
  preferencesJson: z.object({}),
});

export const profileUpdateSchema = createUpdateSchema(profile);
