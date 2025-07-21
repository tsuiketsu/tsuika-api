import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { ImageKitReponse, SuccessResponse } from "@/types";
import { getUserId } from "@/utils";
import { deleteFromImageKit, uploadOnImageKit } from "@/utils/imagekit";

const router = createRouter();

// -----------------------------------------
// GET USER SESSION
// -----------------------------------------
router.get("/session", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!user) return c.body(null, 401);

  return c.json({
    session,
    user,
  });
});

router.get("/verification-email/:id", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throwError("REQUIRED_FIELD", "ID is required", "verifications.get");
  }

  const data = await db.query.verification.findFirst({
    where: (verification, { eq }) => eq(verification.id, id),
    columns: {
      identifier: true,
    },
  });

  if (!data?.identifier) {
    throwError(
      "NOT_FOUND",
      `Verification entry with id ${id} not found`,
      "verifications.get",
    );
  }

  return c.json<SuccessResponse<{ email: string }>>({
    success: true,
    message: "Successfully fetched email from verification entry",
    data: {
      email: data.identifier.replace("email-verification-otp-", ""),
    },
  });
});

// -----------------------------------------
// UPDATE NAME, USERNAME, IMAGE
// -----------------------------------------
router.patch("/user/update", async (c) => {
  const source = "user.update.put";
  const userId = await getUserId(c);

  const { name, username, image } = await c.req.parseBody();

  console.log(image, typeof image);

  // IMPORTANT: Check for username existence

  if (username && userId) {
    const found = await db.query.user.findFirst({
      where: and(ne(user.id, userId), eq(user.username, username as string)),
      columns: { username: true },
    });

    if (found) {
      throwError("CONFLICT", "Username is taken", source);
    }
  }

  // Upload file to cloud

  let cloudImage: ImageKitReponse | null = null;

  if (image && image instanceof File) {
    cloudImage = await uploadOnImageKit(image);
  }

  const newImage = cloudImage ? `${cloudImage.fileId}|${cloudImage.url}` : null;

  const response = await db.execute(sql`
    WITH old_data AS (
      SELECT id,image FROM auth.users WHERE id = ${userId}
    )
    UPDATE auth.users
    SET username = ${(username as string) ?? null},
        name = ${(name as string) ?? null},
        image = COALESCE(${newImage}, old_data.image)
    FROM old_data
    WHERE auth.users.id = old_data.id
    RETURNING 
      auth.users.name as name,
      auth.users.username as username,
      SPLIT_PART(auth.users.image, '|', 2) as image_url,
      SPLIT_PART(old_data.image, '|', 1) as old_image_id;
  `);

  if (!response || response.rows[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to update user profile", source);
  }

  // Cleanup old image

  const oldImageId = response.rows[0]["old_image_id"] as string;

  if (oldImageId) {
    await deleteFromImageKit(oldImageId);
  }

  return c.json<SuccessResponse<unknown>>({
    success: true,
    data: response.rows[0],
    message: "Successfully updated profile",
  });
});

export default router;
