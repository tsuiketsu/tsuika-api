import { json, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";

export const profile = pgTable("profiles", {
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  username: text().unique().notNull(),
  fullName: text().notNull(),
  avatar: text(),
  coverImage: text(),
  preferencesJson: json(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow(),
});

export const profileInsertSchema = createInsertSchema(profile, {
  userId: z.string().optional(),
  username: z
    .string()
    .min(3, { message: "Username must be atleast 3 characters" })
    .max(30, { message: "Username must be at most 30 characters long." }),
  fullName: z
    .string()
    .min(3, { message: "Full name must be at least 3 characters long." })
    .max(100, { message: "Full name must be at most 100 characters long." }),
  avatar: z.string().optional(),
  coverImage: z.string().optional(),
  preferencesJson: z.object({}),
});

export const profileUpdateSchema = createUpdateSchema(profile);
