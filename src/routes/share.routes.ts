import { db } from "@/db";
import { bookmark } from "@/db/schema/bookmark.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";
import { omit } from "@/utils";
import { verifyHash } from "@/utils/crypto";
import { zValidator } from "@/utils/validator-wrapper";
import { eq } from "drizzle-orm";
import z from "zod";
import { bookmarkPublicFields } from "./bookmark.routes";

const router = createRouter();

router.get(
  "folder/:publicId",
  zValidator("json", z.object({ password: z.string().optional() })),
  async (c) => {
    const source = "share.folders.get";

    const { password } = c.req.valid("json");

    const { publicId } = c.req.param();

    if (!publicId) {
      throwError("MISSING_PARAMETER", "publicId is required", source);
    }

    const target = await db.query.sharedFolder.findFirst({
      where: (sharedFolder, { eq }) => eq(sharedFolder.publicId, publicId),
      columns: {
        title: true,
        note: true,
        isPublic: true,
        isLocked: true,
        password: true,
        salt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        folder: { columns: { id: true, name: true, description: true } },
        author: { columns: { username: true, name: true } },
      },
    });

    if (!target) {
      throwError("NOT_FOUND", `Folder with id ${publicId} not found`, source);
    }

    if (!target.isPublic) {
      throwError("FORBIDDEN", "User unpublished this folder", source);
    }

    if (target.expiresAt && Date.now() > new Date(target.expiresAt).getTime()) {
      throwError(
        "FORBIDDEN",
        `This content expired at ${target.expiresAt}`,
        source,
      );
    }

    if (target.isLocked) {
      if (!password) {
        throwError("REQUIRED_FIELD", "Password is required", source);
      }

      let isValid: boolean;

      try {
        isValid = await verifyHash(password, target.password!, target.salt!);
      } catch (error) {
        console.error(error);
        throwError("INTERNAL_ERROR", "Failed to verify password", source);
      }

      if (!isValid) {
        throwError("UNAUTHORIZED", "Password is incorrect", source);
      }
    }

    const bookmarkFields = omit(bookmarkPublicFields, [
      "isArchived",
      "isEncrypted",
      "isFavourite",
      "isPinned",
      "nonce",
      "updatedAt",
    ]);

    const bookmarks = await db
      .select(bookmarkFields)
      .from(bookmark)
      .where(eq(bookmark.folderId, target.folder.id));

    return c.json<SuccessResponse<unknown>>(
      {
        success: true,
        data: Object.assign(
          {},
          {
            ...omit(target, ["isPublic"]),
            folder: omit(target.folder, ["id"]),
          },
          { bookmarks },
        ),
        message: "Successfully fetched bookmarks",
      },
      200,
    );
  },
);

export default router;
