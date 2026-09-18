// Pure contract shared by schema and server writers. Extend with domain commands.
export const AUDIT_ENTITIES = {
  commercial_terms_confirmed: "cycle_commercial_terms",
  cycle_qualified:"treatment_cycle",consultation_completed:"treatment_cycle",consultation_result_recorded:"treatment_cycle",
  cycle_created: "treatment_cycle", cycle_stage_changed: "treatment_cycle",
  client_merged: "client",
  client_duplicate_accepted: "client",
  client_preferred_master_changed: "client",
  master_price_changed: "master_price_revision", offer_created: "offer_revision", offer_revised: "offer_revision",
  service_consolidated: "service",
  job_recovered: "outbox_job",
  client_created: "client", client_updated: "client", client_status_changed: "client",
  client_archived: "client", client_restored: "client", client_master_assigned: "client",
  medical_profile_updated: "client_medical_profile", media_uploaded: "media", media_archived: "media",
  consent_uploaded: "consent", consent_archived: "consent",
  service_created: "service", service_updated: "service", service_archived: "service", service_restored: "service",
  master_created: "master", master_updated: "master", master_archived: "master", master_restored: "master",
  studio_settings_updated: "studio", membership_changed: "studio_member",
} as const;
export type AuditAction = keyof typeof AUDIT_ENTITIES;
export const ACCESS_OPERATIONS = ["clients.list", "client.read", "clients.search", "global.search", "medical.read", "activity.read",
  "media.list", "media.read", "consents.list", "masters.list", "master.read", "appointments.list", "payments.list", "transactions.list", "audit.list", "access.list", "jobs.list", "offers.read", "pricing.read", "clients.duplicates", "clients.merge.preview", "clients.merge.history", "cycles.legacy.report", "cycles.list", "cycles.timeline", "consultations.read", "commercial-terms.read"] as const;
