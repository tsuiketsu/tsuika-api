import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import { account, session, user, verification } from "../db/schema/auth.schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: user,
      sessions: session,
      accounts: account,
      verifications: verification,
    },
    usePlural: true,
  }),
  // NOTE: Configure this later
  // trustedOrigins: [],
  emailAndPassword: {
    enabled: true,
  },
});
