import { db } from "@/db";
import { throwError } from "@/errors/handlers";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";

const router = createRouter();

// -----------------------------------------
// GET USER SESSION
// -----------------------------------------
router.get("/session", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!user) return c.body(null, 401);

  return c.json({
    session,
    user,
  });
});

router.get("/verification-email/:id", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throwError("REQUIRED_FIELD", "ID is required", "verifications.get");
  }

  const data = await db.query.verification.findFirst({
    where: (verification, { eq }) => eq(verification.id, id),
    columns: {
      identifier: true,
    },
  });

  if (!data?.identifier) {
    throwError(
      "NOT_FOUND",
      `Verification entry with id ${id} not found`,
      "verifications.get",
    );
  }

  return c.json<SuccessResponse<{ email: string }>>({
    success: true,
    message: "Successfully fetched email from verification entry",
    data: {
      email: data.identifier.replace("email-verification-otp-", ""),
    },
  });
});

export default router;
