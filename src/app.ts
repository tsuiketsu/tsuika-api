import { cors } from "hono/cors";
import { logger } from "hono/logger";
import createApp from "./lib/create-app";
import requireAuth from "./middlewares/require-auth.middleware";
import addSession from "./middlewares/session.middleware";

const app = createApp();

// Middlewares
app.use(logger());
app.use("*", addSession);
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "PATCH", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);
app.use("*", requireAuth);

// Routes imports
import { auth, bookmark, profile, tag } from "./routes";

app.route("/api", auth);

const routes = { profile, bookmark, tag } as const;

for (const [key, value] of Object.entries(routes)) {
  app.basePath("/api/v1").route(`/${key}s`, value);
}

// -----------------------------------------
// GET USER SESSION
// -----------------------------------------
app.get("/api/session", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!user) return c.body(null, 401);

  return c.json({
    session,
    user,
  });
});

export { app };
