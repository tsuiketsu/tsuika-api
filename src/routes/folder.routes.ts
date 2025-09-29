import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { collabFolder } from "@/db/schema/collab-folder.schema";
import { sharedFolder } from "@/db/schema/shared-folder.schema";
import { throwError } from "@/errors/handlers";
import { generatePublicId } from "@/utils/nanoid";
import { db } from "../db";
import { folder, folderInsertSchema } from "../db/schema/folder.schema";
import { createRouter } from "../lib/create-app";
import createFieldValidator from "../middlewares/validate-name.middleware";
import type { PaginatedSuccessResponse, SuccessResponse } from "../types";
import type { FolderType } from "../types/schema.types";
import { getPagination, getUserId, pick } from "../utils";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

const validateFolderName = createFieldValidator({
  fieldName: "name",
  maxLength: 50,
  get errorMessages() {
    return {
      maxLength: `Name exceeds the max allowed length of ${this.maxLength} characters`,
    };
  },
  errorCodes: {
    maxLength: "FOLDER_NAME_TOO_LONG",
  },
});

const getFolderIdParam = (c: Context): string => {
  const folderId = c.req.param("id");

  if (!folderId) {
    throwError("INVALID_PARAMETER", "Id is not a valid number", "folders.get");
  }

  return folderId;
};

const verifyFolderExistance = async (folderId: string) => {
  const data = await db.query.folder.findFirst({
    where: (folder, { eq }) => eq(folder.publicId, folderId),
    columns: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (!data) {
    throwError(
      "NOT_FOUND",
      `Folder with id ${folderId} not found`,
      "folders.get",
    );
  }

  return data;
};

const whereUserId = (userId: string) => {
  return eq(folder.userId, userId);
};

export const getFolder = async (
  folderId: string | undefined,
  userId: string,
) => {
  if (!folderId) return;

  const isFolderSharedWithUser = and(
    eq(folder.id, collabFolder.folderId),
    eq(collabFolder.sharedWithUserId, userId),
  );

  // Check folder accessibility by userId and if shared with
  const isAccessibleFolderByUser = and(
    or(eq(folder.userId, userId), eq(collabFolder.sharedWithUserId, userId)),
    eq(folder.publicId, folderId),
  );

  const data = await db
    .select({ id: folder.id, permissionLevel: collabFolder.permissionLevel })
    .from(folder)
    .leftJoin(collabFolder, isFolderSharedWithUser)
    .where(isAccessibleFolderByUser);

  if (!data || data[0] == null || !data[0]?.id) {
    throwError("NOT_FOUND", `Failed to get folder by id ${folderId}`, "");
  }

  return data[0];
};

export const verifyUserAuthorization = async (c: Context, next: Next) => {
  const publicId = c.req.param("id");
  const userId = await getUserId(c);

  const folder = await getFolder(publicId, userId);

  const role = folder?.permissionLevel;
  const isAdmin = folder?.permissionLevel === "admin";

  if (role == null || isAdmin) {
    return next();
  }

  throwError("UNAUTHORIZED", "Action not permitted", "");
};

export const folderPublicFields = {
  id: folder.publicId,
  name: folder.name,
  description: folder.description,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
  settings: folder.settings,
} as const;

export const folderSelectPublicFields = {
  ...folderPublicFields,
  ...pick(sharedFolder, [
    "isPublic",
    "isLocked",
    "publicId",
    "expiresAt",
    "viewCount",
  ]),
} as const;

// -----------------------------------------
// GET ALL FOLDERS
// -----------------------------------------
router.get("/all", async (c) => {
  const userId = await getUserId(c);

  const data = await db
    .select(folderSelectPublicFields)
    .from(folder)
    .where(whereUserId(userId))
    .leftJoin(
      sharedFolder,
      and(whereUserId(userId), eq(sharedFolder.folderId, folder.id)),
    );

  if (data.length === 0) {
    throwError(
      "NOT_FOUND",
      "No folders found for the current user",
      "folders.get",
    );
  }

  return c.json<SuccessResponse<Pick<FolderType, "id" | "name">[]>>(
    {
      success: true,
      message: "Successfully fetched folders",
      data,
    },
    200,
  );
});

// -----------------------------------------
// GET TOTAL FOLDERS COUNT
// -----------------------------------------
router.get("/total-count", async (c) => {
  const userId = await getUserId(c);

  const data = await db
    .select({ count: sql<number>`count(*)` })
    .from(folder)
    .where(eq(folder.userId, userId));

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "No folders found", "FOLDER_NOT_FOUND");
  }

  return c.json<SuccessResponse<{ total: number }>>(
    {
      success: true,
      data: { total: data[0].count },
      message: "Successfully fetched total folders count",
    },
    200,
  );
});

