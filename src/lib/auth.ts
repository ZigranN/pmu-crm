import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { getServerAppEnv } from "./env";

const serverEnv = getServerAppEnv();

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    secret: serverEnv.BETTER_AUTH_SECRET,
    baseURL: serverEnv.BETTER_AUTH_URL,
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