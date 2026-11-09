import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  googleCalendarConnections,
  googleCalendarEventMappings,
  appointments,
  masters,
  clients,
  services,
} from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/encryption";
import { writeAudit } from "@/server/services/audit-log.service";
import type { Transaction } from "@/server/commands/ownership";
import {
  computeAppointmentSyncHash,
  evaluateReconciliationDecision,
} from "../domain/reconciliation-policy";
import type {
  BatchReconciliationResult,
  GoogleCalendarEvent,
  SyncAppointmentResult,
} from "../domain/types";
import { GoogleCalendarApiClient, type IGoogleCalendarClient } from "./client";
import { refreshGoogleAccessToken } from "./oauth";
import {
  rescheduleAppointment,
  cancelAppointment,
} from "@/features/appointments/server/service";

export interface ContextWithStudio {
  studioId: string;
  userId: string;
  role?: string;
}

export interface ConnectGoogleCalendarInput {
  userId: string;
  masterId?: string | null;
  googleAccountId?: string | null;
  googleEmail?: string | null;
  calendarId?: string;
  calendarSummary?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  scope?: string;
  syncDirection?: "two_way" | "outbound_only";
}

/**
 * Connects or updates a Google Calendar account for a user/master within the studio.
 */
export async function connectGoogleCalendar(
  context: ContextWithStudio,
  input: ConnectGoogleCalendarInput,
  txExecutor: typeof db | Transaction = db
) {
  const calendarId = input.calendarId || "primary";
  const encryptedAccessToken = encryptSecret(input.accessToken);
  const encryptedRefreshToken = input.refreshToken ? encryptSecret(input.refreshToken) : null;
  const tokenExpiresAt = input.expiresIn
    ? new Date(Date.now() + (input.expiresIn - 60) * 1000)
    : null;

  const [connection] = await txExecutor
    .insert(googleCalendarConnections)
    .values({
      studioId: context.studioId,
      userId: input.userId,
      masterId: input.masterId ?? null,
      googleAccountId: input.googleAccountId ?? null,
      googleEmail: input.googleEmail ?? null,
      calendarId,
      calendarSummary: input.calendarSummary ?? null,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scope: input.scope ?? "https://www.googleapis.com/auth/calendar.events",
      status: "connected",
      syncDirection: input.syncDirection ?? "two_way",
      syncStatus: "idle",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        googleCalendarConnections.studioId,
        googleCalendarConnections.userId,
        googleCalendarConnections.calendarId,
      ],
      set: {
        masterId: input.masterId ?? null,
        googleAccountId: input.googleAccountId ?? null,
        googleEmail: input.googleEmail ?? null,
        calendarSummary: input.calendarSummary ?? null,
        encryptedAccessToken,
        ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
        status: "connected",
        syncDirection: input.syncDirection ?? "two_way",
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  await writeAudit(txExecutor as Transaction, {
    studioId: context.studioId,
    userId: context.userId,
    action: "google_calendar_connected",
    entityType: "google_calendar_connection",
    entityId: connection.id,
    before: null,
    after: {
      id: connection.id,
      googleEmail: connection.googleEmail,
      calendarId: connection.calendarId,
      status: connection.status,
    },
    reason: "command:google_calendar_connected",
    reasonSource: "command",
    metadata: {
      userId: input.userId,
      masterId: input.masterId ?? null,
      calendarId,
    },
  });

  return connection;
}

/**
 * Disconnects a Google Calendar account and marks existing mappings as deleted.
 */
export async function disconnectGoogleCalendar(
  context: ContextWithStudio,
  connectionId: string,
  txExecutor: typeof db | Transaction = db
) {
  const [existing] = await txExecutor
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  if (!existing) {
    throw new Error("Google Calendar connection not found");
  }

  const [disconnected] = await txExecutor
    .update(googleCalendarConnections)
    .set({
      status: "disconnected",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    )
    .returning();

  await txExecutor
    .update(googleCalendarEventMappings)
    .set({
      status: "deleted",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(googleCalendarEventMappings.connectionId, connectionId),
        eq(googleCalendarEventMappings.studioId, context.studioId)
      )
    );

  await writeAudit(txExecutor as Transaction, {
    studioId: context.studioId,
    userId: context.userId,
    action: "google_calendar_disconnected",
    entityType: "google_calendar_connection",
    entityId: connectionId,
    before: { id: existing.id, status: existing.status },
    after: { id: disconnected.id, status: disconnected.status },
    reason: "command:google_calendar_disconnected",
    reasonSource: "command",
  });

  return disconnected;
}

/**
 * Resolves a valid access token for a connection, refreshing it if expired.
 */
export async function resolveConnectionAccessToken(
  connection: typeof googleCalendarConnections.$inferSelect,
  txExecutor: typeof db | Transaction = db
): Promise<string> {
  if (!connection.encryptedAccessToken) {
    throw new Error("Connection has no access token");
  }

  const isExpired =
    connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now();

  if (!isExpired) {
    return decryptSecret(connection.encryptedAccessToken);
  }

  if (!connection.encryptedRefreshToken) {
    await txExecutor
      .update(googleCalendarConnections)
      .set({ status: "needs_reauth", lastError: "Token expired and no refresh token available" })
      .where(eq(googleCalendarConnections.id, connection.id));
    throw new Error("Access token expired and no refresh token available");
  }

  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  try {
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    const newEncryptedAccess = encryptSecret(refreshed.accessToken);
    const newExpiresAt = new Date(Date.now() + (refreshed.expiresIn - 60) * 1000);

    await txExecutor
      .update(googleCalendarConnections)
      .set({
        encryptedAccessToken: newEncryptedAccess,
        tokenExpiresAt: newExpiresAt,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarConnections.id, connection.id));

    return refreshed.accessToken;
  } catch (err: any) {
    await txExecutor
      .update(googleCalendarConnections)
      .set({ status: "needs_reauth", lastError: `Failed to refresh token: ${err.message}` })
      .where(eq(googleCalendarConnections.id, connection.id));
    throw err;
  }
}

/**
 * Synchronizes a single appointment to all relevant Google Calendar connections in the studio.
 */
export async function syncAppointmentToGoogleCalendar(options: {
  studioId: string;
  appointmentId: string;
  action: "upsert" | "delete";
  clientFactory?: (accessToken: string) => IGoogleCalendarClient;
  tx?: Transaction;
}): Promise<SyncAppointmentResult[]> {
  const { studioId, appointmentId, action, clientFactory, tx } = options;
  const dbExecutor = tx ?? db;

  // 1. Fetch appointment details
  const [appt] = await dbExecutor
    .select({
      id: appointments.id,
      studioId: appointments.studioId,
      clientId: appointments.clientId,
      masterId: appointments.masterId,
      serviceId: appointments.serviceId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      notes: appointments.notes,
      clientName: clients.fullName,
      clientPhone: clients.phone,
      masterName: masters.displayName,
      serviceName: services.name,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(masters, eq(appointments.masterId, masters.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.studioId, studioId)));

  if (!appt && action !== "delete") {
    return [];
  }

  // 2. Find active connections in studio
  const activeConnections = await dbExecutor
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.studioId, studioId),
        eq(googleCalendarConnections.status, "connected")
      )
    );

  const relevantConnections = activeConnections.filter((conn) => {
    if (!conn.masterId) return true; // Studio-wide calendar
    return conn.masterId === appt?.masterId;
  });

  const results: SyncAppointmentResult[] = [];

  for (const conn of relevantConnections) {
    try {
      const accessToken = await resolveConnectionAccessToken(conn, dbExecutor);
      const client = clientFactory
        ? clientFactory(accessToken)
        : new GoogleCalendarApiClient(accessToken);

      const [existingMapping] = await dbExecutor
        .select()
        .from(googleCalendarEventMappings)
        .where(
          and(
            eq(googleCalendarEventMappings.connectionId, conn.id),
            eq(googleCalendarEventMappings.appointmentId, appointmentId),
            eq(googleCalendarEventMappings.studioId, studioId)
          )
        );

      const isCancelledOrDeleted =
        action === "delete" || !appt || appt.status === "cancelled";

      if (isCancelledOrDeleted) {
        let eventToDeleteId = existingMapping?.googleEventId;
        if (!eventToDeleteId) {
          try {
            const existingRemote = await client.listEvents(conn.calendarId, {
              privateExtendedProperty: `pmuAppointmentId=${appointmentId}`,
              maxResults: 10,
            });
            const matched = existingRemote.items.find(
              (ev) =>
                ev.extendedProperties?.private?.pmuAppointmentId === appointmentId &&
                ev.extendedProperties?.private?.pmuStudioId === studioId
            );
            if (matched) {
              eventToDeleteId = matched.id;
            }
          } catch {
            // Ignore list error during delete fallback
          }
        }

        if (eventToDeleteId) {
          await client.deleteEvent(conn.calendarId, eventToDeleteId);
          if (existingMapping) {
            await dbExecutor
              .update(googleCalendarEventMappings)
              .set({ status: "deleted", updatedAt: new Date(), lastSyncedAt: new Date() })
              .where(eq(googleCalendarEventMappings.id, existingMapping.id));
          }

          results.push({
            connectionId: conn.id,
            appointmentId,
            action: "deleted",
            googleEventId: eventToDeleteId,
          });
        } else {
          results.push({
            connectionId: conn.id,
            appointmentId,
            action: "skipped",
          });
        }
        continue;
      }

      // Upsert case
      const syncHash = computeAppointmentSyncHash({
        id: appt.id,
        startAt: appt.startAt,
        endAt: appt.endAt,
        status: appt.status,
        clientName: appt.clientName,
        serviceName: appt.serviceName,
        masterName: appt.masterName,
        notes: appt.notes,
      });

      if (
        existingMapping &&
        existingMapping.status === "synced" &&
        existingMapping.lastSyncedHash === syncHash
      ) {
        results.push({
          connectionId: conn.id,
          appointmentId,
          action: "skipped",
          googleEventId: existingMapping.googleEventId,
        });
        continue;
      }

      const summary = `${appt.serviceName ?? "Appointment"} - ${appt.clientName ?? "Client"}`;
      const description = [
        `Client: ${appt.clientName ?? "N/A"}`,
        `Phone: ${appt.clientPhone ?? "N/A"}`,
        `Master: ${appt.masterName ?? "N/A"}`,
        `Service: ${appt.serviceName ?? "N/A"}`,
        `Status: ${appt.status}`,
        "",
        "Managed by PMU CRM",
      ]
        .filter(Boolean)
        .join("\n");

      const eventPayload: Partial<GoogleCalendarEvent> = {
        summary,
        description,
        start: { dateTime: new Date(appt.startAt).toISOString() },
        end: { dateTime: new Date(appt.endAt).toISOString() },
        status: "confirmed",
        extendedProperties: {
          private: {
            pmuStudioId: studioId,
            pmuAppointmentId: appointmentId,
          },
        },
      };

      let remoteEventId = existingMapping?.googleEventId;

      if (!remoteEventId) {
        // Partial failure recovery: check if a prior run created the event remotely before persisting mapping
        try {
          const existingRemote = await client.listEvents(conn.calendarId, {
            privateExtendedProperty: `pmuAppointmentId=${appointmentId}`,
            maxResults: 10,
          });
          const matched = existingRemote.items.find(
            (ev) =>
              ev.extendedProperties?.private?.pmuAppointmentId === appointmentId &&
              ev.extendedProperties?.private?.pmuStudioId === studioId
          );
          if (matched) {
            remoteEventId = matched.id;
          }
        } catch {
          // Ignore list error and proceed to create
        }
      }

      let remoteEvent: GoogleCalendarEvent;
      let syncAction: "created" | "updated";

      if (remoteEventId) {
        remoteEvent = await client.updateEvent(
          conn.calendarId,
          remoteEventId,
          eventPayload
        );
        syncAction = "updated";
      } else {
        remoteEvent = await client.createEvent(conn.calendarId, eventPayload);
        syncAction = "created";
      }

      await dbExecutor
        .insert(googleCalendarEventMappings)
        .values({
          studioId,
          connectionId: conn.id,
          appointmentId,
          googleEventId: remoteEvent.id,
          etag: remoteEvent.etag ?? null,
          lastSyncedHash: syncHash,
          status: "synced",
          lastError: null,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            googleCalendarEventMappings.connectionId,
            googleCalendarEventMappings.appointmentId,
          ],
          set: {
            googleEventId: remoteEvent.id,
            etag: remoteEvent.etag ?? null,
            lastSyncedHash: syncHash,
            status: "synced",
            lastError: null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      await dbExecutor
        .update(googleCalendarConnections)
        .set({
          lastSyncAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarConnections.id, conn.id));

      results.push({
        connectionId: conn.id,
        appointmentId,
        action: syncAction,
        googleEventId: remoteEvent.id,
      });
    } catch (err: any) {
      await dbExecutor
        .update(googleCalendarConnections)
        .set({
          syncStatus: "error",
          lastError: `Sync failed for appointment ${appointmentId}: ${err.message}`,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarConnections.id, conn.id));

      results.push({
        connectionId: conn.id,
        appointmentId,
        action: "error",
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Reconciles remote Google Calendar changes back to the CRM following Phase 12 authority rules.
 */
export async function reconcileGoogleCalendarConnection(
  context: ContextWithStudio,
  connectionId: string,
  clientFactory?: (accessToken: string) => IGoogleCalendarClient
): Promise<BatchReconciliationResult> {
  const [conn] = await db
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  if (!conn) {
    throw new Error("Google Calendar connection not found");
  }

  const result: BatchReconciliationResult = {
    connectionId,
    totalEvaluated: 0,
    rescheduledCount: 0,
    cancelledCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    const accessToken = await resolveConnectionAccessToken(conn);
    const client = clientFactory
      ? clientFactory(accessToken)
      : new GoogleCalendarApiClient(accessToken);

    // Fetch existing mappings
    const mappings = await db
      .select({
        mappingId: googleCalendarEventMappings.id,
        appointmentId: googleCalendarEventMappings.appointmentId,
        googleEventId: googleCalendarEventMappings.googleEventId,
        lastSyncedHash: googleCalendarEventMappings.lastSyncedHash,
        status: googleCalendarEventMappings.status,
        apptStartAt: appointments.startAt,
        apptEndAt: appointments.endAt,
        apptStatus: appointments.status,
        masterId: appointments.masterId,
      })
      .from(googleCalendarEventMappings)
      .innerJoin(
        appointments,
        eq(googleCalendarEventMappings.appointmentId, appointments.id)
      )
      .where(
        and(
          eq(googleCalendarEventMappings.connectionId, conn.id),
          eq(googleCalendarEventMappings.studioId, context.studioId)
        )
      );

    result.totalEvaluated = mappings.length;

    for (const mapping of mappings) {
      try {
        let remoteEvent: GoogleCalendarEvent | null = null;
        try {
          remoteEvent = await client.getEvent(conn.calendarId, mapping.googleEventId);
        } catch {
          remoteEvent = null;
        }

        const decision = await evaluateReconciliationDecision({
          crmAppointment: {
            id: mapping.appointmentId,
            startAt: new Date(mapping.apptStartAt),
            endAt: new Date(mapping.apptEndAt),
            status: mapping.apptStatus,
          },
          remoteEvent,
        });

        if (decision.action === "noop") {
          result.skippedCount++;
        } else if (decision.action === "reschedule" && decision.proposedStartsAt && decision.proposedEndsAt) {
          try {
            await rescheduleAppointment(
              db,
              { studioId: context.studioId, userId: context.userId, role: context.role ?? undefined },
              {
                appointmentId: mapping.appointmentId,
                startsAt: decision.proposedStartsAt,
                endsAt: decision.proposedEndsAt,
                reason: decision.reason,
              }
            );
            result.rescheduledCount++;
          } catch (rescheduleErr: any) {
            result.conflictCount++;
            await db
              .update(googleCalendarEventMappings)
              .set({
                status: "failed",
                lastError: `Reconcile reschedule failed: ${rescheduleErr.message}`,
                updatedAt: new Date(),
              })
              .where(eq(googleCalendarEventMappings.id, mapping.mappingId));
          }
        } else if (decision.action === "cancel") {
          try {
            await cancelAppointment(
              db,
              { studioId: context.studioId, userId: context.userId, role: context.role ?? undefined },
              {
                appointmentId: mapping.appointmentId,
                reason: decision.reason,
              }
            );
            result.cancelledCount++;
          } catch (cancelErr: any) {
            result.errors.push(`Failed to cancel appointment ${mapping.appointmentId}: ${cancelErr.message}`);
          }
        } else if (decision.action === "conflict") {
          result.conflictCount++;
          await db
            .update(googleCalendarEventMappings)
            .set({
              status: "failed",
              lastError: decision.reason,
              updatedAt: new Date(),
            })
            .where(eq(googleCalendarEventMappings.id, mapping.mappingId));
        }
      } catch (itemErr: any) {
        result.errors.push(`Error reconciling event ${mapping.googleEventId}: ${itemErr.message}`);
      }
    }

    await db
      .update(googleCalendarConnections)
      .set({
        lastSyncAt: new Date(),
        syncStatus: result.errors.length > 0 ? "error" : "idle",
        lastError: result.errors.length > 0 ? result.errors[0] : null,
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarConnections.id, conn.id));

    await writeAudit(db as unknown as Transaction, {
      studioId: context.studioId,
      userId: context.userId,
      action: "google_calendar_reconciled",
      entityType: "google_calendar_connection",
      entityId: conn.id,
      before: null,
      after: {
        totalEvaluated: result.totalEvaluated,
        rescheduledCount: result.rescheduledCount,
        cancelledCount: result.cancelledCount,
        conflictCount: result.conflictCount,
      },
      reason: "command:google_calendar_reconcile",
      reasonSource: "command",
    });
  } catch (err: any) {
    result.errors.push(`Reconciliation error: ${err.message}`);
  }

  return result;
}
