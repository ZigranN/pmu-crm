import { studioMembers, rolePermissions, permissions, userCustomPermissions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ROLES } from "./roles";

export const PERMISSIONS = {
  CLIENT_READ: "CLIENT_READ",
  CLIENT_CREATE: "CLIENT_CREATE",
  CLIENT_UPDATE: "CLIENT_UPDATE",
  CLIENT_ARCHIVE: "CLIENT_ARCHIVE",
  
  MEDICAL_PROFILE_READ: "MEDICAL_PROFILE_READ",
  MEDICAL_PROFILE_UPDATE: "MEDICAL_PROFILE_UPDATE",
  
  APPOINTMENT_READ: "APPOINTMENT_READ",
  APPOINTMENT_CREATE: "APPOINTMENT_CREATE",
  APPOINTMENT_UPDATE: "APPOINTMENT_UPDATE",
  APPOINTMENT_CANCEL: "APPOINTMENT_CANCEL",
  APPOINTMENT_COMPLETE: "APPOINTMENT_COMPLETE",
  APPOINTMENT_NO_SHOW: "APPOINTMENT_NO_SHOW",
  APPOINTMENT_OVERRIDE_OVERLAP: "APPOINTMENT_OVERRIDE_OVERLAP",
  
  PROCEDURE_READ: "PROCEDURE_READ",
  PROCEDURE_CREATE: "PROCEDURE_CREATE",
  PROCEDURE_UPDATE: "PROCEDURE_UPDATE",
  
  MEDIA_READ: "MEDIA_READ",
  MEDIA_CREATE: "MEDIA_CREATE",
  
  CONSENT_READ: "CONSENT_READ",
  CONSENT_UPLOAD: "CONSENT_UPLOAD",
  
  PAYMENT_READ: "PAYMENT_READ",
  PAYMENT_MARK_DEPOSIT: "PAYMENT_MARK_DEPOSIT",
  PAYMENT_REFUND: "PAYMENT_REFUND",
  PAYMENT_DELETE: "PAYMENT_DELETE",
  
  FINANCE_ANALYTICS_READ: "FINANCE_ANALYTICS_READ",
  ANALYTICS_READ: "ANALYTICS_READ",
  
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
  STUDIO_MANAGE: "STUDIO_MANAGE",
  USERS_MANAGE: "USERS_MANAGE",
  ROLES_MANAGE: "ROLES_MANAGE",
  
  SERVICE_READ: "SERVICE_READ",
  SERVICE_CREATE: "SERVICE_CREATE",
  SERVICE_UPDATE: "SERVICE_UPDATE",
  SERVICE_ARCHIVE: "SERVICE_ARCHIVE",

  MASTER_READ: "MASTER_READ",
  MASTER_CREATE: "MASTER_CREATE",
  MASTER_UPDATE: "MASTER_UPDATE",
  MASTER_ARCHIVE: "MASTER_ARCHIVE",
  
  WHATSAPP_TEMPLATE_READ: "WHATSAPP_TEMPLATE_READ",
  WHATSAPP_TEMPLATE_USE: "WHATSAPP_TEMPLATE_USE",
  WHATSAPP_TEMPLATE_MANAGE: "WHATSAPP_TEMPLATE_MANAGE",
  
  TASK_READ: "TASK_READ",
  TASK_CREATE: "TASK_CREATE",
  TASK_UPDATE: "TASK_UPDATE",
  
  REVIEW_READ: "REVIEW_READ",
  REVIEW_CREATE: "REVIEW_CREATE",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export async function hasPermission(dbInstance: any, userId: string, studioId: string, permissionCode: PermissionCode): Promise<boolean> {
  // 1. Получаем роль пользователя в студии
  const member = await dbInstance.query.studioMembers.findFirst({
    where: and(
      eq(studioMembers.userId, userId),
      eq(studioMembers.studioId, studioId),
      eq(studioMembers.isActive, true)
    ),
    with: {
      role: true,
    },
  });

  if (!member) return false;

  // SUPER_ADMIN может всё
  if ((member.role as any).code === ROLES.SUPER_ADMIN) return true;

  // 2. Проверяем кастомные пермишены (allow/deny)
  const customPerm = await dbInstance.query.userCustomPermissions.findFirst({
    where: and(
      eq(userCustomPermissions.userId, userId),
      eq(userCustomPermissions.studioId, studioId)
    ),
    with: {
      permission: true
    }
  });
  
  // Если нашли кастомный пермишен с кодом, который ищем
  if (customPerm && (customPerm.permission as any).code === permissionCode) {
      return customPerm.effect === "allow";
  }

  // 3. Проверяем пермишены роли
  // В реальном приложении здесь должен быть поиск по всем пермишенам роли
  const allRolePerms = await dbInstance.select()
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, member.roleId));

  return allRolePerms.some((rp: any) => (rp.permissions as any).code === permissionCode);
}

// Helpers as requested
export const canManageStudio = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.STUDIO_MANAGE);
export const canViewClients = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.CLIENT_READ);
export const canCreateClient = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.CLIENT_CREATE);
export const canEditClient = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.CLIENT_UPDATE);
export const canArchiveClient = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.CLIENT_ARCHIVE);

export const canViewMedicalProfile = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.MEDICAL_PROFILE_READ);
export const canEditMedicalProfile = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.MEDICAL_PROFILE_UPDATE);

export const canCreateAppointment = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.APPOINTMENT_CREATE);
export const canEditAppointment = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.APPOINTMENT_UPDATE);
export const canOverrideAppointmentOverlap = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.APPOINTMENT_OVERRIDE_OVERLAP);

export const canCreateProcedure = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.PROCEDURE_CREATE);
export const canEditProcedure = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.PROCEDURE_UPDATE);

export const canViewFinance = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.PAYMENT_READ);
export const canMarkDeposit = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.PAYMENT_MARK_DEPOSIT);
export const canRefundPayment = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.PAYMENT_REFUND);

export const canUseWhatsappTemplate = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.WHATSAPP_TEMPLATE_USE);
export const canManageWhatsappTemplates = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.WHATSAPP_TEMPLATE_MANAGE);

export const canViewAnalytics = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.ANALYTICS_READ);
export const canViewFinanceAnalytics = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.FINANCE_ANALYTICS_READ);

export const canManageUsers = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.USERS_MANAGE);
export const canManageRoles = (dbInstance: any, userId: string, studioId: string) => hasPermission(dbInstance, userId, studioId, PERMISSIONS.ROLES_MANAGE);
