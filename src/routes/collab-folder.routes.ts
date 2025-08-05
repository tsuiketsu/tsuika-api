import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schema/auth.schema";
import { collabFolder as cFolder } from "@/db/schema/collab-folder.schema";
import { folder } from "@/db/schema/folder.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import { getFolderId } from "@/lib/folder.utils";
import type { SuccessResponse } from "@/types";
import { getUserId, omit } from "@/utils";
import { generatePublicId } from "@/utils/nanoid";
import { zValidator } from "@/utils/validator-wrapper";

const router = createRouter();

// Gets user by either username or email
const getUserByIdentifier = async (identifier: string) => {
  return await db.query.user.findFirst({
    where: (user, { or, eq }) => {
      return or(eq(user.username, identifier), eq(user.email, identifier));
    },
    columns: {
      id: true,
      username: true,
      email: true,
      image: true,
    },
  });
};

// -----------------------------------------
// INSERT USER INTO COLLAB-FOLDERS TABLE
// -----------------------------------------
const insertSchema = z.object({
  identifier: z.string(),
  folderPublicId: z.string(),
  permissionLevel: z.enum(["viewer", "editor", "admin"]),
});

router.post("/", zValidator("json", insertSchema), async (c) => {
  const source = "collab-folders.post";

  const { folderPublicId, identifier, permissionLevel } = c.req.valid("json");

  // Check and get user id the folder to be collaborated with
  const sharedWithUser = await getUserByIdentifier(identifier);

  if (!sharedWithUser || !sharedWithUser.id) {
    throwError("NOT_FOUND", "User not found", source);
  }

  // Get folder id
  const userId = await getUserId(c);
  const folderId = await getFolderId(userId, folderPublicId);

  // Check if user already added to folder
  const userAlreadyAdded = await db.query.collabFolder.findFirst({
    where: and(
      eq(cFolder.folderId, folderId),
      eq(cFolder.sharedWithUserId, sharedWithUser.id),
    ),
    columns: { id: true },
  });

  if (userAlreadyAdded) {
    throwError("CONFLICT", "User already added to folder", source);
  }

  const data = await db
    .insert(cFolder)
    .values({
      publicId: generatePublicId(),
      ownerUserId: userId,
      sharedWithUserId: sharedWithUser.id,
      folderId,
      permissionLevel,
    })
    .onConflictDoNothing()
    .returning({
      id: cFolder.publicId,
    });

  if (!data || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to add user", source);
  }

  return c.json<SuccessResponse<unknown>>({
    success: true,
    data: { id: data[0].id, user: omit(sharedWithUser, ["id"]) },
    message: `User successfully added as a collaborator with '${permissionLevel}' access.`,
  });
});

// -----------------------------------------
// GET MEMBERS BY FOLDER_ID
// -----------------------------------------
router.get("/:folderPublicId", async (c) => {
  const source = "collab-folders.get";
  const folderPublicId = c.req.param("folderPublicId");
  const userId = await getUserId(c);

  const response = await db
    .select({
      name: user.name,
      username: user.username,
      image: user.image,
      permissionLevel: cFolder.permissionLevel,
    })
    .from(cFolder)
    .innerJoin(folder, eq(cFolder.folderId, folder.id))
    .innerJoin(
      user,
      and(ne(user.id, userId), eq(user.id, cFolder.sharedWithUserId)),
    )
    .where(eq(folder.publicId, folderPublicId));

  if (!response) {
    throwError("NOT_FOUND", "Folder not found", source);
  }

  return c.json({
    success: true,
    message: "Successfully fetched users",
    data: response.map((user) => ({
      ...user,
      image: user?.image?.split("|")[1] ?? null,
    })),
  });
});

// -----------------------------------------
// CHANGE MEMBER'S PERMISSION LEVEL
// -----------------------------------------
router.patch(
  "/:folderPublicId",
  zValidator("json", insertSchema.omit({ folderPublicId: true })),
  async (c) => {
    const source = "collab-folders.patch";
    const { identifier, permissionLevel } = c.req.valid("json");

    const member = await getUserByIdentifier(identifier);

    if (!member) {
      throwError("NOT_FOUND", "User not found", source);
    }

    const selectedFolder = await db.query.folder.findFirst({
      where: eq(folder.publicId, c.req.param("folderPublicId")),
      columns: { id: true },
    });

    if (!selectedFolder) {
      throwError("NOT_FOUND", "Folder not found", source);
    }

    // Check  user's authorization level
    const selectedCollabFolder = await db.query.collabFolder.findFirst({
      where: eq(cFolder.sharedWithUserId, member.id),
      columns: { permissionLevel: true },
    });

    if (selectedCollabFolder?.permissionLevel !== "admin") {
      throwError(
        "UNAUTHORIZED",
        "Only owner or admins can change other user's permissions",
        source,
      );
    }

    const matchCondition = and(
      eq(cFolder.folderId, selectedFolder.id),
      eq(cFolder.sharedWithUserId, member.id),
    );

    const payload = {
      permissionLevel,
      updatedAt: sql`NOW()`,
    };

    const response = await db
      .update(cFolder)
      .set(payload)
      .where(matchCondition)
      .returning({
        id: cFolder.publicId,
        permissionLevel: cFolder.permissionLevel,
      });

    if (!response || response[0] == null) {
      throwError("INTERNAL_ERROR", "Failed to update permission level", source);
    }

    return c.json<SuccessResponse<unknown>>({
      success: true,
      message: `Permission level updated: now set to '${permissionLevel}'`,
      data: response[0],
    });
  },
);

export default router;
