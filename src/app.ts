import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use("/public/temp/*", serveStatic({ root: "./" }));
// FIX: Figure these out later
// app.use(csrf({ origin: process.env.FRONTEND_ORIGIN }));
// app.use(
//   bodyLimit({
//     maxSize: 16 * 1024,
//     onError: (c) => {
//       return c.text("Data exceeded 16Kb limit :(", 413);
//     },
//   }),
// );

// Routes imports
import users from "./routes/users.routes";

// Routes
app.route("/api/v1/users", users);

export { app };
