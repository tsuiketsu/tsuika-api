import { db } from "@/db";
import {
  sharedFolder as sf,
  sharedFolderInsertSchema,
} from "@/db/schema/shared-folder.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import { getFolderId } from "@/lib/folder.utils";
import type { SuccessResponse } from "@/types";
import { getUserId } from "@/utils";
import { hashPassword } from "@/utils/crypto";
import { generatePublicId } from "@/utils/nanoid";
import { zValidator } from "@/utils/validator-wrapper";

const router = createRouter();

// -----------------------------------------
// INSERT INTO SHARED-FOLDERS | SHARE FOLDER
// -----------------------------------------
router.post("/", zValidator("json", sharedFolderInsertSchema), async (c) => {
  const source = "shared-folder.post";

  const { folderId, title, note, isPublic, expiresAt, isLocked, password } =
    c.req.valid("json");

  const userId = await getUserId(c);
  const folderNumericId = await getFolderId(userId, folderId);

  let passwordHash = null;
  let passwordSalt = null;

  if (password) {
    const errorMsg = "Failed to generate password hash";
    try {
      const { salt, hash } = await hashPassword(password);

      if (!salt || !hash) {
        throwError("INTERNAL_ERROR", errorMsg, source);
      }

      passwordSalt = salt;
      passwordHash = hash;
    } catch (error) {
      console.error("Error generating password hash:", error);
      throwError("INTERNAL_ERROR", errorMsg, source);
    }
  }

  const data = await db
    .insert(sf)
    .values({
      folderId: folderNumericId,
      publicId: generatePublicId(),
      createdBy: userId,
      password: passwordHash,
      salt: passwordSalt,
      unpublishedAt: null, // handles re-publish
      isLocked,
      title,
      note,
      isPublic,
      expiresAt,
    })
    .returning({
      isPublic: sf.isPublic,
      publicId: sf.publicId,
    });

  if (!data || data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to make folder public", source);
  }

  return c.json<SuccessResponse<{ isPublic: boolean; publicId: string }>>(
    {
      success: true,
      data: data[0],
      message: "Successfully made folder public",
    },
    200,
  );
});

export default router;
