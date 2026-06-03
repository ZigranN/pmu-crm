import { z } from "zod";

// Public env (safe for client)
const publicEnvSchema = z.object({
    NEXT_PUBLIC_APP_URL: z.string().url(),
});

export function getPublicEnv() {
    return publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    });
}

// Database only
const dbEnvSchema = z.object({
    DATABASE_URL: z.string().min(1),
});

export function getDbEnv() {
    return dbEnvSchema.parse({
        DATABASE_URL: process.env.DATABASE_URL,
    });
}

// Server-only app env
const serverAppEnvSchema = z.object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),

    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
});

export function getServerAppEnv() {
    return serverAppEnvSchema.parse({
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
        NODE_ENV: process.env.NODE_ENV,
        CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
        CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
        CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    });
}

/**
 * ✅ FIX 3: cached singleton (NO re-parse on every import)
 */
let cachedServerEnv: ReturnType<typeof getServerAppEnv> | null = null;

export function serverEnv() {
    if (!cachedServerEnv) {
        cachedServerEnv = getServerAppEnv();
    }
    return cachedServerEnv;
}

// Seed only
const seedEnvSchema = z.object({
    SEED_STUDIO_NAME: z.string().min(1),
    SEED_STUDIO_SLUG: z.string().min(1),
    SEED_STUDIO_TIMEZONE: z.string().default("Europe/Rome"),
    SEED_STUDIO_COUNTRY: z.string().min(1),
    SEED_STUDIO_CITY: z.string().min(1),
    SEED_STUDIO_ADDRESS: z.string().default(""),
    SEED_STUDIO_WHATSAPP: z.string().default(""),
    SEED_ADMIN_NAME: z.string().min(1),
    SEED_ADMIN_EMAIL: z.string().email(),
    SEED_ADMIN_PASSWORD: z.string().min(1),
});

export function getSeedEnv() {
    return seedEnvSchema.parse({
        SEED_STUDIO_NAME: process.env.SEED_STUDIO_NAME,
        SEED_STUDIO_SLUG: process.env.SEED_STUDIO_SLUG,
        SEED_STUDIO_TIMEZONE: process.env.SEED_STUDIO_TIMEZONE,
        SEED_STUDIO_COUNTRY: process.env.SEED_STUDIO_COUNTRY,
        SEED_STUDIO_CITY: process.env.SEED_STUDIO_CITY,
        SEED_STUDIO_ADDRESS: process.env.SEED_STUDIO_ADDRESS,
        SEED_STUDIO_WHATSAPP: process.env.SEED_STUDIO_WHATSAPP,
        SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME,
        SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
        SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
    });
}