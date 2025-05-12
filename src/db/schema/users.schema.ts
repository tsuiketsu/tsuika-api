import { json, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";

const users = pgTable("users", {
  userId: uuid().primaryKey().defaultRandom(),
  authId: text().unique().notNull(),
  username: text().unique().notNull(),
  email: text().unique().notNull(),
  fullName: text().notNull(),
  avatar: text(),
  coverImage: text(),
  preferencesJson: json(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow(),
});

const userInsertSchema = createInsertSchema(users, {
  username: z
    .string()
    .min(3, { message: "Username must be atleast 3 characters" })
    .max(30, { message: "Username must be at most 30 characters long." }),
  email: z.string().email({ message: "Invalid email address." }),
  fullName: z
    .string()
    .min(3, { message: "Full name must be at least 3 characters long." })
    .max(100, { message: "Full name must be at most 100 characters long." }),
  avatar: z.string().optional(),
  coverImage: z.string().optional(),
  preferencesJson: z.object({}),
});

const userUpdateSchema = createUpdateSchema(users);

export { users, userInsertSchema, userUpdateSchema };
