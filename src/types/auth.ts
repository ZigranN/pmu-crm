// Auth metadata, never a substitute for a studio membership.
export type AppUserRole =
    | "OWNER"
    | "ADMIN"
    | "AI_SYSTEM"
    | "SUPER_ADMIN"
    | "STUDIO_ADMIN"
    | "MASTER"
    | "ASSISTANT"
    | "CLIENT";

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: AppUserRole;
}