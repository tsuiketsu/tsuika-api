import type { Context, Next } from "hono";
import { ApiError } from "../utils/api-error";

const ignoreList = ["/api/auth", "/api/verification-email"];

const requireAuth = async (c: Context, next: Next) => {
  const path = c.req.path;
  const user = c.get("user");

  if (!user && !ignoreList.some((route) => path.startsWith(route))) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  return next();
};

export default requireAuth;
