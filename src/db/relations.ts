import { relations } from "drizzle-orm";
import * as schema from "./schema";

export const userRelations = relations(schema.user, ({ many }) => ({
  studioMembers: many(schema.studioMembers),
  tasks: many(schema.tasks),
  notifications: many(schema.notifications),
  auditLogs: many(schema.auditLogs),
  assignedConversations: many(schema.conversations),
  sentMessages: many(schema.conversationMessages),
  conversationReadStates: many(schema.conversationReadStates),
  createdAutomationRules: many(schema.automationRules),
  assignedHandoffs: many(schema.handoffs, { relationName: "handoff_to_user" }),
  createdHandoffs: many(schema.handoffs, { relationName: "handoff_created_by" }),
  requestedPrivacyRequests: many(schema.privacyRequests, { relationName: "privacy_requested_by" }),
  approvedPrivacyRequests: many(schema.privacyRequests, { relationName: "privacy_approved_by" }),
}));

export const studioRelations = relations(schema.studios, ({ many, one }) => ({
  members: many(schema.studioMembers),
  masters: many(schema.masters),
  clients: many(schema.clients),
  services: many(schema.services),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  payments: many(schema.payments),
  ledgerEntries: many(schema.ledgerEntries),
  media: many(schema.media),
  tasks: many(schema.tasks),
  notifications: many(schema.notifications),
  reviews: many(schema.reviews),
  activityEvents: many(schema.activityEvents),
  questionnaireTemplates: many(schema.questionnaireTemplates),
  questionnaireResponses: many(schema.questionnaireResponses),
  exportJobs: many(schema.exportJobs),
  auditLogs: many(schema.auditLogs),
  consentTemplates: many(schema.consentTemplates),
  consentTemplateVersions: many(schema.consentTemplateVersions),
  cycleConsents: many(schema.cycleConsents),
  cycleConsentZones: many(schema.cycleConsentZones),
  calendarExceptions: many(schema.calendarExceptions),
  masterAvailability: many(schema.masterAvailability),
  conversations: many(schema.conversations),
  conversationMessages: many(schema.conversationMessages),
  conversationReadStates: many(schema.conversationReadStates),
  automationRules: many(schema.automationRules),
  automationExecutions: many(schema.automationExecutions),
  googleCalendarConnections: many(schema.googleCalendarConnections),
  googleCalendarEventMappings: many(schema.googleCalendarEventMappings),
  handoffs: many(schema.handoffs),
  privacyRequests: many(schema.privacyRequests),
  privacyRetentionPolicy: one(schema.studioPrivacyRetentionPolicies),
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
  medicalProfileRevisions: many(schema.medicalProfileRevisions),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  payments: many(schema.payments),
  ledgerEntries: many(schema.ledgerEntries),
  media: many(schema.media),
  tasks: many(schema.tasks),
  reviews: many(schema.reviews),
  activityEvents: many(schema.activityEvents),
  questionnaireResponses: many(schema.questionnaireResponses),
  cycleConsents: many(schema.cycleConsents),
  conversations: many(schema.conversations),
  conversationMessages: many(schema.conversationMessages),
  privacyRequests: many(schema.privacyRequests),
}));

export const medicalProfileRelations = relations(schema.clientMedicalProfiles, ({ one }) => ({
  client: one(schema.clients, { fields: [schema.clientMedicalProfiles.clientId], references: [schema.clients.id] }),
}));

export const medicalProfileRevisionRelations = relations(schema.medicalProfileRevisions, ({ one }) => ({
  client: one(schema.clients, { fields: [schema.medicalProfileRevisions.clientId], references: [schema.clients.id] }),
  studio: one(schema.studios, { fields: [schema.medicalProfileRevisions.studioId], references: [schema.studios.id] }),
  createdBy: one(schema.user, { fields: [schema.medicalProfileRevisions.createdById], references: [schema.user.id] }),
}));

export const masterRelations = relations(schema.masters, ({ many, one }) => ({
  studio: one(schema.studios, {
    fields: [schema.masters.studioId],
    references: [schema.studios.id],
  }),
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
  availability: many(schema.masterAvailability),
  breaks: many(schema.masterBreaks),
  blockedTimes: many(schema.blockedTimes),
  calendarExceptions: many(schema.calendarExceptions),
  googleCalendarConnections: many(schema.googleCalendarConnections),
}));

