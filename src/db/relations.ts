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

export const clientRelations = relations(schema.clients, ({ many }) => ({
  treatmentCycles: many(schema.treatmentCycles), treatmentPackages: many(schema.treatmentPackages),
  medicalProfiles: many(schema.clientMedicalProfiles),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  payments: many(schema.payments),
  media: many(schema.media),
  tasks: many(schema.tasks),
  reviews: many(schema.reviews),
  activityEvents: many(schema.activityEvents),
  questionnaireResponses: many(schema.questionnaireResponses),
}));

export const medicalProfileRelations = relations(schema.clientMedicalProfiles, ({ one }) => ({
  client: one(schema.clients, { fields: [schema.clientMedicalProfiles.clientId], references: [schema.clients.id] }),
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
  cycles: many(schema.appointmentCycles),
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

export const treatmentCycleRelations = relations(schema.treatmentCycles, ({one,many}) => ({
  client: one(schema.clients,{fields:[schema.treatmentCycles.clientId],references:[schema.clients.id]}),
  package: one(schema.treatmentPackages,{fields:[schema.treatmentCycles.packageId],references:[schema.treatmentPackages.id]}),
  visits: many(schema.appointmentCycles),
}));
export const treatmentPackageRelations = relations(schema.treatmentPackages, ({one,many}) => ({
  client: one(schema.clients,{fields:[schema.treatmentPackages.clientId],references:[schema.clients.id]}), cycles: many(schema.treatmentCycles),
}));
export const appointmentCycleRelations = relations(schema.appointmentCycles, ({one}) => ({
  cycle: one(schema.treatmentCycles,{fields:[schema.appointmentCycles.cycleId],references:[schema.treatmentCycles.id]}),
  appointment: one(schema.appointments,{fields:[schema.appointmentCycles.appointmentId],references:[schema.appointments.id]}),
}));
