import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema/users.schema";
import {
  type ImageKitReponse,
  type SuccessResponse,
  createUserSchema,
} from "../types/schema.types";
import { ApiError } from "../utils/api-error";
import { uploadOnImageKit } from "../utils/imagekit";
import { zValidator } from "../utils/validator-wrapper";

const app = new Hono();

// -----------------------------------------
// ADD NEW USER
// -----------------------------------------
app.post("/add", zValidator("form", createUserSchema), async (c) => {
  const { username, email, fullName } = c.req.valid("form");

  const body = await c.req.parseBody();

  const isUserExists = await db.query.users.findFirst({
    where: or(eq(users.username, username), eq(users.email, email)),
    columns: { userId: true },
  });

  console.log(isUserExists);

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
    .insert(users)
    .values({
      // FIX: Random authId is tempurary
      authId: crypto.randomUUID(),
      username,
      email,
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

  user[0].authId = undefined;

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

export default app;
