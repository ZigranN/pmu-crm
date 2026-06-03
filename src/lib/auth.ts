import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { getServerAppEnv } from "./env";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),

    secret: getServerAppEnv().BETTER_AUTH_SECRET,
    baseURL: getServerAppEnv().BETTER_AUTH_URL,

    emailAndPassword: {
        enabled: true,
        disableSignUp: false,
        minPasswordLength: 8,
        autoSignIn: true,
    },

    user: {
        additionalFields: {
            role: {
                type: "string",
                required: true,
                defaultValue: "CLIENT",
            },
        },
    },

    session: {
        additionalFields: {
            role: {
                type: "string",
                required: true,
            },
        },
    },
});