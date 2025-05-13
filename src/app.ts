import { cors } from "hono/cors";
import { logger } from "hono/logger";
import createApp from "./lib/create-app";
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
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// Routes imports
import { auth, profile } from "./routes";

app.route("/api", auth);
app.basePath("/api/v1").route("/profiles", profile);

export { app };
