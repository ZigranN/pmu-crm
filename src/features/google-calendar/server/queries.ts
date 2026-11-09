import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  googleCalendarConnections,
  googleCalendarEventMappings,
  masters,
  user,
  appointments,
  type GoogleCalendarConnectionStatus,
  type GoogleCalendarSyncDirection,
  type GoogleCalendarSyncStatus,
  type GoogleCalendarMappingStatus,
} from "@/db/schema";
import { sensitiveRead, recordIds, optionalRecordId } from "@/server/services/access-log.service";

export interface GoogleCalendarConnectionView {
  id: string;
  studioId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  masterId: string | null;
  masterName: string | null;
  googleAccountId: string | null;
  googleEmail: string | null;
  calendarId: string;
  calendarSummary: string | null;
  scope: string;
  status: GoogleCalendarConnectionStatus;
  syncDirection: GoogleCalendarSyncDirection;
  syncStatus: GoogleCalendarSyncStatus;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedEventCount: number;
}

export interface GoogleCalendarStatsSummary {
  totalConnections: number;
  activeConnections: number;
  totalSyncedEvents: number;
  errorConnections: number;
  lastSyncAt: Date | null;
}

export interface GoogleCalendarEventMappingView {
  id: string;
  studioId: string;
  connectionId: string;
  appointmentId: string;
  googleEventId: string;
  status: GoogleCalendarMappingStatus;
  lastError: string | null;
  lastSyncedAt: Date;
  appointmentStartAt?: Date | null;
  appointmentEndAt?: Date | null;
  appointmentStatus?: string | null;
}

/**
 * Returns all Google Calendar connections for the studio.
 */
export async function getGoogleCalendarConnections(): Promise<GoogleCalendarConnectionView[]> {
  return sensitiveRead(
    "INTEGRATION_READ",
    undefined,
    { operation: "google_calendar.connections.list" },
    async (context) => {
      const studioId = context.studioId;

      const rows = await db
        .select({
          id: googleCalendarConnections.id,
          studioId: googleCalendarConnections.studioId,
          userId: googleCalendarConnections.userId,
          userName: user.name,
          userEmail: user.email,
          masterId: googleCalendarConnections.masterId,
          masterName: masters.displayName,
          googleAccountId: googleCalendarConnections.googleAccountId,
          googleEmail: googleCalendarConnections.googleEmail,
          calendarId: googleCalendarConnections.calendarId,
          calendarSummary: googleCalendarConnections.calendarSummary,
          scope: googleCalendarConnections.scope,
          status: googleCalendarConnections.status,
          syncDirection: googleCalendarConnections.syncDirection,
          syncStatus: googleCalendarConnections.syncStatus,
          encryptedAccessToken: googleCalendarConnections.encryptedAccessToken,
          encryptedRefreshToken: googleCalendarConnections.encryptedRefreshToken,
          tokenExpiresAt: googleCalendarConnections.tokenExpiresAt,
          lastSyncAt: googleCalendarConnections.lastSyncAt,
          lastError: googleCalendarConnections.lastError,
          createdAt: googleCalendarConnections.createdAt,
          updatedAt: googleCalendarConnections.updatedAt,
          syncedEventCount: sql<number>`cast(count(${googleCalendarEventMappings.id}) as integer)`,
        })
        .from(googleCalendarConnections)
        .leftJoin(user, eq(googleCalendarConnections.userId, user.id))
        .leftJoin(masters, eq(googleCalendarConnections.masterId, masters.id))
        .leftJoin(
          googleCalendarEventMappings,
          and(
            eq(googleCalendarEventMappings.connectionId, googleCalendarConnections.id),
            eq(googleCalendarEventMappings.status, "synced")
          )
        )
        .where(eq(googleCalendarConnections.studioId, studioId))
        .groupBy(
          googleCalendarConnections.id,
          user.name,
          user.email,
          masters.displayName
        )
        .orderBy(desc(googleCalendarConnections.createdAt));

      return rows.map((r) => ({
        id: r.id,
        studioId: r.studioId,
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        masterId: r.masterId,
        masterName: r.masterName,
        googleAccountId: r.googleAccountId,
        googleEmail: r.googleEmail,
        calendarId: r.calendarId,
        calendarSummary: r.calendarSummary,
        scope: r.scope,
        status: r.status,
        syncDirection: r.syncDirection,
        syncStatus: r.syncStatus,
        hasAccessToken: Boolean(r.encryptedAccessToken),
        hasRefreshToken: Boolean(r.encryptedRefreshToken),
        tokenExpiresAt: r.tokenExpiresAt ? new Date(r.tokenExpiresAt) : null,
        lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
        lastError: r.lastError,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        syncedEventCount: r.syncedEventCount ?? 0,
      }));
    },
    recordIds
  );
}

/**
 * Returns a single Google Calendar connection by ID.
 */
