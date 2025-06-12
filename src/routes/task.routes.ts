import { db } from "@/db";
import { bookmark } from "@/db/schema/bookmark.schema";
import { bookmarkTaskInsertSchema } from "@/db/schema/task.schema";
import { bookmarkTask } from "@/db/schema/task.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { PaginatedSuccessResponse, SuccessResponse } from "@/types";
import {
  type ContentCategoryType,
  type Task,
  type TaskType,
  contentCategoryTypes as cat,
  contentCategoryTypes,
} from "@/types/schema.types";
import { getPagination, getUserId, pick } from "@/utils";
import { generatePublicId } from "@/utils/nanoid";
import { zValidator } from "@/utils/validator-wrapper";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { bookmarkPublicFields } from "./bookmark.routes";

const router = createRouter();

const getContentRowId = async (
  userId: string,
  publicId: string,
  type: ContentCategoryType,
): Promise<number> => {
  let data: { id: number } | undefined;

  if (type === cat.BOOKMARK) {
    data = await db.query.bookmark.findFirst({
      where: (b, { and, eq }) =>
        and(eq(b.userId, userId), eq(b.publicId, publicId)),
      columns: { id: true },
    });
  }

  if (!data || !data.id) {
    throwError(
      "NOT_FOUND",
      `Bookmark with id ${publicId} not found`,
      "tasks.bookmarks.get",
    );
  }

  return data.id;
};

const whereUserId = (userId: string) => eq(bookmarkTask.userId, userId);
const wherePublicId = (id: string) => eq(bookmarkTask.publicId, id);

const selectPublicFields = {
  id: bookmarkTask.publicId,
  note: bookmarkTask.note,
  status: bookmarkTask.status,
  priority: bookmarkTask.priority,
  isDone: bookmarkTask.isDone,
  remindAt: bookmarkTask.remindAt,
  createdAt: bookmarkTask.createdAt,
  updatedAt: bookmarkTask.updatedAt,
} satisfies {
  [key in keyof typeof bookmarkTask]?: unknown;
};

export const contentPublicFields = {
  bookmark: pick(bookmarkPublicFields, [
    "title",
    "description",
    "url",
    "faviconUrl",
  ]),
} satisfies Partial<Record<ContentCategoryType, unknown>>;

// -----------------------------------------
// INSERT TASK
// -----------------------------------------
const insertSchema = bookmarkTaskInsertSchema.extend({
  type: z.enum(
    Object.values(cat) as [ContentCategoryType, ...ContentCategoryType[]],
  ),
});

router.post("/:id", zValidator("json", insertSchema), async (c) => {
  const { priority, note, remindAt: reminderDate, type } = c.req.valid("json");

  const contentPublicId = c.req.param("id");

  const userId = await getUserId(c);

  const contentId = await getContentRowId(userId, contentPublicId, type);
  const publicId = generatePublicId();
  const remindAt = new Date(reminderDate);

  const taskRow = await db.query.bookmarkTask.findFirst({
    where: (r, { and, eq }) => and(eq(r.userId, userId)),
    columns: { id: true },
  });

  if (typeof taskRow !== "undefined") {
    throwError("CONFLICT", "Task already exists", "tasks.post");
  }

  const data = await db
    .insert(bookmarkTask)
    .values({ publicId, userId, note, remindAt, priority, contentId })
    .returning(selectPublicFields);

  if (!data || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to add task", "tasks.post");
  }

  return c.json<SuccessResponse<Task>>(
    {
      success: true,
      data: { ...data[0], type },
      message: "Successfully added task",
    },
    200,
  );
});

// -----------------------------------------
// GET ALL TASKS
// -----------------------------------------
router.get("/", async (c) => {
  const { page, limit, offset } = getPagination(c.req.query());
  const userId = await getUserId(c);

  const data = await db
    .select({
      ...selectPublicFields,
      content: contentPublicFields.bookmark,
    })
    .from(bookmarkTask)
    .where(eq(bookmarkTask.userId, userId))
    .leftJoin(bookmark, eq(bookmark.id, bookmarkTask.contentId))
    .offset(offset)
    .limit(limit);

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "Tasks not found", "tasks.get");
  }

  return c.json<PaginatedSuccessResponse<Task[]>>(
    {
      success: true,
      message: "Successfully fetched tasks",
      data: data.map((item) => ({
        ...item,
        type: contentCategoryTypes.BOOKMARK,
      })),
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
// UPDATE TASK
// -----------------------------------------
router.put("/:id", zValidator("json", bookmarkTaskInsertSchema), async (c) => {
  const { note, remindAt: remindAtStr, priority } = c.req.valid("json");
  const userId = await getUserId(c);

  const publicId = c.req.param("id");

  if (!publicId) {
    throwError("REQUIRED_FIELD", "id is required", "tasks.put");
  }

  const remindAt = new Date(remindAtStr);

  if (Number.isNaN(remindAt.getTime())) {
    throwError(
      "INVALID_PARAMETER",
      "remindAt is a invalid date string",
      "tasks.put",
    );
  }

  const data = await db
    .update(bookmarkTask)
    .set({ note, remindAt, priority })
    .where(and(whereUserId(userId), wherePublicId(publicId)))
    .returning(selectPublicFields);

  if (!data || data[0] == null) {
    throwError(
      "INTERNAL_ERROR",
      `Failed to update task with id "${publicId}"`,
      "tasks.get",
    );
  }

  return c.json<SuccessResponse<TaskType>>(
    {
      success: true,
      data: data[0],
      message: "Successfully updated task",
    },
    200,
  );
});

export default router;
