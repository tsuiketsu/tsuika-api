import type { ContentfulStatusCode } from "hono/utils/http-status";
import { profileInsertSchema } from "../db/schema/profile.schema";

export const createUserSchema = profileInsertSchema.pick({
  username: true,
  fullName: true,
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
