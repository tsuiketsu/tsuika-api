import { eq, sql } from "drizzle-orm";
import { throwError } from "@/errors/handlers";
import { getProfile, updateUserPreferences } from "@/openapi/routes/profile";
import { getUserId } from "@/utils";
import { db } from "../db";
import { profile, profileSelectSchema } from "../db/schema/profile.schema";
import { createRouter } from "../lib/create-app";

const router = createRouter();

const whereUserId = (userId: string) => {
  return eq(profile.userId, userId);
};

// -----------------------------------------
// GET USER PROFILE
// -----------------------------------------
router.openapi(getProfile, async (c) => {
  const userId = await getUserId(c);

  const data = await db.query.profile.findFirst({
    where: whereUserId(userId),
    columns: { userId: false },
  });

  if (!data) {
    throwError("NOT_FOUND", "User profile not found", "profiles.get");
  }

  return c.json(
    { success: true, data, message: "Successfully fetched user's profile" },
    200,
  );
});

// -----------------------------------------
// Update Preferences
// -----------------------------------------
router.openapi(updateUserPreferences, async (c) => {
  const { preferencesJson } = c.req.valid("json");

  const userId = await getUserId(c);

  const data = await db
    .insert(profile)
    .values({
      userId,
      preferencesJson,
    })
    .onConflictDoUpdate({
      target: profile.userId,
      where: whereUserId(userId),
      set: { preferencesJson, updatedAt: sql`now()` },
    })
    .returning();

  if (!data || data[0] == null) {
    throwError(
      "INTERNAL_ERROR",
      "Failed to update user preferences",
      "profiles.post",
    );
  }

  return c.json(
    {
      success: true,
      data: profileSelectSchema.parse(data[0]),
      message: "Successfully updated preferences",
    },
    200,
  );
});

export default router;
