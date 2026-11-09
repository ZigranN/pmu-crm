import type { LegacySourceDataset } from "../types";

export function createCleanLegacyDataset(): LegacySourceDataset {
  return {
    sourceSystem: "legacy_crm_studio_rome",
    extractedAt: "2026-10-21T10:00:00.000Z",
    staff: [
      { id: "staff-1", name: "Anna Master", email: "anna@example.test", role: "MASTER", active: true },
      { id: "staff-2", name: "Elena Assistant", email: "elena@example.test", role: "ASSISTANT", active: true },
    ],
    services: [
      { id: "srv-brows", name: "Brows PMU Initial", catalogCode: "brows_pmu_primary", durationMinutes: 120, priceCents: 35000, zone: "brows" },
      { id: "srv-lips", name: "Lips PMU Initial", catalogCode: "lips_pmu_primary", durationMinutes: 120, priceCents: 35000, zone: "lips" },
      { id: "srv-remover", name: "Laser Remover Session", catalogCode: "remover_session", durationMinutes: 60, priceCents: 10000, zone: "brows" },
    ],
    clients: [
      {
        id: "legacy-client-101",
        firstName: "Giulia",
        lastName: "Rossi",
        phone: "+39 333 111 2233",
        email: "giulia.rossi@example.test",
        whatsapp: "+39 333 111 2233",
        instagram: "giulia_pmu",
        birthDate: "1992-04-15",
        notes: "Historical VIP client from Rome studio",
        tags: ["regular", "vip"],
        referralSource: "instagram",
        legacyStatus: "qualification",
        createdAt: "2025-01-15T09:00:00.000Z",
      },
      {
        id: "legacy-client-102",
        firstName: "Sofia",
        lastName: "Bianchi",
        phone: "+39 333 444 5566",
        email: "sofia.bianchi@example.test",
        whatsapp: "+39 333 444 5566",
        notes: "Total Face Package client",
        legacyStatus: "first_session_completed",
        createdAt: "2025-02-10T11:00:00.000Z",
      },
      {
        id: "legacy-client-103",
        firstName: "Marco",
        lastName: "Ferrari",
        phone: "+39 333 777 8899",
        email: "marco.remover@example.test",
        notes: "Remover client with explicit laser tattoo removal history",
        legacyStatus: "qualification",
        createdAt: "2025-03-01T14:00:00.000Z",
      },
    ],
    cycles: [
      {
        id: "cycle-101-brows",
        clientId: "legacy-client-101",
        zone: "brows",
        kind: "pmu",
        legacyStatus: "qualification",
        staffId: "staff-1",
        startDate: "2025-01-15T10:00:00.000Z",
      },
      {
        id: "cycle-103-remover",
        clientId: "legacy-client-103",
        zone: "brows",
        kind: "remover",
        legacyStatus: "qualification",
        staffId: "staff-1",
        notes: "laser remover treatment",
        startDate: "2025-03-01T14:30:00.000Z",
      },
    ],
    packages: [
      {
        id: "pkg-102-totalface",
        clientId: "legacy-client-102",
        name: "Total Face Full Package",
        packageCode: "total_face_complete",
        zones: ["brows", "eyes", "lips"],
        createdAt: "2025-02-10T11:00:00.000Z",
      },
    ],
    appointments: [
      {
        id: "app-101",
        clientId: "legacy-client-101",
        staffId: "staff-1",
        serviceId: "srv-brows",
        startAt: "2025-01-20T10:00:00.000Z",
        endAt: "2025-01-20T12:00:00.000Z",
        status: "completed",
        notes: "Primary brows PMU consultation and mapping",
        createdAt: "2025-01-15T10:00:00.000Z",
      },
    ],
    medicalProfiles: [
      {
        id: "med-101",
        clientId: "legacy-client-101",
        allergies: "Lidocaine mild sensitivity",
        chronicConditions: null,
        medications: null,
        pregnantOrLactating: false,
        keloidHistory: false,
        sourceProven: true,
        updatedAt: "2025-01-15T10:00:00.000Z",
      },
    ],
    medicalClearances: [
      {
        id: "clear-101",
        clientId: "legacy-client-101",
        cycleId: "cycle-101-brows",
        decision: "CLEARED",
        reviewerStaffId: "staff-1",
        reviewerName: "Anna Master",
        decidedAt: "2025-01-16T11:00:00.000Z",
        notes: "Approved after allergy skin test",
        hasExplicitEvidence: true,
      },
    ],
    consents: [
      {
        id: "consent-101",
        clientId: "legacy-client-101",
        cycleId: "cycle-101-brows",
        consentType: "procedure_consent",
        signedAt: "2025-01-20T09:45:00.000Z",
        signatoryName: "Giulia Rossi",
        signatoryPhone: "+39 333 111 2233",
        documentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        documentPath: "/storage/consents/2025/consent_101.pdf",
        hasSignedArtifact: true,
      },
      {
        id: "consent-102-legacy-flag",
        clientId: "legacy-client-102",
        consentType: "gdpr_marketing",
        signedAt: "2025-02-10T11:00:00.000Z",
        hasSignedArtifact: false,
        legacyBooleanOnly: true,
        notes: "Old marketing checkbox = true",
      },
    ],
    procedures: [
      {
        id: "proc-101",
        appointmentId: "app-101",
        clientId: "legacy-client-101",
        cycleId: "cycle-101-brows",
        staffId: "staff-1",
        zone: "brows",
        sessionType: "first_session",
        status: "completed",
        executedAt: "2025-01-20T10:30:00.000Z",
        pigmentMix: "Swiss Color Dark Brown 3 drops + Neutralizer 1 drop",
        anesthesia: "Primary topical 4% Lidocaine",
        notes: "Initial pass completed cleanly with excellent skin response",
      },
    ],
    finances: [
      {
        id: "fin-101-charge",
        clientId: "legacy-client-101",
        appointmentId: "app-101",
        type: "charge",
        amountMinor: 35000,
        currency: "EUR",
        date: "2025-01-20T12:00:00.000Z",
        reference: "INV-2025-001",
      },
      {
        id: "fin-101-payment",
        clientId: "legacy-client-101",
        appointmentId: "app-101",
        type: "payment",
        amountMinor: 35000,
        currency: "EUR",
        date: "2025-01-20T12:05:00.000Z",
        method: "credit_card",
        reference: "POS-TX-99881",
      },
      {
        id: "fin-102-opening-bal",
        clientId: "legacy-client-102",
        type: "opening_balance",
        amountMinor: 15000, // Credit / outstanding opening balance
        currency: "EUR",
        date: "2025-02-10T00:00:00.000Z",
        isOpeningBalanceAdjustment: true,
        notes: "MIGRATION_OPENING_BALANCE for legacy package retainer",
      },
      {
        id: "fin-102-payment",
        clientId: "legacy-client-102",
        type: "payment",
        amountMinor: 15000,
        currency: "EUR",
        date: "2025-02-10T12:00:00.000Z",
        method: "bank_transfer",
      },
    ],
    conversations: [
      {
        id: "conv-101",
        clientId: "legacy-client-101",
        channel: "whatsapp",
        externalThreadId: "wa_thread_101",
        createdAt: "2025-01-14T08:00:00.000Z",
      },
    ],
    messages: [
      {
        id: "msg-101-in",
        conversationId: "conv-101",
        direction: "inbound",
        channel: "whatsapp",
        body: "Buongiorno, vorrei informazioni per il trucco permanente sopracciglia.",
        sender: "Giulia Rossi",
        providerMessageId: "wa_msg_101_in",
        timestamp: "2025-01-14T08:00:00.000Z",
      },
      {
        id: "msg-101-out",
        conversationId: "conv-101",
        direction: "outbound",
        channel: "whatsapp",
        body: "Buongiorno Giulia! Certamente, ti inviamo le nostre disponibilità.",
        sender: "Elena Assistant",
        providerMessageId: "wa_msg_101_out",
        timestamp: "2025-01-14T08:15:00.000Z",
      },
    ],
    media: [
      {
        id: "media-consent-101",
        clientId: "legacy-client-101",
        consentId: "consent-101",
        type: "consent",
        filePath: "/storage/consents/2025/consent_101.pdf",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sizeBytes: 104200,
        contentType: "application/pdf",
        createdAt: "2025-01-20T09:45:00.000Z",
        fileExists: true,
      },
      {
        id: "media-photo-101",
        clientId: "legacy-client-101",
        procedureId: "proc-101",
        type: "after",
        filePath: "/storage/photos/2025/brows_after_101.jpg",
        sha256: "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00",
        sizeBytes: 2450000,
        contentType: "image/jpeg",
        createdAt: "2025-01-20T12:00:00.000Z",
        fileExists: true,
      },
    ],
  };
}

