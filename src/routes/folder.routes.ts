import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
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

const getFolderId = (c: Context): string => {
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

export const folderPublicFields = {
  id: folder.publicId,
  name: folder.name,
  description: folder.description,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
  keyDerivation: folder.keyDerivation,
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

  console.log(data);

  // const data = await db.select()

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
    .where(and(whereUserId(userId), condition))
    .leftJoin(
      sharedFolder,
      and(whereUserId(userId), eq(sharedFolder.folderId, folder.id)),
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
      data,
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
    const { name, description, keyDerivation } = c.req.valid("json");

    if (keyDerivation) {
      const missingFields = Object.entries(keyDerivation)
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
        keyDerivation,
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
router.put(":id", zValidator("json", folderInsertSchema), async (c) => {
  const { name, description } = c.req.valid("json");

  const folderId = getFolderId(c);
  const userId = await getUserId(c);

  const { name: folderName, description: folderDesc } =
    await verifyFolderExistance(folderId);

  if (folderName === name.trim() && folderDesc === description?.trim()) {
    throwError(
      "CONFLICT",
      "Folder name and description are the same as before",
      "folders.post",
    );
  }

  const data = await db
    .update(folder)
    .set({
      name: name.trim(),
      description: description?.trim(),
    })
    .where(and(eq(folder.userId, userId), eq(folder.publicId, folderId)))
    .returning(folderPublicFields);

  if (data.length === 0 || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to update folder", "folders.put");
  }

  return c.json<SuccessResponse<FolderType>>(
    {
      success: true,
      message: "Successfully updated folder",
      data: data[0],
    },
    200,
  );
});

// -----------------------------------------
// DELETE FOLDER
// -----------------------------------------
router.delete(":id", async (c) => {
  const folderId = getFolderId(c);
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

export default router;
