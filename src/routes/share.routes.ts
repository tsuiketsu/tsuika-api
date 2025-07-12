import { db } from "@/db";
import { bookmark } from "@/db/schema/bookmark.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";
import { omit } from "@/utils";
import { verifyHash } from "@/utils/crypto";
import { eq } from "drizzle-orm";
import { getCookie, setCookie } from "hono/cookie";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { bookmarkPublicFields } from "./bookmark.routes";

const router = createRouter();

// -----------------------------------------
// GET SHARED FOLDER'S CONTENT (BOOKMARKS)
// -----------------------------------------
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
    const cookie = getCookie(c, `unlock_${publicId}`);

    if (!cookie) {
      throwError("UNAUTHORIZED", "User is not authorized", source);
    }

    type Payload = {
      id: string;
      iat: number;
    };

    let payload: Payload;

    try {
      payload = jwt.verify(cookie, process.env.JWT_SECRET) as Payload;
    } catch (error) {
      throwError("UNAUTHORIZED", "Invalid or expired token", source);
    }

    const issuedAtMs = payload?.iat ? payload.iat * 1000 : 0;
    const updatedAtMs = new Date(target.updatedAt).getTime();

    const isMissingId = !payload?.id;
    const isWrongId = payload?.id !== publicId;
    const isStaleToken = updatedAtMs > issuedAtMs;

    if (isMissingId || isWrongId || isStaleToken) {
      throwError("UNAUTHORIZED", "Invalid or expired token", source);
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

  if (!bookmarks || bookmarks[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to fetch folder's data", source);
  }

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

// -----------------------------------------
// UNLOCK SHARED FOLDER IF LOCKED
// -----------------------------------------
router.post("/folder/:publicId/unlock", async (c) => {
  const source = "share.folder.unlock";
  const publicId = c.req.param("publicId");

  const { password } = await c.req.json();

  if (!password || password.trim() === "") {
    throwError("REQUIRED_FIELD", "Password is required", source);
  }

  const target = await db.query.sharedFolder.findFirst({
    where: (folder, { eq }) => eq(folder.publicId, publicId),
    columns: {
      publicId: true,
      password: true,
      salt: true,
    },
  });

  if (!target) {
    throwError("NOT_FOUND", "Requested folder not found", source);
  }

  let isValid: boolean;

  try {
    console.log("running");
    isValid = await verifyHash(password, target.password!, target.salt!);
    console.log(isValid);
  } catch (error) {
    throwError("INTERNAL_ERROR", "Failed to verify password", source);
  }

  if (!isValid) {
    throwError("UNAUTHORIZED", "Password is incorrect", source);
  }

  const token = jwt.sign({ id: target.publicId }, process.env.JWT_SECRET);

  setCookie(c, `unlock_${target.publicId}`, token, {
    secure: true,
    httpOnly: true,
    maxAge: 30 * 60 * 1000,
    sameSite: "Lax",
  });

  return c.json({ success: true, message: "Folder unlocked!" }, 200);
});

export default router;
