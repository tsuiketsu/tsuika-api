import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import * as authSchema from "./schema/auth.schema";
import * as bookmarkTagSchema from "./schema/bookmark-tag.schema";
import * as bookmarkSchema from "./schema/bookmark.schema";
import * as folderSchema from "./schema/folder.schema";
import * as profileSchema from "./schema/profile.schema";
import * as tagSchema from "./schema/tag.schema";

const connectionString = process.env.DATABASE_URL;

// Configuring Neon for local development
if (process.env.NODE_ENV === "development") {
  neonConfig.fetchEndpoint = (host) => {
    const [protocol, port] =
      host === "db.localtest.me" ? ["http", 4444] : ["https", 443];
    return `${protocol}://${host}:${port}/sql`;
  };
  const connectionStringUrl = new URL(connectionString);
  neonConfig.useSecureWebSocket =
    connectionStringUrl.hostname !== "db.localtest.me";
  neonConfig.wsProxy = (host) =>
    host === "db.localtest.me" ? `${host}:4444/v2` : `${host}/v2`;
}

const sql = neon(connectionString);

// HTTP Client:
// - Best for serverless functions and Lambda environments
// - Ideal for stateless operations and quick queries
// - Lower overhead for single queries
// - Better for applications with sporadic database access
export const db = drizzleHttp({
  schema: {
    ...authSchema,
    ...profileSchema,
    ...bookmarkSchema,
    ...tagSchema,
    ...bookmarkTagSchema,
    ...folderSchema,
  },
  client: sql,
  casing: "snake_case",
});
