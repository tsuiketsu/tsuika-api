import { db } from "@/db";
import { bookmark } from "@/db/schema/bookmark.schema";
import { reminderInsertSchema } from "@/db/schema/reminder.schema";
import { bookmarkReminder } from "@/db/schema/reminder.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { PaginatedSuccessResponse, SuccessResponse } from "@/types";
import {
  type ContentCategoryType,
  type Reminder,
  type ReminderType,
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
      "reminders.bookmarks.get",
    );
  }

  return data.id;
};

const whereUserId = (userId: string) => eq(bookmarkReminder.userId, userId);
const wherePublicId = (id: string) => eq(bookmarkReminder.publicId, id);

const selectPublicFields = {
  id: bookmarkReminder.publicId,
  note: bookmarkReminder.note,
  status: bookmarkReminder.status,
  priority: bookmarkReminder.priority,
  isDone: bookmarkReminder.isDone,
  remindDate: bookmarkReminder.remindDate,
  createdAt: bookmarkReminder.createdAt,
  updatedAt: bookmarkReminder.updatedAt,
} satisfies {
  [key in keyof typeof bookmarkReminder]?: unknown;
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
// INSERT REMINDER
// -----------------------------------------
const insertSchema = reminderInsertSchema.extend({
  type: z.enum(
    Object.values(cat) as [ContentCategoryType, ...ContentCategoryType[]],
  ),
});

router.post("/:id", zValidator("json", insertSchema), async (c) => {
  const {
    priority,
    note,
    remindDate: reminderDate,
    type,
  } = c.req.valid("json");

  const contentPublicId = c.req.param("id");

  const userId = await getUserId(c);

  const contentId = await getContentRowId(userId, contentPublicId, type);
  const publicId = generatePublicId();
  const remindDate = new Date(reminderDate);

  const reminderRow = await db.query.bookmarkReminder.findFirst({
    where: (r, { and, eq }) => and(eq(r.userId, userId)),
    columns: { id: true },
  });

  if (typeof reminderRow !== "undefined") {
    throwError("CONFLICT", "Reminder already exists", "reminders.post");
  }

  const data = await db
    .insert(bookmarkReminder)
    .values({ publicId, userId, note, remindDate, priority, contentId })
    .returning(selectPublicFields);

  if (!data || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to add reminder", "reminders.post");
  }

  return c.json<SuccessResponse<Reminder>>(
    {
      success: true,
      data: { ...data[0], type },
      message: "Successfully added reminder",
    },
    200,
  );
});

// -----------------------------------------
// GET ALL REMINDERS
// -----------------------------------------
router.get("/", async (c) => {
  const { page, limit, offset } = getPagination(c.req.query());
  const userId = await getUserId(c);

  const data = await db
    .select({
      ...selectPublicFields,
      content: contentPublicFields.bookmark,
    })
    .from(bookmarkReminder)
    .where(eq(bookmarkReminder.userId, userId))
    .leftJoin(bookmark, eq(bookmark.id, bookmarkReminder.contentId))
    .offset(offset)
    .limit(limit);

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "Reminders not found", "reminders.get");
  }

  return c.json<PaginatedSuccessResponse<Reminder[]>>(
    {
      success: true,
      message: "Successfully fetched reminders",
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
// UPDATE REMINDER
// -----------------------------------------
router.put("/:id", zValidator("json", reminderInsertSchema), async (c) => {
  const { note, remindDate: remindDateStr, priority } = c.req.valid("json");
  const userId = await getUserId(c);

  const publicId = c.req.param("id");

  if (!publicId) {
    throwError("REQUIRED_FIELD", "id is required", "reminders.put");
  }

  const remindDate = new Date(remindDateStr);

  if (Number.isNaN(remindDate.getTime())) {
    throwError(
      "INVALID_PARAMETER",
      "remindDate is a invalid date string",
      "reminders.put",
    );
  }

  const data = await db
    .update(bookmarkReminder)
    .set({ note, remindDate, priority })
    .where(and(whereUserId(userId), wherePublicId(publicId)))
    .returning(selectPublicFields);

  if (!data || data[0] == null) {
    throwError(
      "INTERNAL_ERROR",
      `Failed to update reminder with id "${publicId}"`,
      "reminders.get",
    );
  }

  return c.json<SuccessResponse<ReminderType>>(
    {
      success: true,
      data: data[0],
      message: "Successfully updated reminder",
    },
    200,
  );
});

export default router;
