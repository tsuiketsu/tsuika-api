import type { Context, Next } from "hono";
import { throwError } from "@/errors/handlers";

const blockDemoHostMiddleware = async (c: Context, next: Next) => {
  const host = c.req.header("Origin");
  const isGet = c.req.method === "GET";

  if ((!host || host?.includes("demo")) && !isGet) {
    throwError(
      "FORBIDDEN",
      "This is a read-only demo of Tsuika, so this action isn’t available.",
      "middleware:block_demo_host",
    );
  }

  return next();
};

export default blockDemoHostMiddleware;