export const masterAvailabilityRelations = relations(schema.masterAvailability, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.masterAvailability.studioId],
    references: [schema.studios.id],
  }),
  master: one(schema.masters, {
    fields: [schema.masterAvailability.masterId],
    references: [schema.masters.id],
  }),
}));

export const calendarExceptionRelations = relations(schema.calendarExceptions, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.calendarExceptions.studioId],
    references: [schema.studios.id],
  }),
  master: one(schema.masters, {
    fields: [schema.calendarExceptions.masterId],
    references: [schema.masters.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.calendarExceptions.createdById],
    references: [schema.user.id],
  }),
}));

export const serviceRelations = relations(schema.services, ({ many }) => ({
  appointments: many(schema.appointments),
  procedureSessions: many(schema.procedureSessions),
}));

export const appointmentRelations = relations(schema.appointments, ({ one, many }) => ({
  cycles: many(schema.appointmentCycles),
  events: many(schema.appointmentEvents),
  payments: many(schema.payments),
  ledgerEntries: many(schema.ledgerEntries),
  procedureSessions: many(schema.procedureSessions),
  media: many(schema.media),
  tasks: many(schema.tasks),
  googleCalendarEventMappings: many(schema.googleCalendarEventMappings),
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
  consents: many(schema.cycleConsents),
  conversations: many(schema.conversations),
  conversationMessages: many(schema.conversationMessages),
}));
export const treatmentPackageRelations = relations(schema.treatmentPackages, ({one,many}) => ({
  client: one(schema.clients,{fields:[schema.treatmentPackages.clientId],references:[schema.clients.id]}), cycles: many(schema.treatmentCycles),
}));
export const appointmentCycleRelations = relations(schema.appointmentCycles, ({one}) => ({
  cycle: one(schema.treatmentCycles,{fields:[schema.appointmentCycles.cycleId],references:[schema.treatmentCycles.id]}),
  appointment: one(schema.appointments,{fields:[schema.appointmentCycles.appointmentId],references:[schema.appointments.id]}),
}));

export const cycleMedicalClearanceRelations = relations(schema.cycleMedicalClearances, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.cycleMedicalClearances.studioId],
    references: [schema.studios.id],
  }),
  treatmentCycle: one(schema.treatmentCycles, {
    fields: [schema.cycleMedicalClearances.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  medicalProfileRevision: one(schema.medicalProfileRevisions, {
    fields: [schema.cycleMedicalClearances.medicalRevisionId],
    references: [schema.medicalProfileRevisions.id],
  }),
  decidedBy: one(schema.user, {
    fields: [schema.cycleMedicalClearances.decidedById],
    references: [schema.user.id],
  }),
}));

export const consentTemplateRelations = relations(schema.consentTemplates, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.consentTemplates.studioId],
    references: [schema.studios.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.consentTemplates.createdById],
    references: [schema.user.id],
  }),
  versions: many(schema.consentTemplateVersions),
}));

export const consentTemplateVersionRelations = relations(schema.consentTemplateVersions, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.consentTemplateVersions.studioId],
    references: [schema.studios.id],
  }),
  template: one(schema.consentTemplates, {
    fields: [schema.consentTemplateVersions.templateId],
    references: [schema.consentTemplates.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.consentTemplateVersions.createdById],
    references: [schema.user.id],
  }),
}));

export const cycleConsentRelations = relations(schema.cycleConsents, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.cycleConsents.studioId],
    references: [schema.studios.id],
  }),
  cycle: one(schema.treatmentCycles, {
    fields: [schema.cycleConsents.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  client: one(schema.clients, {
    fields: [schema.cycleConsents.clientId],
    references: [schema.clients.id],
  }),
  templateVersion: one(schema.consentTemplateVersions, {
    fields: [schema.cycleConsents.templateVersionId],
    references: [schema.consentTemplateVersions.id],
  }),
  media: one(schema.media, {
    fields: [schema.cycleConsents.mediaId],
    references: [schema.media.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.cycleConsents.createdById],
    references: [schema.user.id],
  }),
  finalizedBy: one(schema.user, {
    fields: [schema.cycleConsents.finalizedById],
    references: [schema.user.id],
  }),
  zones: many(schema.cycleConsentZones),
}));

