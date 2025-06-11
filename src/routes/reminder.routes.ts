import { db } from "@/db";
import { reminderInsertSehema } from "@/db/schema/reminder.schema";
import { bookmarkReminder } from "@/db/schema/reminder.schema";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";
import {
  type ContentCategoryType,
  type Reminder,
  type ReminderType,
  contentCategoryTypes as cat,
} from "@/types/schema.types";
import { getUserId } from "@/utils";
import { generatePublicId } from "@/utils/nanoid";
import { zValidator } from "@/utils/validator-wrapper";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
      "remidners.bookmarks.get",
    );
  }

  return data.id;
};

const selectPublicFields = {
  id: bookmarkReminder.publicId,
  message: bookmarkReminder.message,
  status: bookmarkReminder.status,
  priority: bookmarkReminder.priority,
  isDone: bookmarkReminder.isDone,
  remindDate: bookmarkReminder.remindDate,
  createdAt: bookmarkReminder.createdAt,
  updatedAt: bookmarkReminder.updatedAt,
} satisfies {
  [key in keyof typeof bookmarkReminder]?: unknown;
};

// -----------------------------------------
// INSERT REMINDER
// -----------------------------------------
const insertSchema = reminderInsertSehema.extend({
  type: z.enum(
    Object.values(cat) as [ContentCategoryType, ...ContentCategoryType[]],
  ),
});

router.post("/:id", zValidator("json", insertSchema), async (c) => {
  const {
    priority,
    message,
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
    .values({ publicId, userId, message, remindDate, priority, contentId })
    .returning(selectPublicFields);

  if (!data || data[0] == null) {
    throwError("INTERNAL_ERROR", "Failed to add remidner", "reminders.post");
  }

  return c.json<SuccessResponse<Reminder>>(
    {
      success: true,
      data: data[0],
      message: "Successfully added reminder",
    },
    200,
  );
});

// -----------------------------------------
// GET ALL REMINDERS
// -----------------------------------------
router.get("/", async (c) => {
  const userId = await getUserId(c);

  const data = await db
    .select(selectPublicFields)
    .from(bookmarkReminder)
    .where(eq(bookmarkReminder.userId, userId));

  if (!data || data[0] == null) {
    throwError("NOT_FOUND", "Reidners not found", "reminders.get");
  }

  return c.json<SuccessResponse<ReminderType>>(
    {
      success: true,
      data: data[0],
      message: "Successfully fetched reminders",
    },
    200,
  );
});

export default router;
