import type {
  LegacyStaffInput,
  LegacyServiceInput,
  StaffMappingRule,
  ServiceMappingRule,
  MigrationFinding,
} from "../types";

export function resolveStaffMapping(
  staffIdOrName: string | null | undefined,
  staffMappings: Record<string, StaffMappingRule>,
  _allStaff?: LegacyStaffInput[]
): {
  targetMasterId?: string;
  targetUserId?: string;
  rule?: StaffMappingRule;
  findings: MigrationFinding[];
} {
  void _allStaff;
  const findings: MigrationFinding[] = [];
  if (!staffIdOrName) {
    return { findings };
  }

  const normalizedKey = staffIdOrName.trim();
  const rule = staffMappings[normalizedKey] || staffMappings[normalizedKey.toLowerCase()];

  if (!rule || rule.status === "UNMAPPED") {
    findings.push({
      code: "STAFF_UNMAPPED_MANUAL_REVIEW",
      severity: "ERROR",
      entityType: "staff",
      sourceId: normalizedKey,
      message: `Legacy staff '${normalizedKey}' has no target master/user mapping. Must be explicitly mapped before cutover; will NOT fabricate user accounts.`,
    });
    return { findings };
  }

  if (rule.status === "MANUAL_REVIEW") {
    findings.push({
      code: "STAFF_MAPPING_AMBIGUOUS",
      severity: "WARNING",
      entityType: "staff",
      sourceId: normalizedKey,
      message: `Legacy staff '${normalizedKey}' mapping requires manual review: ${rule.notes || "ambiguous name match"}`,
    });
    return { findings };
  }

  return {
    targetMasterId: rule.targetMasterId,
    targetUserId: rule.targetUserId,
    rule,
    findings,
  };
}

export function resolveServiceMapping(
  serviceIdOrName: string | null | undefined,
  serviceMappings: Record<string, ServiceMappingRule>,
  _allServices?: LegacyServiceInput[]
): {
  targetServiceId?: string;
  catalogCode?: string;
  rule?: ServiceMappingRule;
  findings: MigrationFinding[];
} {
  void _allServices;
  const findings: MigrationFinding[] = [];
  if (!serviceIdOrName) {
    return { findings };
  }

  const normalizedKey = serviceIdOrName.trim();
  const rule = serviceMappings[normalizedKey] || serviceMappings[normalizedKey.toLowerCase()];

  if (!rule || rule.status === "UNMAPPED") {
    findings.push({
      code: "SERVICE_UNMAPPED_MANUAL_REVIEW",
      severity: "ERROR",
      entityType: "service",
      sourceId: normalizedKey,
      message: `Legacy service '${normalizedKey}' is not mapped to a known target service or catalog code. Will NOT auto-create arbitrary services.`,
    });
    return { findings };
  }

  if (rule.status === "MANUAL_REVIEW") {
    findings.push({
      code: "SERVICE_MAPPING_AMBIGUOUS",
      severity: "WARNING",
      entityType: "service",
      sourceId: normalizedKey,
      message: `Legacy service '${normalizedKey}' requires manual review: ${rule.notes || "service catalog match uncertain"}`,
    });
    return { findings };
  }

  return {
    targetServiceId: rule.targetServiceId,
    catalogCode: rule.catalogCode,
    rule,
    findings,
  };
}
