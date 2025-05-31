import type { ProfileType } from "@/types/schema.types";
import { getUserId } from "@/utils";
import { zValidator } from "@/utils/validator-wrapper";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  profile,
  profileInsertSchema,
  profileSelectSchema,
} from "../db/schema/profile.schema";
import { createRouter } from "../lib/create-app";
import type { SuccessResponse } from "../types";
import { ApiError } from "../utils/api-error";

const router = createRouter();

const whereUserId = (userId: string) => {
  return eq(profile.userId, userId);
};

// -----------------------------------------
// Update Preferences
// -----------------------------------------
router.post("/", zValidator("json", profileInsertSchema), async (c) => {
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
    throw new ApiError(
      502,
      "Failed to update user preferences",
      "PROFILE_UPDATE_FAILED",
    );
  }

  return c.json<SuccessResponse<ProfileType>>(
    {
      success: true,
      data: profileSelectSchema.parse(data[0]),
      message: "Successfully updated preferences",
    },
    200,
  );
});

export default router;