export const cycleConsentZoneRelations = relations(schema.cycleConsentZones, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.cycleConsentZones.studioId],
    references: [schema.studios.id],
  }),
  consent: one(schema.cycleConsents, {
    fields: [schema.cycleConsentZones.consentId],
    references: [schema.cycleConsents.id],
  }),
  zone: one(schema.catalogZones, {
    fields: [schema.cycleConsentZones.zoneCode],
    references: [schema.catalogZones.code],
  }),
}));

export const ledgerEntryRelations = relations(schema.ledgerEntries, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.ledgerEntries.studioId],
    references: [schema.studios.id],
  }),
  client: one(schema.clients, {
    fields: [schema.ledgerEntries.clientId],
    references: [schema.clients.id],
  }),
  appointment: one(schema.appointments, {
    fields: [schema.ledgerEntries.appointmentId],
    references: [schema.appointments.id],
  }),
  cycle: one(schema.treatmentCycles, {
    fields: [schema.ledgerEntries.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.ledgerEntries.createdById],
    references: [schema.user.id],
  }),
  targetPayment: one(schema.ledgerEntries, {
    fields: [schema.ledgerEntries.targetPaymentId],
    references: [schema.ledgerEntries.id],
    relationName: "refundTarget",
  }),
  refunds: many(schema.ledgerEntries, {
    relationName: "refundTarget",
  }),
}));

export const conversationRelations = relations(schema.conversations, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.conversations.studioId],
    references: [schema.studios.id],
  }),
  client: one(schema.clients, {
    fields: [schema.conversations.clientId],
    references: [schema.clients.id],
  }),
  cycle: one(schema.treatmentCycles, {
    fields: [schema.conversations.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  assignedUser: one(schema.user, {
    fields: [schema.conversations.assignedUserId],
    references: [schema.user.id],
  }),
  messages: many(schema.conversationMessages),
  readStates: many(schema.conversationReadStates),
}));

export const conversationMessageRelations = relations(schema.conversationMessages, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.conversationMessages.studioId],
    references: [schema.studios.id],
  }),
  conversation: one(schema.conversations, {
    fields: [schema.conversationMessages.conversationId],
    references: [schema.conversations.id],
  }),
  client: one(schema.clients, {
    fields: [schema.conversationMessages.clientId],
    references: [schema.clients.id],
  }),
  cycle: one(schema.treatmentCycles, {
    fields: [schema.conversationMessages.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  senderUser: one(schema.user, {
    fields: [schema.conversationMessages.senderUserId],
    references: [schema.user.id],
  }),
  readStates: many(schema.conversationReadStates),
}));

export const conversationReadStateRelations = relations(schema.conversationReadStates, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.conversationReadStates.studioId],
    references: [schema.studios.id],
  }),
  conversation: one(schema.conversations, {
    fields: [schema.conversationReadStates.conversationId],
    references: [schema.conversations.id],
  }),
  user: one(schema.user, {
    fields: [schema.conversationReadStates.userId],
    references: [schema.user.id],
  }),
  lastReadMessage: one(schema.conversationMessages, {
    fields: [schema.conversationReadStates.lastReadMessageId],
    references: [schema.conversationMessages.id],
  }),
}));

export const automationRuleRelations = relations(schema.automationRules, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.automationRules.studioId],
    references: [schema.studios.id],
  }),
  createdBy: one(schema.user, {
    fields: [schema.automationRules.createdById],
    references: [schema.user.id],
  }),
  executions: many(schema.automationExecutions),
}));

export const automationExecutionRelations = relations(schema.automationExecutions, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.automationExecutions.studioId],
    references: [schema.studios.id],
  }),
  rule: one(schema.automationRules, {
    fields: [schema.automationExecutions.ruleId],
    references: [schema.automationRules.id],
  }),
  job: one(schema.outboxJobs, {
    fields: [schema.automationExecutions.jobId],
    references: [schema.outboxJobs.id],
  }),
}));

