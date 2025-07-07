import { db } from "@/db";
import {
  sharedFolder,
  sharedFolderInsertSchema,
} from "@/db/schema/shared-folder.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import { getFolderId } from "@/lib/folder.utils";
import type { SuccessResponse } from "@/types";
import { getUserId } from "@/utils";
import { generatePublicId } from "@/utils/nanoid";
import { zValidator } from "@/utils/validator-wrapper";

const router = createRouter();

router.post("/", zValidator("json", sharedFolderInsertSchema), async (c) => {
  const { folderId, title, note, isPublic, expiresAt } = c.req.valid("json");

  const userId = await getUserId(c);
  const folderNumericId = await getFolderId(userId, folderId);

  const data = await db
    .insert(sharedFolder)
    .values({
      folderId: folderNumericId,
      publicId: generatePublicId(),
      createdBy: userId,
      title,
      note,
      isPublic,
      expiresAt,
    })
    .returning({
      isPublic: sharedFolder.isPublic,
      publicId: sharedFolder.publicId,
    });

  if (!data || data.length === 0 || data[0] == null) {
    throwError(
      "INTERNAL_ERROR",
      "Failed to make folder public",
      "shared_folders.post",
    );
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
