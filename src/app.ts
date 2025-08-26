import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import kebabCase from "lodash.kebabcase";
import { trustedOrigins } from "./constants";
import createApp from "./lib/create-app";
import requireAuth from "./middlewares/require-auth.middleware";
import addSession from "./middlewares/session.middleware";

const app = createApp();

// Middlewares
app.use(logger());
app.use("*", addSession);
app.use(csrf({ origin: trustedOrigins }));
app.use(
  "*",
  cors({
    origin: trustedOrigins,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "PATCH", "OPTIONS", "DELETE"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);
app.use("*", requireAuth);

// Routes imports
import * as allRoutes from "./routes";

const { auth, authData, share, ...routes } = allRoutes;

app.route("/api", auth);
app.route("/api", authData);
app.route("/api/public", share);

for (const [key, value] of Object.entries(routes)) {
  app.basePath("/api/v1").route(`/${kebabCase(key)}s`, value);
}

export { app };