export async function getGoogleCalendarConnectionById(
  connectionId: string
): Promise<GoogleCalendarConnectionView | null> {
  return sensitiveRead(
    "INTEGRATION_READ",
    undefined,
    { operation: "google_calendar.connection.read", targetId: connectionId },
    async (context) => {
      const [r] = await db
        .select({
          id: googleCalendarConnections.id,
          studioId: googleCalendarConnections.studioId,
          userId: googleCalendarConnections.userId,
          userName: user.name,
          userEmail: user.email,
          masterId: googleCalendarConnections.masterId,
          masterName: masters.displayName,
          googleAccountId: googleCalendarConnections.googleAccountId,
          googleEmail: googleCalendarConnections.googleEmail,
          calendarId: googleCalendarConnections.calendarId,
          calendarSummary: googleCalendarConnections.calendarSummary,
          scope: googleCalendarConnections.scope,
          status: googleCalendarConnections.status,
          syncDirection: googleCalendarConnections.syncDirection,
          syncStatus: googleCalendarConnections.syncStatus,
          encryptedAccessToken: googleCalendarConnections.encryptedAccessToken,
          encryptedRefreshToken: googleCalendarConnections.encryptedRefreshToken,
          tokenExpiresAt: googleCalendarConnections.tokenExpiresAt,
          lastSyncAt: googleCalendarConnections.lastSyncAt,
          lastError: googleCalendarConnections.lastError,
          createdAt: googleCalendarConnections.createdAt,
          updatedAt: googleCalendarConnections.updatedAt,
          syncedEventCount: sql<number>`cast(count(${googleCalendarEventMappings.id}) as integer)`,
        })
        .from(googleCalendarConnections)
        .leftJoin(user, eq(googleCalendarConnections.userId, user.id))
        .leftJoin(masters, eq(googleCalendarConnections.masterId, masters.id))
        .leftJoin(
          googleCalendarEventMappings,
          and(
            eq(googleCalendarEventMappings.connectionId, googleCalendarConnections.id),
            eq(googleCalendarEventMappings.status, "synced")
          )
        )
        .where(
          and(
            eq(googleCalendarConnections.id, connectionId),
            eq(googleCalendarConnections.studioId, context.studioId)
          )
        )
        .groupBy(
          googleCalendarConnections.id,
          user.name,
          user.email,
          masters.displayName
        );

      if (!r) return null;

      return {
        id: r.id,
        studioId: r.studioId,
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        masterId: r.masterId,
        masterName: r.masterName,
        googleAccountId: r.googleAccountId,
        googleEmail: r.googleEmail,
        calendarId: r.calendarId,
        calendarSummary: r.calendarSummary,
        scope: r.scope,
        status: r.status,
        syncDirection: r.syncDirection,
        syncStatus: r.syncStatus,
        hasAccessToken: Boolean(r.encryptedAccessToken),
        hasRefreshToken: Boolean(r.encryptedRefreshToken),
        tokenExpiresAt: r.tokenExpiresAt ? new Date(r.tokenExpiresAt) : null,
        lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
        lastError: r.lastError,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        syncedEventCount: r.syncedEventCount ?? 0,
      };
    },
    optionalRecordId
  );
}

/**
 * Returns overall Google Calendar integration statistics.
 */
export async function getGoogleCalendarStats(): Promise<GoogleCalendarStatsSummary> {
  return sensitiveRead(
    "INTEGRATION_READ",
    undefined,
    { operation: "google_calendar.connections.list" },
    async (context) => {
      const studioId = context.studioId;

      const [connStats] = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          active: sql<number>`cast(count(*) filter (where ${googleCalendarConnections.status} = 'connected') as integer)`,
          errors: sql<number>`cast(count(*) filter (where ${googleCalendarConnections.status} in ('needs_reauth', 'sync_error')) as integer)`,
          lastSyncAt: sql<Date | null>`max(${googleCalendarConnections.lastSyncAt})`,
        })
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.studioId, studioId));

      const [mappingStats] = await db
        .select({
          totalSynced: sql<number>`cast(count(*) filter (where ${googleCalendarEventMappings.status} = 'synced') as integer)`,
        })
        .from(googleCalendarEventMappings)
        .where(eq(googleCalendarEventMappings.studioId, studioId));

      return {
        totalConnections: connStats?.total ?? 0,
        activeConnections: connStats?.active ?? 0,
        errorConnections: connStats?.errors ?? 0,
        totalSyncedEvents: mappingStats?.totalSynced ?? 0,
        lastSyncAt: connStats?.lastSyncAt ? new Date(connStats.lastSyncAt) : null,
      };
    },
    () => []
  );
}

/**
 * Returns mapped events for a given connection or studio.
 */
export async function getGoogleCalendarEventMappings(
  connectionId?: string
): Promise<GoogleCalendarEventMappingView[]> {
  return sensitiveRead(
    "INTEGRATION_READ",
    undefined,
    { operation: "google_calendar.events.list" },
    async (context) => {
      const studioId = context.studioId;

      const conditions = [eq(googleCalendarEventMappings.studioId, studioId)];
      if (connectionId) {
        conditions.push(eq(googleCalendarEventMappings.connectionId, connectionId));
      }

      const rows = await db
        .select({
          id: googleCalendarEventMappings.id,
          studioId: googleCalendarEventMappings.studioId,
          connectionId: googleCalendarEventMappings.connectionId,
          appointmentId: googleCalendarEventMappings.appointmentId,
          googleEventId: googleCalendarEventMappings.googleEventId,
          status: googleCalendarEventMappings.status,
          lastError: googleCalendarEventMappings.lastError,
          lastSyncedAt: googleCalendarEventMappings.lastSyncedAt,
          startAt: appointments.startAt,
          endAt: appointments.endAt,
          appointmentStatus: appointments.status,
        })
        .from(googleCalendarEventMappings)
        .leftJoin(appointments, eq(googleCalendarEventMappings.appointmentId, appointments.id))
        .where(and(...conditions))
        .orderBy(desc(googleCalendarEventMappings.lastSyncedAt))
        .limit(100);

      return rows.map((r) => ({
        id: r.id,
        studioId: r.studioId,
        connectionId: r.connectionId,
        appointmentId: r.appointmentId,
        googleEventId: r.googleEventId,
        status: r.status,
        lastError: r.lastError,
        lastSyncedAt: new Date(r.lastSyncedAt),
        appointmentStartAt: r.startAt ? new Date(r.startAt) : null,
        appointmentEndAt: r.endAt ? new Date(r.endAt) : null,
        appointmentStatus: r.appointmentStatus,
      }));
    },
    recordIds
  );
}
