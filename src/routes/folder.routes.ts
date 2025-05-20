import type { PublicKeyCredentialUserEntity } from "better-auth/client/plugins";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import kebabCase from "lodash.kebabcase";
import { db } from "../db";
import { folder } from "../db/schema/folder.schema";
import { folderInsertSchema } from "../db/schema/folder.schema";
import { createRouter } from "../lib/create-app";
import createFieldValidator from "../middlewares/validate-name.middleware";
import type { PaginatedSuccessResponse, SuccessResponse } from "../types";
import type { FolderType } from "../types/schema.types";
import { getPagination, getUserId } from "../utils";
import { ApiError } from "../utils/api-error";
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

const getFolderId = (c: Context) => {
  const folderIdParam = c.req.param("id");
  const folderId = Number.parseInt(folderIdParam || "", 10);

  if (!folderIdParam || Number.isNaN(folderId) || folderId <= 0) {
    throw new ApiError(400, "Id is not a valid number", "INVALID_FOLDER_ID");
  }

  return folderId;
};

const verifyFolderExistance = async (folderId: number) => {
  const data = await db.query.folder.findFirst({
    where: (folder, { eq }) => eq(folder.id, folderId),
    columns: {
      id: true,
      name: true,
      description: true,
    },
  });

  if (!data) {
    throw new ApiError(
      404,
      `Folder with id ${folderId} not found`,
      "FOLDER_NOT_FOUND",
    );
  }

  return data;
};

// -----------------------------------------
// GET ALL FOLDERS
// -----------------------------------------
router.get("/all", async (c) => {
  const userId = await getUserId(c);

  const data = await db.query.folder.findMany({
    where: (folder, { eq }) => eq(folder.userId, userId),
    columns: {
      id: true,
      name: true,
    },
  });

  if (data.length === 0) {
    throw new ApiError(
      404,
      "No folders found for the current user",
      "FOLDER_NOT_FOUND",
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
// GET FOLDERS
// -----------------------------------------
router.get("/", async (c) => {
  const { page, limit, offset } = getPagination(c.req.query());

  const userId = await getUserId(c);

  const data = await db.query.folder.findMany({
    where: (folder, { eq }) => eq(folder.userId, userId),
    limit,
    offset,
  });

  if (data.length === 0) {
    throw new ApiError(
      404,
      "No folders found for the current user",
      "FOLDER_NOT_FOUND",
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
    const { name, description } = await c.req.json();

    const userId = await getUserId(c);

    const doesFolderExists = await db.query.folder.findFirst({
      where: and(
        eq(folder.userId, userId),
        eq(folder.name, name.toLowerCase().trim()),
      ),
    });

    if (doesFolderExists) {
      throw new ApiError(
        409,
        `Folder with name ${name} already exists`,
        "FOLDER_CONFLICT",
      );
    }

    const data = await db
      .insert(folder)
      .values({
        userId,
        name,
        description,
        slug: kebabCase(name),
      })
      .returning();

    if (data.length === 0 || data[0] == null) {
      throw new ApiError(502, "Failed to add folder", "FOLDER_CREATE_FAILED");
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
    throw new ApiError(
      400,
      "Folder name and description are the same as before",
      "FOLDER_UNCHANGED",
    );
  }

  const data = await db
    .update(folder)
    .set({
      name,
      description,
      slug: kebabCase(name),
    })
    .where(and(eq(folder.userId, userId), eq(folder.id, folderId)))
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(502, "Failed to update folder", "FOLDER_UPDATE_FAILED");
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
    .where(and(eq(folder.userId, userId), eq(folder.id, folderId)))
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(500, "Failed to delete folder", "FOLDER_DELETE_FAILED");
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
