import type { z } from "@hono/zod-openapi";
import type { ErrorCodeKey } from "@/errors/types";
import { addExamples } from "@/utils/zod-utils";
import { errorSchema, paginationSchema, successSchema } from "./common/schema";

export function createErrorObject({
  desc,
  ...examples
}: { source: string; desc?: string } & Partial<
  Omit<z.infer<typeof errorSchema>, "data" | "code">
> & { code: ErrorCodeKey }) {
  return {
    description: desc ?? examples.message ?? "",
    content: {
      "application/json": {
        schema: addExamples(errorSchema, {
          ...examples,
        }),
      },
    },
  };
}

export function jsonContentRequired<T extends z.ZodTypeAny>(schema: T) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

export function createSuccessObject<T extends z.ZodTypeAny>({
  data,
  message,
  isPagination,
}: {
  data: T;
  message: string;
  isPagination?: boolean;
}) {
  return {
    description: message,
    content: {
      "application/json": {
        schema: addExamples(successSchema, {
          message,
        }).extend({ data, ...(isPagination && paginationSchema.shape) }),
      },
    },
  };
}

export function createUnauthorizedByRoleObject(source: string) {
  return createErrorObject({
    desc: "You have to be either owner or admin",
    message: "Action not permitted: You do not have the necessary permissions",
    code: "UNAUTHORIZED",
    source,
  });
}
