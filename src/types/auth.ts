export type AppUserRole =
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