import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db";
import { profile } from "../db/schema/profile.schema";
import { createRouter } from "../lib/create-app";
import {
  type ImageKitReponse,
  type SuccessResponse,
  createUserSchema,
} from "../types/schema.types";
import { ApiError } from "../utils/api-error";
import { uploadOnImageKit } from "../utils/imagekit";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

// -----------------------------------------
// ADD NEW USER
// -----------------------------------------
router.post("/add", zValidator("form", createUserSchema), async (c) => {
  const { username, fullName } = c.req.valid("form");

  const body = await c.req.parseBody();

  const isUserExists = await db.query.profile.findFirst({
    where: eq(profile.username, username),
    columns: { userId: true },
  });

  if (isUserExists) {
    throw new ApiError(409, "User with email or username already exists");
  }

  const localAvatarUrl = body["avatar"];
  const localCoverImageUrl = body["coverImage"];

  let avatar: ImageKitReponse;

  if (localAvatarUrl && localAvatarUrl instanceof File) {
    avatar = await uploadOnImageKit(localAvatarUrl as File);

    if (!avatar) {
      throw new ApiError(avatar.status, avatar.message);
    }
  }

  let coverImage: ImageKitReponse;

  if (localCoverImageUrl && localCoverImageUrl instanceof File) {
    coverImage = await uploadOnImageKit(localCoverImageUrl);

    if (!coverImage.url) {
      throw new ApiError(coverImage.status, coverImage.message);
    }
  }

  const user = await db
    .insert(profile)
    .values({
      username,
      fullName,
      avatar: avatar.url,
      coverImage: coverImage.url,
    })
    .returning()
    .catch((err) => {
      throw new ApiError(500, err);
    });

  if (!user || user.length === 0) {
    throw new ApiError(500, "Failed to add user");
  }

  return c.json<SuccessResponse<z.infer<typeof createUserSchema>>>(
    {
      success: true,
      message: "Successfully added user ✨",
      data: user[0],
    },
    200,
  );
});

// -----------------------------------------
// CHANGE USERNAME
// -----------------------------------------
// app.post(
//   "/change-user-info",
//   zValidator("json", createUserSchema.pick({ username: true })),
//   async (c) => {
//         const {} = c.req.valid("json")
//     },
// );

export default router;
