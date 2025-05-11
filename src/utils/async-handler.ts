import type { Context, Next } from "hono";

const asyncHandler = (
  handler: (c: Context, next: Next) => Promise<Response>,
) => {
  return async (c: Context, next: Next): Promise<Response> => {
    return await handler(c, next);
  };
};

export default asyncHandler;
