import type { ContentfulStatusCode } from "hono/utils/http-status";
import { userInsertSchema } from "../db/schema/users.schema";

export const createUserSchema = userInsertSchema.pick({
  username: true,
  fullName: true,
  email: true,
});

export type SuccessResponse<T = void> = {
  success: true;
  message: string;
} & (T extends void ? Record<string, never> : { data: T });

export type ImageKitReponse = {
  status: ContentfulStatusCode;
  message: string;
  url: string | null;
};
