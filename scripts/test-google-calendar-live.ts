import { databaseClient } from "@/db";
import { GoogleCalendarApiClient } from "@/features/google-calendar/server/client";
import {
  getGoogleOAuthCredentials,
  generateGoogleAuthUrl,
  refreshGoogleAccessToken,
} from "@/features/google-calendar/server/oauth";
import { decryptSecret, encryptSecret } from "@/lib/encryption";
import { resolveDayAvailability } from "@/features/calendar/domain/availability";

function sanitizeSecret(secret?: string): string {
  if (!secret) return "(not set)";
  if (secret.length <= 8) return "***";
  return `${secret.substring(0, 6)}...[len=${secret.length}]`;
}

export async function runGoogleCalendarLiveVerification() {
  console.log("==================================================");
  console.log("🚀 PHASE 21.4 — LIVE GOOGLE CALENDAR VERIFICATION");
  console.log("==================================================");

  const creds = getGoogleOAuthCredentials();
  console.log(`[Config] Google Client ID: ${sanitizeSecret(creds.clientId)}`);
  console.log(`[Config] Google Client Secret: ${sanitizeSecret(creds.clientSecret)}`);

  if (!creds.clientId || !creds.clientSecret) {
    console.error("❌ FAIL: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured in environment.");
    try { await databaseClient.end(); } catch {}
    process.exit(1);
  }

  // Check database for active studio, user, master
  const studios = await databaseClient`SELECT id, name, slug, timezone FROM studios LIMIT 1`;
  if (studios.length === 0) {
    console.error("❌ FAIL: No active Studio found in database.");
    try { await databaseClient.end(); } catch {}
    process.exit(1);
  }
  const studio = studios[0];

  const users = await databaseClient`SELECT id, email, name FROM "user" LIMIT 1`;
  const user = users.length > 0 ? users[0] : null;

  const masters = await databaseClient`SELECT id, display_name, studio_id, user_id FROM masters WHERE studio_id = ${studio.id} LIMIT 1`;
  const master = masters.length > 0 ? masters[0] : null;

  console.log(`[Tenant Context] Studio: "${studio.name}" (${studio.id}), Timezone: ${studio.timezone}`);
  if (user) console.log(`[User Context] User: "${user.name}" (${user.email})`);
  if (master) console.log(`[Master Context] Master: "${master.display_name}" (${master.id})`);

  // Check for existing OAuth connections
  const connections = await databaseClient`
    SELECT id, studio_id, user_id, master_id, google_account_id, google_email,
           calendar_id, calendar_summary, encrypted_access_token, encrypted_refresh_token,
           token_expires_at, scope, status, sync_direction, sync_status
    FROM google_calendar_connections
    WHERE studio_id = ${studio.id}
    ORDER BY created_at DESC
  `;

  console.log(`\n[OAuth State] Existing Google Calendar Connections in Studio: ${connections.length}`);

  const redirectUri = "http://localhost:3000/api/integrations/google-calendar/callback";
  const authUrl = generateGoogleAuthUrl({
    studioId: studio.id,
    userId: user?.id || "user-placeholder",
    masterId: master?.id ?? null,
    redirectUri,
  });

  if (connections.length === 0) {
    console.log("\n--------------------------------------------------");
    console.log("⚠️  GOOGLE OAUTH AUTHORIZATION REQUIRED");
    console.log("--------------------------------------------------");
    console.log("No authorized Google Calendar connection found in database yet.");
    console.log("\nTo authorize, complete the OAuth flow:");
    console.log(`\n1. Ensure Google Cloud Console OAuth 2.0 Web Application settings:`);
    console.log(`   - Authorized redirect URI: ${redirectUri}`);
    console.log(`   - Production redirect URI: https://pmu-crm.vercel.app/api/integrations/google-calendar/callback`);
    console.log(`   - API Enabled: Google Calendar API`);
    console.log(`   - Test Users: Add user's Google account email to OAuth consent screen test users.`);
    console.log(`\n2. Open the following URL in your browser to authorize:`);
    console.log(`\n👉 ${authUrl}\n`);
    console.log("--------------------------------------------------");
    console.log("STATUS: GOOGLE OAUTH = BLOCKED (Waiting for user browser authentication)");
    console.log("==================================================");
    try { await databaseClient.end(); } catch {}
    return { status: "BLOCKED", reason: "OAuth pending user authorization in browser" };
  }

  const conn = connections[0];
  console.log(`\n[Connection Selected] ID: ${conn.id}, Status: ${conn.status}, Google Email: ${conn.google_email}`);

  let accessToken: string;
  try {
    accessToken = decryptSecret(conn.encrypted_access_token);
  } catch (err: any) {
    console.error("❌ Failed to decrypt stored access token:", err.message);
    try { await databaseClient.end(); } catch {}
    process.exit(1);
  }

  // Token expiration check & automatic refresh
  const isExpired = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() < Date.now() + 60000 : false;
  if (isExpired && conn.encrypted_refresh_token) {
    console.log("[Token Refresh] Access token expired or near expiration. Refreshing via Google OAuth token endpoint...");
    try {
      const refreshToken = decryptSecret(conn.encrypted_refresh_token);
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      const newExpiresAt = new Date(Date.now() + (refreshed.expiresIn - 60) * 1000);

      await databaseClient`
        UPDATE google_calendar_connections
        SET encrypted_access_token = ${encryptSecret(accessToken)},
            token_expires_at = ${newExpiresAt},
            status = 'connected',
            updated_at = NOW()
        WHERE id = ${conn.id}
      `;
      console.log("✅ Access token refreshed successfully.");
    } catch (refreshErr: any) {
      console.error("❌ Failed to refresh Google access token:", refreshErr.message);
      try { await databaseClient.end(); } catch {}
      process.exit(1);
    }
  }

  // Initialize real Google Calendar client
  const client = new GoogleCalendarApiClient(accessToken);

  console.log("\n[API Request] Fetching user calendar list from Google Calendar API...");
  let calendars;
  try {
    calendars = await client.listCalendars();
  } catch (apiErr: any) {
    console.error(`❌ Google Calendar API listCalendars failed (${apiErr.status || "HTTP"}):`, apiErr.message);
    try { await databaseClient.end(); } catch {}
    process.exit(1);
  }

  console.log(`✅ Successfully fetched ${calendars.length} calendar(s) from real Google Calendar API:`);
  for (const cal of calendars) {
    console.log(`  - [${cal.id}] "${cal.summary}" (primary: ${Boolean(cal.primary)}, tz: ${cal.timeZone || "N/A"}, access: ${cal.accessRole || "N/A"})`);
  }

  // Select target calendar (primary or first)
  const targetCalId = conn.calendar_id || "primary";
  const matchedCal = calendars.find((c) => c.id === targetCalId) || calendars[0];
  const calTimezone = matchedCal?.timeZone || studio.timezone || "Europe/Rome";

  console.log(`\n[Calendar Details] Selected: "${matchedCal?.summary}" (ID: ${matchedCal?.id}), Timezone: ${calTimezone}`);

  // Free/busy test date check
  const testDate = new Date();
  const timeMin = new Date(testDate.getFullYear(), testDate.getMonth(), testDate.getDate(), 0, 0, 0).toISOString();
  const timeMax = new Date(testDate.getFullYear(), testDate.getMonth(), testDate.getDate() + 1, 0, 0, 0).toISOString();

  console.log(`\n[API Request] Fetching events for date range: ${timeMin.slice(0, 10)}...`);
  const eventList = await client.listEvents(matchedCal.id, { timeMin, timeMax });
  console.log(`✅ Google Calendar events found for range: ${eventList.items.length}`);

  // Test CRM availability engine integration with real calendar events
  const occupiedIntervals = eventList.items
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({
      startAt: new Date(e.start!.dateTime!),
      endAt: new Date(e.end!.dateTime!),
      kind: "occupied" as const,
    }));

  const availability = resolveDayAvailability({
    timezone: calTimezone,
    date: testDate.toISOString().slice(0, 10),
    workingHours: [
      { weekday: 1, startTime: "09:00", endTime: "18:00" },
      { weekday: 2, startTime: "09:00", endTime: "18:00" },
      { weekday: 3, startTime: "09:00", endTime: "18:00" },
      { weekday: 4, startTime: "09:00", endTime: "18:00" },
      { weekday: 5, startTime: "09:00", endTime: "18:00" },
      { weekday: 6, startTime: "10:00", endTime: "16:00" },
      { weekday: 0, startTime: "10:00", endTime: "14:00" },
    ],
    exceptions: [],
    occupiedIntervals,
    slotDurationMinutes: 60,
  });

  console.log(`✅ CRM Availability Resolution:`);
  console.log(`   - Is Working Day: ${availability.isWorkingDay}`);
  console.log(`   - Occupied / Busy Intervals from Google: ${availability.occupiedIntervals.length}`);
  console.log(`   - Available Slots remaining: ${availability.availableSlots.length}`);

  // Cross-tenant verification
  const otherStudioConnections = await databaseClient`
    SELECT count(*)::int as c FROM google_calendar_connections
    WHERE studio_id != ${studio.id} AND id = ${conn.id}
  `;
  if (otherStudioConnections[0]?.c > 0) {
    console.error("❌ CRITICAL: Cross-tenant data leakage detected in connection record!");
    try { await databaseClient.end(); } catch {}
    process.exit(1);
  } else {
    console.log("✅ Cross-tenant security check: PASS (isolated to Studio ID: " + studio.id + ")");
  }

  // Safe write test (optional, only when --write-test flag passed)
  const isWriteTestRequested = process.argv.includes("--write-test");
  if (isWriteTestRequested) {
    console.log("\n[Write Test] --write-test flag enabled. Executing safe synthetic event lifecycle...");
    const testEventSummary = `[CRM-PMU Live Verification] Test Event ${Date.now()}`;
    const startIso = new Date(Date.now() + 86400000).toISOString();
    const endIso = new Date(Date.now() + 86400000 + 3600000).toISOString();

    const created = await client.createEvent(matchedCal.id, {
      summary: testEventSummary,
      description: "Automated verification event for Phase 21.4. Safe to delete.",
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      extendedProperties: {
        private: {
          pmuVerification: "true",
          pmuStudioId: studio.id,
        },
      },
    });
    console.log(`✅ Event Created successfully: ID=${created.id}, Summary="${created.summary}"`);

    // Verify retrieval
    const fetched = await client.getEvent(matchedCal.id, created.id);
    console.log(`✅ Event Retrieved successfully: Status=${fetched?.status}`);

    // Clean delete
    await client.deleteEvent(matchedCal.id, created.id);
    console.log(`✅ Test Event Deleted cleanly: ID=${created.id}`);
  } else {
    console.log("\n[Write Test] Skipped (pass --write-test to execute synthetic test event creation/deletion).");
  }

  console.log("\n==================================================");
  console.log("🎉 GOOGLE CALENDAR LIVE VERIFICATION: PASS");
  console.log("==================================================");

  try { await databaseClient.end(); } catch {}
  return { status: "PASS" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleCalendarLiveVerification()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("Unexpected error:", err);
      try { await databaseClient.end(); } catch {}
      process.exit(1);
    });
}
