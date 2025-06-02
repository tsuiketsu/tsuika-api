import { db } from "@/db";
import { createRouter } from "@/lib/create-app";
import type { SuccessResponse } from "@/types";
import { ApiError } from "@/utils/api-error";

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
    throw new ApiError(400, "ID is required", "INVALID_PARAMETERS");
  }

  const data = await db.query.verification.findFirst({
    where: (verification, { eq }) => eq(verification.id, id),
    columns: {
      identifier: true,
    },
  });

  if (!data?.identifier) {
    throw new ApiError(
      404,
      `Verification entry with id ${id} not found`,
      "VERIFICATION_NOT_FOUND",
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
