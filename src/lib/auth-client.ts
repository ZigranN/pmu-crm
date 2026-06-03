import { createAuthClient } from "better-auth/react";
import { getPublicEnv } from "./env";

export const authClient = createAuthClient({
    baseURL: getPublicEnv().NEXT_PUBLIC_APP_URL,
});
