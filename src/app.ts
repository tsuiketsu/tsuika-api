import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(csrf({ origin: process.env.FRONTEND_ORIGIN }));
app.use("/public/temp/*", serveStatic({ root: "./" }));
app.use(
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => {
      return c.text("Data exceeded 16Kb limit :(", 413);
    },
  }),
);

export { app };
