import "server-only";
import { normalizePhone } from "@/lib/phone";
import type {
  SendWhatsAppTextMessageInput,
  SendWhatsAppTemplateMessageInput,
  WhatsAppSendMessageResponse,
  WhatsAppServiceWindowStatus,
} from "../domain/types";

export interface WhatsAppClientConfig {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  apiVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class WhatsAppApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly fbtraceId?: string;

  constructor(message: string, status: number, details?: { code?: number; subcode?: number; fbtraceId?: string }) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.code = details?.code;
    this.subcode = details?.subcode;
    this.fbtraceId = details?.fbtraceId;
  }
}

export interface IWhatsAppClient {
  isConfigured(): boolean;
  sendTextMessage(input: SendWhatsAppTextMessageInput): Promise<WhatsAppSendMessageResponse>;
  sendTemplateMessage(input: SendWhatsAppTemplateMessageInput): Promise<WhatsAppSendMessageResponse>;
  checkServiceWindow(lastInboundTimestamp?: Date | null): WhatsAppServiceWindowStatus;
}

export class MetaWhatsAppCloudApiClient implements IWhatsAppClient {
  private accessToken?: string;
  private phoneNumberId?: string;
  private apiVersion: string;
  private baseUrl: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(config: WhatsAppClientConfig = {}) {
    this.accessToken = config.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = config.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.apiVersion = config.apiVersion ?? "v21.0";
    this.baseUrl = (config.baseUrl ?? "https://graph.facebook.com").replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(
      this.accessToken &&
      this.accessToken.trim().length > 0 &&
      this.phoneNumberId &&
      this.phoneNumberId.trim().length > 0
    );
  }

  /**
   * Evaluates the 24-hour customer service window under Meta WhatsApp Business Policy.
   */
  checkServiceWindow(lastInboundTimestamp?: Date | null): WhatsAppServiceWindowStatus {
    if (!lastInboundTimestamp) {
      return {
        isWithin24hWindow: false,
        lastInboundAt: null,
        windowExpiresAt: null,
      };
    }

    const lastInboundMs = new Date(lastInboundTimestamp).getTime();
    const windowMs = 24 * 60 * 60 * 1000;
    const expiresAt = new Date(lastInboundMs + windowMs);
    const now = Date.now();

    return {
      isWithin24hWindow: now <= expiresAt.getTime(),
      lastInboundAt: new Date(lastInboundTimestamp),
      windowExpiresAt: expiresAt,
    };
  }

  private sanitizeRecipient(phone: string): string {
    const normalized = normalizePhone(phone);
    return normalized.replace(/\D/g, "");
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new WhatsAppApiError(
        "LIVE WHATSAPP PROVIDER VERIFICATION NOT POSSIBLE IN CURRENT ENVIRONMENT: Access token or Phone Number ID not configured.",
        503
      );
    }

    const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/${path}`.replace(/\/+$/, "");
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        throw new WhatsAppApiError(`WhatsApp Cloud API request timed out after ${this.timeoutMs}ms`, 504);
      }
      throw new WhatsAppApiError(`WhatsApp Cloud API network error: ${err?.message || err}`, 500);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errJson: any;
      try {
        errJson = await response.json();
      } catch {
        const text = await response.text().catch(() => "");
        throw new WhatsAppApiError(`WhatsApp Cloud API error (${response.status}): ${text}`, response.status);
      }

      const fbError = errJson?.error;
      throw new WhatsAppApiError(
        `WhatsApp Cloud API error (${response.status}): ${fbError?.message || "Unknown error"}`,
        response.status,
        {
          code: fbError?.code,
          subcode: fbError?.error_subcode,
          fbtraceId: fbError?.fbtrace_id,
        }
      );
    }

    return (await response.json()) as T;
  }

  async sendTextMessage(input: SendWhatsAppTextMessageInput): Promise<WhatsAppSendMessageResponse> {
    const to = this.sanitizeRecipient(input.to);
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: Boolean(input.previewUrl),
        body: input.text,
      },
    };

    const data = await this.request<any>("messages", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      messagingProduct: data?.messaging_product || "whatsapp",
      contacts: data?.contacts || [{ input: to, wa_id: to }],
      messages: data?.messages || [{ id: `wamid.mock.${Date.now()}` }],
    };
  }

  async sendTemplateMessage(input: SendWhatsAppTemplateMessageInput): Promise<WhatsAppSendMessageResponse> {
    const to = this.sanitizeRecipient(input.to);
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: input.templateName,
        language: {
          code: input.languageCode,
        },
        components: input.components || [],
      },
    };

    const data = await this.request<any>("messages", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      messagingProduct: data?.messaging_product || "whatsapp",
      contacts: data?.contacts || [{ input: to, wa_id: to }],
      messages: data?.messages || [{ id: `wamid.mock.${Date.now()}` }],
    };
  }
}

/**
 * In-memory mock adapter for unit/integration tests and local development.
 */
export class MockWhatsAppCloudApiClient implements IWhatsAppClient {
  readonly sentMessages: Array<{
    type: "text" | "template";
    to: string;
    text?: string;
    templateName?: string;
    languageCode?: string;
    components?: any[];
    sentAt: Date;
    messageId: string;
  }> = [];

  isConfigured(): boolean {
    return true;
  }

  checkServiceWindow(lastInboundTimestamp?: Date | null): WhatsAppServiceWindowStatus {
    if (!lastInboundTimestamp) {
      return { isWithin24hWindow: false, lastInboundAt: null, windowExpiresAt: null };
    }
    const lastInboundMs = new Date(lastInboundTimestamp).getTime();
    const expiresAt = new Date(lastInboundMs + 24 * 60 * 60 * 1000);
    return {
      isWithin24hWindow: Date.now() <= expiresAt.getTime(),
      lastInboundAt: new Date(lastInboundTimestamp),
      windowExpiresAt: expiresAt,
    };
  }

  async sendTextMessage(input: SendWhatsAppTextMessageInput): Promise<WhatsAppSendMessageResponse> {
    const msgId = `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    this.sentMessages.push({
      type: "text",
      to: input.to,
      text: input.text,
      sentAt: new Date(),
      messageId: msgId,
    });

    return {
      messagingProduct: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to.replace(/\D/g, "") }],
      messages: [{ id: msgId }],
    };
  }

  async sendTemplateMessage(input: SendWhatsAppTemplateMessageInput): Promise<WhatsAppSendMessageResponse> {
    const msgId = `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    this.sentMessages.push({
      type: "template",
      to: input.to,
      templateName: input.templateName,
      languageCode: input.languageCode,
      components: input.components,
      sentAt: new Date(),
      messageId: msgId,
    });

    return {
      messagingProduct: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to.replace(/\D/g, "") }],
      messages: [{ id: msgId }],
    };
  }

  clear() {
    this.sentMessages.length = 0;
  }
}

let defaultWhatsAppClient: IWhatsAppClient | null = null;

export function getWhatsAppClient(): IWhatsAppClient {
  if (!defaultWhatsAppClient) {
    if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      defaultWhatsAppClient = new MetaWhatsAppCloudApiClient();
    } else {
      defaultWhatsAppClient = new MockWhatsAppCloudApiClient();
    }
  }
  return defaultWhatsAppClient;
}

export function setWhatsAppClient(client: IWhatsAppClient | null) {
  defaultWhatsAppClient = client;
}
