import { relations } from "drizzle-orm";
import * as schema from "./schema";

export const userRelations = relations(schema.user, ({ many }) => ({
  studioMembers: many(schema.studioMembers),
  tasks: many(schema.tasks),
  notifications: many(schema.notifications),
  auditLogs: many(schema.auditLogs),
}));

export const studioRelations = relations(schema.studios, ({ many }) => ({
  members: many(schema.studioMembers),
  masters: many(schema.masters),
  clients: many(schema.clients),
  services: many(schema.services),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  payments: many(schema.payments),
  media: many(schema.media),
  tasks: many(schema.tasks),
  notifications: many(schema.notifications),
  reviews: many(schema.reviews),
  activityEvents: many(schema.activityEvents),
  questionnaireTemplates: many(schema.questionnaireTemplates),
  questionnaireResponses: many(schema.questionnaireResponses),
  exportJobs: many(schema.exportJobs),
  auditLogs: many(schema.auditLogs),
}));

export const rolesRelations = relations(schema.roles, ({ many }) => ({
  studioMembers: many(schema.studioMembers),
  rolePermissions: many(schema.rolePermissions),
}));

export const permissionsRelations = relations(schema.permissions, ({ many }) => ({
  rolePermissions: many(schema.rolePermissions),
}));

export const rolePermissionsRelations = relations(schema.rolePermissions, ({ one }) => ({
  role: one(schema.roles, {
    fields: [schema.rolePermissions.roleId],
    references: [schema.roles.id],
  }),
  permission: one(schema.permissions, {
    fields: [schema.rolePermissions.permissionId],
    references: [schema.permissions.id],
  }),
}));

export const clientRelations = relations(schema.clients, ({ one, many }) => ({
  medicalProfile: one(schema.clientMedicalProfiles, {
    fields: [schema.clients.id],
    references: [schema.clientMedicalProfiles.clientId],
  }),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  payments: many(schema.payments),
  media: many(schema.media),
  tasks: many(schema.tasks),
  reviews: many(schema.reviews),
  activityEvents: many(schema.activityEvents),
  questionnaireResponses: many(schema.questionnaireResponses),
}));

export const masterRelations = relations(schema.masters, ({ many }) => ({
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  availability: many(schema.masterAvailability),
  breaks: many(schema.masterBreaks),
  blockedTimes: many(schema.blockedTimes),
}));

export const serviceRelations = relations(schema.services, ({ many }) => ({
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
}));

export const appointmentRelations = relations(schema.appointments, ({ one, many }) => ({
  events: many(schema.appointmentEvents),
  payments: many(schema.payments),
  procedureSessions: many(schema.procedureSessions),
  media: many(schema.media),
  tasks: many(schema.tasks),
  client: one(schema.clients, {
    fields: [schema.appointments.clientId],
    references: [schema.clients.id],
  }),
  master: one(schema.masters, {
    fields: [schema.appointments.masterId],
    references: [schema.masters.id],
  }),
  service: one(schema.services, {
    fields: [schema.appointments.serviceId],
    references: [schema.services.id],
  }),
}));

export const procedureSessionRelations = relations(schema.procedureSessions, ({ many, one }) => ({
  pigments: many(schema.procedurePigments),
  media: many(schema.media),
  tasks: many(schema.tasks),
  client: one(schema.clients, {
    fields: [schema.procedureSessions.clientId],
    references: [schema.clients.id],
  }),
  appointment: one(schema.appointments, {
    fields: [schema.procedureSessions.appointmentId],
    references: [schema.appointments.id],
  }),
}));

export const pigmentRelations = relations(schema.pigments, ({ many }) => ({
  procedurePigments: many(schema.procedurePigments),
}));

export const paymentRelations = relations(schema.payments, ({ many, one }) => ({
  transactions: many(schema.paymentTransactions),
  client: one(schema.clients, {
    fields: [schema.payments.clientId],
    references: [schema.clients.id],
  }),
}));
