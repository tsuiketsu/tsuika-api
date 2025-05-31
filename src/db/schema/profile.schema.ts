import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "./auth.schema";

export const profile = pgTable("profiles", {
  userId: text("user_id")
    .references(() => user.id, {
      onDelete: "cascade",
    })
    .primaryKey(),
  preferencesJson: jsonb(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow(),
});

export const profileSelectSchema = createSelectSchema(profile).omit({
  userId: true,
});

export const profileInsertSchema = createInsertSchema(profile, {
  userId: z.string().optional(),
});
