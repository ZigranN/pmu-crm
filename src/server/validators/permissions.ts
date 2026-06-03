import { z } from "zod";

export const permissionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export const rolePermissionSchema = z.object({
  roleId: z.string().uuid(),
  permissionId: z.string().uuid(),
});

export const customPermissionSchema = z.object({
  userId: z.string(),
  studioId: z.string().uuid(),
  permissionId: z.string().uuid(),
  effect: z.enum(["allow", "deny"]),
});