export function createFinancialMismatchDataset(): LegacySourceDataset {
  const base = createCleanLegacyDataset();
  // Corrupt financial ledger for client-101: payment is in USD which triggers currency mismatch blocker
  base.finances = [
    {
      id: "fin-corrupt-charge",
      clientId: "legacy-client-101",
      type: "charge",
      amountMinor: 35000,
      currency: "EUR",
      date: "2025-01-20T12:00:00.000Z",
    },
    {
      id: "fin-corrupt-payment",
      clientId: "legacy-client-101",
      type: "payment",
      amountMinor: 35000,
      currency: "USD", // Mismatched currency
      date: "2025-01-20T12:05:00.000Z",
    },
  ];
  return base;
}

export function createMissingSignedConsentMediaDataset(): LegacySourceDataset {
  const base = createCleanLegacyDataset();
  // Mark the signed consent media file as missing on disk
  if (base.media) {
    base.media[0].fileExists = false;
  }
  return base;
}

export function createAppointmentFutureConflictDataset(): LegacySourceDataset {
  const base = createCleanLegacyDataset();
  // Add two overlapping future appointments for same master
  const futureDateA = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const futureDateB = new Date(futureDateA.getTime() + 30 * 60 * 1000); // 30 min later (overlaps 2-hour slot)

  base.appointments = [
    {
      id: "app-future-1",
      clientId: "legacy-client-101",
      staffId: "staff-1",
      serviceId: "srv-brows",
      startAt: futureDateA.toISOString(),
      endAt: new Date(futureDateA.getTime() + 2 * 3600 * 1000).toISOString(),
      status: "confirmed",
    },
    {
      id: "app-future-2",
      clientId: "legacy-client-102",
      staffId: "staff-1",
      serviceId: "srv-lips",
      startAt: futureDateB.toISOString(),
      endAt: new Date(futureDateB.getTime() + 2 * 3600 * 1000).toISOString(),
      status: "confirmed",
    },
  ];
  return base;
}

export function createAmbiguousClientDuplicatesAndStagesDataset(): LegacySourceDataset {
  const base = createCleanLegacyDataset();
  // Add client with similar name to Giulia Rossi -> "Giulya Rossi" (must NOT auto-merge)
  base.clients?.push({
    id: "legacy-client-duplicate-candidate",
    firstName: "Giulya",
    lastName: "Rossi",
    phone: "+39 349 999 8877", // Different phone
    email: "giulya.different@example.test",
    legacyStatus: "in_progress", // Ambiguous stage
  });

  return base;
}

export function createCurrencyMismatchDataset(): LegacySourceDataset {
  const base = createCleanLegacyDataset();
  base.finances?.push({
    id: "fin-usd-mismatch",
    clientId: "legacy-client-101",
    type: "payment",
    amountMinor: 10000,
    currency: "USD", // Mismatches EUR
    date: "2025-01-20T12:00:00.000Z",
  });
  return base;
}