// -----------------------------------------
// GET FOLDERS
// -----------------------------------------
router.get("/", async (c) => {
  const { page, limit, offset } = getPagination(c.req.query());

  const folderIds = new URL(c.req.url).searchParams.getAll("id");

  const userId = await getUserId(c);

  let condition: SQL<unknown> | undefined;

  if (folderIds && folderIds.length > 0) {
    condition = inArray(folder.publicId, folderIds);
  }

  const data = await db
    .select(folderSelectPublicFields)
    .from(folder)
    .leftJoin(collabFolder, eq(collabFolder.folderId, folder.id))
    .leftJoin(
      sharedFolder,
      and(whereUserId(userId), eq(sharedFolder.folderId, folder.id)),
    )
    .where(
      and(
        or(whereUserId(userId), eq(collabFolder.sharedWithUserId, userId)),
        condition,
      ),
    )
    .limit(limit)
    .offset(offset);

  if (data.length === 0) {
    throwError(
      "NOT_FOUND",
      "No folders found for the current user",
      "folders.get",
    );
  }

  return c.json<PaginatedSuccessResponse<FolderType[]>>(
    {
      success: true,
      message: "Successfully fetched folders",
      // Get rid of duplicated caused by collabFolder join, maybe fix that
      // in query if there's a way
      data: data.reduce((acc, folder) => {
        if (!acc.some(({ id }) => id === folder.id)) {
          acc.push(folder as FolderType);
        }

        return acc;
      }, [] as FolderType[]),
      pagination: {
        page,
        limit,
        hasMore: data.length === limit,
        total: data.length,
      },
    },
    200,
  );
});

// -----------------------------------------
// ADD NEW FOLDER
// -----------------------------------------
router.post(
  "/",
  zValidator("json", folderInsertSchema),
  validateFolderName,
  async (c) => {
    const { name, description, settings } = c.req.valid("json");

    if (settings?.keyDerivation) {
      const missingFields = Object.entries(settings.keyDerivation)
        .filter(([, value]) => value.toString() === "")
        .map(([key]) => key);

      if (missingFields.length > 0) {
        throwError(
          "MISSING_PARAMETER",
          `Missing: ${missingFields.join(", ")}`,
          "folders.post",
        );
      }
    }

    const userId = await getUserId(c);

    const doesFolderExists = await db.query.folder.findFirst({
      where: and(
        eq(folder.userId, userId),
        eq(folder.name, name.toLowerCase().trim()),
      ),
    });

    if (doesFolderExists) {
      throwError(
        "CONFLICT",
        `Folder with name ${name} already exists`,
        "folders.post",
      );
    }

    const data = await db
      .insert(folder)
      .values({
        publicId: generatePublicId(),
        userId,
        name: name.trim(),
        description: description?.trim(),
        settings,
      })
      .returning(folderPublicFields);

    if (data.length === 0 || data[0] == null) {
      throwError("INTERNAL_ERROR", "Failed to add folder", "folders.post");
    }

    return c.json<SuccessResponse<FolderType>>(
      {
        success: true,
        data: data[0],
        message: "Successfully added folder",
      },
      200,
    );
  },
);

// -----------------------------------------
// UPDATE FOLDER
// -----------------------------------------
router.put(
  ":id",
  zValidator("json", folderInsertSchema),
  validateFolderName,
  verifyUserAuthorization,
  async (c) => {
    const source = "folders.post";
    const folderId = getFolderIdParam(c);

    const { name, description, settings } = c.req.valid("json");

    await verifyFolderExistance(folderId);

    const data = await db.execute(sql`
        UPDATE folders
        SET name = ${name.trim()},
            description = ${description?.trim()},
            settings = settings || ${settings},
            updated_at = NOW()
        WHERE folders.public_id = ${folderId}
        RETURNING 
            folders.public_id AS id,
            folders.name as name,
            folders.description as description,
            folders.created_at as createdAt,
            folders.updated_at as updatedAt,
            folders.settings as settings;
    `);

    if (data.rows.length === 0 || data.rows[0] == null) {
      throwError("INTERNAL_ERROR", "Failed to update folder", source);
    }

    return c.json<SuccessResponse<FolderType>>(
      {
        success: true,
        message: "Successfully updated folder",
        data: data.rows[0] as FolderType,
      },
      200,
    );
  },
);

// -----------------------------------------
// DELETE FOLDER
// -----------------------------------------
router.delete(":id", async (c) => {
  const folderId = getFolderIdParam(c);
  const userId = await getUserId(c);

  void (await verifyFolderExistance(folderId));

  const data = await db
    .delete(folder)
    .where(and(eq(folder.userId, userId), eq(folder.publicId, folderId)))
    .returning(folderPublicFields);

  if (data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to delete folder", "folders.delete");
  }

  return c.json<SuccessResponse<FolderType>>(
    {
      success: true,
      message: "Successfully deleted selected folder",
      data: data[0],
    },
    200,
  );
});

// -----------------------------------------
// GET FOLDERS
// -----------------------------------------
router.get("/collborative", async (c) => {
  const userId = await getUserId(c);

  const data = await db.query.collabFolder.findMany({
    where: (f, { eq }) => eq(f.sharedWithUserId, userId),
    with: {
      folder: true,
      owner: {
        columns: {
          name: true,
          username: true,
          image: true,
        },
      },
    },
    columns: {
      permissionLevel: true,
    },
  });

  return c.json<SuccessResponse<unknown>>({
    success: true,
    message: "Successfully fetched all shared folders",
    data,
  });
});

export default router;
