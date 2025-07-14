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
import { and, eq, sql } from "drizzle-orm";

const router = createRouter();

const sharedFolderPublicFields = {
  id: sf.publicId,
  title: sf.title,
  note: sf.note,
  isLocked: sf.isLocked,
  isPublic: sf.isPublic,
  viewCount: sf.viewCount,
  lastViewdAt: sf.lastViewdAt,
  expiresAt: sf.expiresAt,
  unpublishedAt: sf.unpublishedAt,
  createdAt: sf.createdBy,
  updatedAt: sf.updatedAt,
};

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
      isLocked,
      title,
      note,
      isPublic: true,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: sf.folderId,
      where: and(eq(sf.createdBy, userId), eq(sf.folderId, folderNumericId)),
      set: {
        password: passwordHash,
        salt: passwordSalt,
        unpublishedAt: null,
        isLocked,
        title,
        note,
        isPublic: true,
        expiresAt,
      },
    })
    .returning(sharedFolderPublicFields);

  if (!data || data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to make folder public", source);
  }

  return c.json<SuccessResponse<unknown>>(
    {
      success: true,
      data: data[0],
      message: "Successfully made folder public",
    },
    200,
  );
});

// -----------------------------------------
// GET SHARED FOLDER INFO
// -----------------------------------------
router.get("/:publicId", async (c) => {
  const source = "shared-folders.get";
  const publicId = c.req.param("publicId");

  if (!publicId) {
    throwError("MISSING_PARAMETER", "publicId is missing", source);
  }

  const userId = await getUserId(c);

  const data = await db
    .select(sharedFolderPublicFields)
    .from(sf)
    .where(and(eq(sf.createdBy, userId), eq(sf.publicId, publicId)));

  if (!data) {
    throwError("INTERNAL_ERROR", "Failed to fetch shared-folder info", source);
  }

  return c.json<SuccessResponse<unknown>>(
    {
      success: true,
      data: data[0],
      message: "Successfully fetched shared-folder entry",
    },
    200,
  );
});

// -----------------------------------------
// UN-PUBLISH FOLDER
// -----------------------------------------
router.patch("/:publicId/unpublish", async (c) => {
  const publicId = c.req.param("publicId");
  const userId = await getUserId(c);

  const data = await db
    .update(sf)
    .set({
      isPublic: false,
      expiresAt: null,
      unpublishedAt: sql`NOW()`,
    })
    .where(and(eq(sf.createdBy, userId), eq(sf.publicId, publicId)))
    .returning({
      id: sf.publicId,
    });

  if (!data || data[0] == null) {
    throwError(
      "INTERNAL_ERROR",
      "Failed to un-publish folder",
      "shared-folders.patch",
    );
  }

  return c.json<SuccessResponse<{ id: string }>>(
    {
      success: true,
      data: data[0],
      message: "Successfully unpublished folder",
    },
    200,
  );
});

export default router;
