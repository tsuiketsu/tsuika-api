import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

class ApiError extends HTTPException {
  constructor(
    statusCode: ContentfulStatusCode,
    message = "An error occurred",
    code?: string,
    errors: Error[] = [],
  ) {
    super(statusCode, {
      res: new Response(
        JSON.stringify({
          success: false,
          message,
          code,
          data: null,
          errors: errors.map((e) => ({
            message: e.message,
            stack: e.stack,
          })),
        }),
        {
          status: statusCode,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    });
  }
}

export { ApiError };
