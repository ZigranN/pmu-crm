import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { getServerAppEnv } from "./env";

const env = getServerAppEnv(); // 👈 ВАЖНО: один раз, но сразу

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),

    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
        env.BETTER_AUTH_URL,
        "https://pmu-crm.vercel.app",
    ],

    emailAndPassword: {
        enabled: true,
        autoSignIn: true,
    },

    user: {
        additionalFields: {
            role: {
                type: "string",
                required: true,
                defaultValue: "ASSISTANT",
            },
        },
    },

});
