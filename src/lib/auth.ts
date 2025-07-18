import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, twoFactor, username } from "better-auth/plugins";
import { RESERVED_USERNAMES } from "@/constants";
import { throwError } from "@/errors/handlers";
import { sendEmailVerificationLink, sendOTP } from "@/helpers/send-email";
import { db } from "../db";
import {
  account,
  session,
  twoFactor as twoFactorSchema,
  user,
  verification,
} from "../db/schema/auth.schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: user,
      sessions: session,
      accounts: account,
      verifications: verification,
      twoFactors: twoFactorSchema,
    },
    usePlural: true,
  }),
  trustedOrigins: [
    process.env.CORS_ORIGIN_FRONTEND,
    process.env.CORS_ORIGIN_BROWSER_EXTENSION,
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, url }) => {
        await sendEmailVerificationLink({
          preview: "Request to Change Your Email Address",
          subject: "Email Change Request",
          email: user.email,
          url,
        });
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // requireEmailVerification: true,
    password: {
      hash: async (password) => {
        return await Bun.password.hash(password, {
          algorithm: "argon2id",
          memoryCost: 19,
        });
      },
      verify: async ({ password, hash }) => {
        return await Bun.password.verify(password, hash);
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
  plugins: [
    twoFactor(),
    username({
      usernameValidator: (username) => {
        return !RESERVED_USERNAMES.includes(username);
      },
    }),
    emailOTP({
      allowedAttempts: 5,
      async sendVerificationOTP({ email, otp, type }) {
        const verification = await db.query.verification.findFirst({
          where: ({ identifier }, { eq }) =>
            eq(identifier, `email-verification-otp-${email}`),
          columns: {
            id: true,
          },
        });

        if (!verification?.id) {
          throwError(
            "INTERNAL_ERROR",
            "Failed to generate verification otp",
            "auth.get",
          );
        }

        if (type === "email-verification") {
          const fallbackUrl =
            `${process.env.CORS_ORIGIN}/email-verification` +
            `?token=${verification.id}`;

          await sendOTP({ email, otp, fallbackUrl });
        }
      },
    }),
  ],
});
