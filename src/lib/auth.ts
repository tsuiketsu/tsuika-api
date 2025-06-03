import { sendOTP } from "@/helpers/send-email";
import { ApiError } from "@/utils/api-error";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, twoFactor } from "better-auth/plugins";
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
  trustedOrigins: [process.env.CORS_ORIGIN],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        const verification = await db.query.verification.findFirst({
          where: ({ identifier }, { eq }) =>
            eq(identifier, `email-verification-otp-${email}`),
          columns: {
            id: true,
          },
        });

        if (!verification?.id) {
          throw new ApiError(
            500,
            "Failed to generate verification otp",
            "OTP_GENERATION_FAILED",
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
