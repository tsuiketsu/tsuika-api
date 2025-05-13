import type { Context, Next } from "hono";
import { ApiError } from "../utils/api-error";

const requireAuth = async (c: Context, next: Next) => {
  const path = c.req.path;
  const user = c.get("user");

  if (!user && !path.startsWith("/api/auth")) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  return next();
};

export default requireAuth;
