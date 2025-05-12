import { logger } from "hono/logger";
import createApp from "./lib/create-app";

const app = createApp();

// Middlewares
app.use(logger());

// Routes imports
import { auth, profile } from "./routes";

app.basePath("/api/v1").route("/", auth).route("/profiles", profile);

export { app };
