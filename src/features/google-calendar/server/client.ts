import "server-only";

import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../domain/types";

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";

export interface IGoogleCalendarClient {
  listCalendars(): Promise<GoogleCalendarListEntry[]>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent | null>;
  createEvent(calendarId: string, eventData: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent>;
  updateEvent(calendarId: string, eventId: string, eventData: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<boolean>;
  listEvents(
    calendarId: string,
    params?: {
      timeMin?: string;
      timeMax?: string;
      syncToken?: string;
      pageToken?: string;
      maxResults?: number;
      privateExtendedProperty?: string;
    }
  ): Promise<{ items: GoogleCalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }>;
}

export class GoogleCalendarApiClient implements IGoogleCalendarClient {
  private accessToken: string;
  private fetchFn: typeof fetch;

  constructor(accessToken: string, fetchFn: typeof fetch = fetch) {
    this.accessToken = accessToken;
    this.fetchFn = fetchFn;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${GOOGLE_CALENDAR_BASE_URL}${path}`;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    const response = await this.fetchFn(url, { ...options, headers });

    if (response.status === 404) {
      return null as T;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Google Calendar API error (${response.status}): ${errorText}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  async listCalendars(): Promise<GoogleCalendarListEntry[]> {
    const data = await this.request<{ items?: GoogleCalendarListEntry[] }>("/users/me/calendarList");
    return data?.items ?? [];
  }

  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent | null> {
    const encodedCal = encodeURIComponent(calendarId);
    const encodedEvent = encodeURIComponent(eventId);
    return await this.request<GoogleCalendarEvent>(`/calendars/${encodedCal}/events/${encodedEvent}`);
  }

  async createEvent(calendarId: string, eventData: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    const encodedCal = encodeURIComponent(calendarId);
    return await this.request<GoogleCalendarEvent>(`/calendars/${encodedCal}/events`, {
      method: "POST",
      body: JSON.stringify(eventData),
    });
  }

  async updateEvent(calendarId: string, eventId: string, eventData: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    const encodedCal = encodeURIComponent(calendarId);
    const encodedEvent = encodeURIComponent(eventId);
    return await this.request<GoogleCalendarEvent>(`/calendars/${encodedCal}/events/${encodedEvent}`, {
      method: "PUT",
      body: JSON.stringify(eventData),
    });
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<boolean> {
    const encodedCal = encodeURIComponent(calendarId);
    const encodedEvent = encodeURIComponent(eventId);
    try {
      await this.request<void>(`/calendars/${encodedCal}/events/${encodedEvent}`, {
        method: "DELETE",
      });
      return true;
    } catch (err: any) {
      if (err.status === 404 || err.status === 410) {
        return true;
      }
      throw err;
    }
  }

  async listEvents(
    calendarId: string,
    params: {
      timeMin?: string;
      timeMax?: string;
      syncToken?: string;
      pageToken?: string;
      maxResults?: number;
      privateExtendedProperty?: string;
    } = {}
  ): Promise<{ items: GoogleCalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }> {
    const encodedCal = encodeURIComponent(calendarId);
    const query = new URLSearchParams();

    if (params.timeMin) query.set("timeMin", params.timeMin);
    if (params.timeMax) query.set("timeMax", params.timeMax);
    if (params.syncToken) query.set("syncToken", params.syncToken);
    if (params.pageToken) query.set("pageToken", params.pageToken);
    if (params.maxResults) query.set("maxResults", String(params.maxResults));
    if (params.privateExtendedProperty) query.set("privateExtendedProperty", params.privateExtendedProperty);
    query.set("singleEvents", "true");

    const queryString = query.toString();
    const path = `/calendars/${encodedCal}/events${queryString ? `?${queryString}` : ""}`;
    const data = await this.request<{ items?: GoogleCalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }>(path);

    return {
      items: data?.items ?? [],
      nextSyncToken: data?.nextSyncToken,
      nextPageToken: data?.nextPageToken,
    };
  }
}
