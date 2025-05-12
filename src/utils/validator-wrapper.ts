import { zValidator as zv } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodSchema } from "zod";
import { ApiError } from "./api-error";

export const zValidator = <
  T extends ZodSchema,
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: T,
) =>
  zv(target, schema, (result, _) => {
    if (!result.success) {
      throw new ApiError(400, result["error"]);
    }
  });
