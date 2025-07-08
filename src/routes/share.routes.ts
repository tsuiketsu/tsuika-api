import { db } from "@/db";
import { bookmark } from "@/db/schema/bookmark.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";
import { omit } from "@/utils";
import { eq } from "drizzle-orm";
import { bookmarkPublicFields } from "./bookmark.routes";

const router = createRouter();

router.get("folder/:publicId", async (c) => {
  const source = "share.folders.get";

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
});

export default router;
