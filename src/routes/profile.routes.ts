import { db } from "../db";
import { profile } from "../db/schema/profile.schema";
import { createRouter } from "../lib/create-app";
import type { ImageKitReponse } from "../types";
import { ApiError } from "../utils/api-error";
import { uploadOnImageKit } from "../utils/imagekit";

const router = createRouter();

// -----------------------------------------
// ADD NEW USER
// -----------------------------------------
router.post("/insert", async (c) => {
  const body = await c.req.parseBody();

  const localAvatarUrl = body["avatar"];
  const localCoverImageUrl = body["coverImage"];

  let avatar: ImageKitReponse | undefined;

  if (localAvatarUrl && localAvatarUrl instanceof File) {
    avatar = await uploadOnImageKit(localAvatarUrl as File);

    if (!avatar?.url) {
      throw new ApiError(avatar?.status || 502, avatar?.message);
    }
  }

  let coverImage: ImageKitReponse | undefined;

  if (localCoverImageUrl && localCoverImageUrl instanceof File) {
    coverImage = await uploadOnImageKit(localCoverImageUrl);

    if (coverImage.url) {
      throw new ApiError(coverImage.status, coverImage.message);
    }
  }

  const user = await db
    .insert(profile)
    .values({
      avatar: avatar?.url ?? null,
      coverImage: coverImage?.url ?? null,
    })
    .returning()
    .catch((err) => {
      throw new ApiError(500, err);
    });

  if (!user || user.length === 0) {
    throw new ApiError(500, "Failed to add user");
  }

  return c.json(
    {
      success: true,
      message: "Successfully added user ✨",
      data: user[0],
    },
    200,
  );
});

export default router;