export const googleCalendarConnectionRelations = relations(schema.googleCalendarConnections, ({ one, many }) => ({
  studio: one(schema.studios, {
    fields: [schema.googleCalendarConnections.studioId],
    references: [schema.studios.id],
  }),
  user: one(schema.user, {
    fields: [schema.googleCalendarConnections.userId],
    references: [schema.user.id],
  }),
  master: one(schema.masters, {
    fields: [schema.googleCalendarConnections.masterId],
    references: [schema.masters.id],
  }),
  eventMappings: many(schema.googleCalendarEventMappings),
}));

export const googleCalendarEventMappingRelations = relations(schema.googleCalendarEventMappings, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.googleCalendarEventMappings.studioId],
    references: [schema.studios.id],
  }),
  connection: one(schema.googleCalendarConnections, {
    fields: [schema.googleCalendarEventMappings.connectionId],
    references: [schema.googleCalendarConnections.id],
  }),
  appointment: one(schema.appointments, {
    fields: [schema.googleCalendarEventMappings.appointmentId],
    references: [schema.appointments.id],
  }),
}));

export const aiRunRelations = relations(schema.aiRuns, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.aiRuns.studioId],
    references: [schema.studios.id],
  }),
  user: one(schema.user, {
    fields: [schema.aiRuns.userId],
    references: [schema.user.id],
  }),
}));

export const handoffRelations = relations(schema.handoffs, ({ one }) => ({
  studio: one(schema.studios, {
    fields: [schema.handoffs.studioId],
    references: [schema.studios.id],
  }),
  client: one(schema.clients, {
    fields: [schema.handoffs.clientId],
    references: [schema.clients.id],
  }),
  treatmentCycle: one(schema.treatmentCycles, {
    fields: [schema.handoffs.cycleId],
    references: [schema.treatmentCycles.id],
  }),
  conversation: one(schema.conversations, {
    fields: [schema.handoffs.conversationId],
    references: [schema.conversations.id],
  }),
  appointment: one(schema.appointments, {
    fields: [schema.handoffs.appointmentId],
    references: [schema.appointments.id],
  }),
  fromUser: one(schema.user, {
    fields: [schema.handoffs.fromUserId],
    references: [schema.user.id],
    relationName: "handoff_from_user",
  }),
  toUser: one(schema.user, {
    fields: [schema.handoffs.toUserId],
    references: [schema.user.id],
    relationName: "handoff_to_user",
  }),
  createdBy: one(schema.user, {
    fields: [schema.handoffs.createdById],
    references: [schema.user.id],
    relationName: "handoff_created_by",
  }),
  acceptedBy: one(schema.user, {
    fields: [schema.handoffs.acceptedById],
    references: [schema.user.id],
    relationName: "handoff_accepted_by",
  }),
  rejectedBy: one(schema.user, {
    fields: [schema.handoffs.rejectedById],
    references: [schema.user.id],
    relationName: "handoff_rejected_by",
  }),
  completedBy: one(schema.user, {
    fields: [schema.handoffs.completedById],
    references: [schema.user.id],
    relationName: "handoff_completed_by",
  }),
  cancelledBy: one(schema.user, {
    fields: [schema.handoffs.cancelledById],
    references: [schema.user.id],
    relationName: "handoff_cancelled_by",
  }),
}));

export const privacyRequestsRelations = relations(
  schema.privacyRequests,
  ({ one }) => ({
    studio: one(schema.studios, {
      fields: [schema.privacyRequests.studioId],
      references: [schema.studios.id],
    }),
    client: one(schema.clients, {
      fields: [schema.privacyRequests.clientId],
      references: [schema.clients.id],
    }),
    requestedBy: one(schema.user, {
      fields: [schema.privacyRequests.requestedById],
      references: [schema.user.id],
      relationName: "privacy_requested_by",
    }),
    approvedBy: one(schema.user, {
      fields: [schema.privacyRequests.approvedById],
      references: [schema.user.id],
      relationName: "privacy_approved_by",
    }),
    exportArtifact: one(schema.media, {
      fields: [schema.privacyRequests.exportArtifactId],
      references: [schema.media.id],
    }),
  })
);

export const studioPrivacyRetentionPoliciesRelations = relations(
  schema.studioPrivacyRetentionPolicies,
  ({ one }) => ({
    studio: one(schema.studios, {
      fields: [schema.studioPrivacyRetentionPolicies.studioId],
      references: [schema.studios.id],
    }),
  })
);
