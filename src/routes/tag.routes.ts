import { and, eq, ilike, sql } from "drizzle-orm";
import type { Context } from "hono";
import tinycolor from "tinycolor2";
import { db } from "../db";
import { tag, tagInsertSchema, tagUpdateSchema } from "../db/schema/tag.schema";
import { createRouter } from "../lib/create-app";
import type { PaginatedSuccessResponse, SuccessResponse } from "../types";
import type { TagType } from "../types/schema.types";
import { getPagination, getUserId } from "../utils";
import { ApiError } from "../utils/api-error";
import { zValidator } from "../utils/validator-wrapper";

const router = createRouter();

const getTagId = async (c: Context) => {
  const userId = await getUserId(c);
  const tagId = Number.parseInt(c.req.param("id"));

  if (!tagId) {
    throw new ApiError(400, "Tag ID is required");
  }

  const isTagExists = await db.query.tag.findFirst({
    where: and(eq(tag.userId, userId), eq(tag.id, tagId)),
  });

  if (!isTagExists) {
    throw new ApiError(402, `Tag with id ${tagId} not found`);
  }

  return tagId;
};

// -----------------------------------------
// ADD NEW TAG
// -----------------------------------------
router.post("/", zValidator("json", tagInsertSchema), async (c) => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  const { name, color } = c.req.valid("json");

  const isTagExists = await db.query.tag.findFirst({
    where: eq(tag.name, name.toLowerCase().trim()),
  });

  if (isTagExists) {
    throw new ApiError(
      409,
      `Tag with name "${name.toLowerCase()}" already found`,
    );
  }

  if (!tinycolor(color).isValid()) {
    throw new ApiError(400, "Color must be a valid CSS color value");
  }

  const data: TagType[] = await db
    .insert(tag)
    .values({ userId, name: name.toLowerCase(), color })
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(502, "Failed to add tag");
  }

  return c.json<SuccessResponse<TagType>>({
    success: true,
    message: "Successfully added tag",
    data: data[0],
  });
});

// -----------------------------------------
// GET ALL TAGS
// -----------------------------------------
router.get("/", async (c) => {
  const userId = await getUserId(c);

  const { offset, limit, page } = getPagination(c.req.query());

  const data = await db.query.tag.findMany({
    where: eq(tag.userId, userId),
    columns: { userId: false },
    offset,
    limit,
  });

  if (data.length === 0) {
    throw new ApiError(400, "No tags found");
  }

  return c.json<PaginatedSuccessResponse<Omit<TagType, "userId">[]>>(
    {
      success: true,
      message: "Successfully fetched all tags",
      data,
      patination: {
        page,
        limit,
        total: data.length,
        hasMore: data.length === limit,
      },
    },
    200,
  );
});

// -----------------------------------------
// SEARCH TAG
// -----------------------------------------
router.get("/search", async (c) => {
  const userId = await getUserId(c);

  const id = c.req.query("id");
  const name = c.req.query("name")?.toLowerCase().trim();

  if (!(name || id)) {
    throw new ApiError(
      400,
      "Missing required parameter: either `name` or `id` must be provided. " +
        "If both are provided, `id` will take priority.",
    );
  }

  let data: Omit<TagType, "userId"> | undefined;

  if (id) {
    const parsedId = Number.parseInt(id);

    if (Number.isNaN(parsedId)) {
      throw new ApiError(400, "Tag ID must be a valid number.");
    }

    data = await db.query.tag.findFirst({
      where: and(eq(tag.userId, userId), eq(tag.id, parsedId)),
      columns: {
        userId: false,
      },
    });
  } else if (name) {
    data = await db.query.tag.findFirst({
      where: and(eq(tag.userId, userId), ilike(tag.name, `%${name}%`)),
      columns: {
        userId: false,
      },
    });
  }

  if (!data) {
    throw new ApiError(400, "Tag not found");
  }

  console.log(data);

  return c.json<SuccessResponse<Omit<TagType, "userId">>>(
    {
      success: true,
      message: "Successfully fetched tag",
      data,
    },
    200,
  );
});

// -----------------------------------------
// UPDATE TAG
// -----------------------------------------
router.put(":id", zValidator("json", tagUpdateSchema), async (c) => {
  const { name, color } = c.req.valid("json");

  const userId = await getUserId(c);
  const tagId = await getTagId(c);

  const data: TagType[] = await db
    .update(tag)
    .set({
      name,
      color,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(tag.userId, userId), eq(tag.id, tagId)))
    .returning();

  if (data.length === 0 || data[0] == null) {
    throw new ApiError(502, "Failed to update tag");
  }

  return c.json<SuccessResponse<TagType>>(
    {
      success: true,
      message: "Successfully updated tag",
      data: data[0],
    },
    200,
  );
});

// -----------------------------------------
// DELETE TAG
// -----------------------------------------
router.delete(":id", async (c) => {
  const userId = await getUserId(c);
  const tagId = await getTagId(c);

  const result = await db
    .delete(tag)
    .where(and(eq(tag.userId, userId), eq(tag.id, tagId)));

  if (result.rowCount === 0) {
    throw new ApiError(502, "Failed to delete tag");
  }

  return c.json<SuccessResponse>(
    { success: true, message: "Successfully deleted tag" },
    200,
  );
});

export default router;
