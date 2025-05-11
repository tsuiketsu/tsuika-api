import { app } from "./app";

import type { Serve } from "bun";

const port = process.env.PORT;

app.get("/", (c) => {
  return c.text("🔖 Tsuika API up and running");
});

export default {
  port: port || 8000,
  fetch: app.fetch,
} satisfies Serve;
