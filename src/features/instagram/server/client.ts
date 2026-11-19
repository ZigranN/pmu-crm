import "server-only";
import type {
  SendInstagramMessageParams,
  SendInstagramAttachmentParams,
  InstagramSendMessageResult,
  InstagramUserProfile,
  InstagramServiceWindow,
} from "../domain/types";

export class InstagramApiError extends Error {
  public readonly code?: number;
  public readonly subcode?: number;
  public readonly fbtraceId?: string;
  public readonly type?: string;

  constructor(message: string, details?: { code?: number; subcode?: number; fbtraceId?: string; type?: string }) {
    super(message);
    this.name = "InstagramApiError";
    this.code = details?.code;
    this.subcode = details?.subcode;
    this.fbtraceId = details?.fbtraceId;
    this.type = details?.type;
  }
}

export interface InstagramClientConfig {
  defaultAccessToken?: string;
  defaultAccountId?: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface IInstagramClient {
  evaluate24hWindow(lastInboundAt?: Date | null): InstagramServiceWindow;
  sendTextMessage(params: SendInstagramMessageParams): Promise<InstagramSendMessageResult>;
  sendAttachment(params: SendInstagramAttachmentParams): Promise<InstagramSendMessageResult>;
  getUserProfile(userId: string, pageAccessToken?: string): Promise<InstagramUserProfile | null>;
}

export class InstagramApiClient implements IInstagramClient {
  private readonly defaultAccessToken?: string;
  private readonly defaultAccountId?: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: InstagramClientConfig) {
    this.defaultAccessToken =
      config?.defaultAccessToken ||
      process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
      process.env.META_PAGE_ACCESS_TOKEN ||
      process.env.META_ACCESS_TOKEN;
    this.defaultAccountId =
      config?.defaultAccountId ||
      process.env.INSTAGRAM_ACCOUNT_ID ||
      process.env.META_INSTAGRAM_ACCOUNT_ID;
    this.apiVersion = config?.apiVersion || process.env.META_GRAPH_API_VERSION || "v21.0";
    this.baseUrl = config?.baseUrl || "https://graph.facebook.com";
    this.fetchFn = config?.fetchFn || globalThis.fetch;
  }

  /**
   * Helper to resolve access token for call.
   */
  private resolveAccessToken(overrideToken?: string): string {
    const token = overrideToken || this.defaultAccessToken;
    if (!token || token.trim().length === 0) {
      throw new InstagramApiError("Instagram Page Access Token is not configured. Please set INSTAGRAM_PAGE_ACCESS_TOKEN in environment.");
    }
    return token.trim();
  }

  /**
   * Evaluates the standard 24-hour Meta messaging policy window.
   */
  public evaluate24hWindow(lastInboundAt?: Date | null): InstagramServiceWindow {
    if (!lastInboundAt) {
      return {
        isWithin24hWindow: false,
        lastInboundAt: null,
        expiresAt: null,
      };
    }

    const windowMs = 24 * 60 * 60 * 1000;
    const expiresAt = new Date(lastInboundAt.getTime() + windowMs);
    const now = new Date();
    const isWithin24hWindow = now.getTime() <= expiresAt.getTime();

    return {
      isWithin24hWindow,
      lastInboundAt,
      expiresAt,
    };
  }

  /**
   * Sends a standard text message reply to an Instagram User via Instagram Messaging API.
   */
  async sendTextMessage(params: SendInstagramMessageParams): Promise<InstagramSendMessageResult> {
    const token = this.resolveAccessToken(params.pageAccessToken);
    const accountId = params.instagramAccountId || this.defaultAccountId || "me";

    const endpoint = `${this.baseUrl}/${this.apiVersion}/${accountId}/messages`;

    const payload = {
      recipient: {
        id: params.recipientId,
      },
      message: {
        text: params.text,
      },
      messaging_type: "RESPONSE",
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      const err = data.error || {};
      const errorMessage =
        err.message ||
        `Failed to send Instagram message. Status: ${res.status} ${res.statusText}`;

      throw new InstagramApiError(errorMessage, {
        code: err.code,
        subcode: err.error_subcode,
        fbtraceId: err.fbtrace_id,
        type: err.type,
      });
    }

    return {
      recipientId: data.recipient_id || params.recipientId,
      messageId: data.message_id || `ig_msg_${Date.now()}`,
    };
  }

  /**
   * Sends media attachment (image/audio/video/file) to an Instagram User.
   */
  async sendAttachment(params: SendInstagramAttachmentParams): Promise<InstagramSendMessageResult> {
    const token = this.resolveAccessToken(params.pageAccessToken);
    const accountId = params.instagramAccountId || this.defaultAccountId || "me";

    const endpoint = `${this.baseUrl}/${this.apiVersion}/${accountId}/messages`;

    const payload = {
      recipient: {
        id: params.recipientId,
      },
      message: {
        attachment: {
          type: params.attachmentType,
          payload: {
            url: params.attachmentUrl,
            is_reusable: true,
          },
        },
      },
      messaging_type: "RESPONSE",
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      const err = data.error || {};
      throw new InstagramApiError(err.message || `Failed to send Instagram attachment (${res.status})`, {
        code: err.code,
        subcode: err.error_subcode,
        fbtraceId: err.fbtrace_id,
        type: err.type,
      });
    }

    return {
      recipientId: data.recipient_id || params.recipientId,
      messageId: data.message_id || `ig_msg_${Date.now()}`,
    };
  }

  /**
   * Fetches user profile info (username, name) if permitted by Meta token scope.
   */
  async getUserProfile(userId: string, pageAccessToken?: string): Promise<InstagramUserProfile | null> {
    try {
      const token = this.resolveAccessToken(pageAccessToken);
      const endpoint = `${this.baseUrl}/${this.apiVersion}/${userId}?fields=id,username,name,profile_pic`;

      const res = await this.fetchFn(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json().catch(() => null);
      if (!data || data.error) {
        return null;
      }

      return {
        id: data.id || userId,
        username: data.username,
        name: data.name,
        profilePic: data.profile_pic,
      };
    } catch {
      return null;
    }
  }
}

let defaultInstagramClientInstance: IInstagramClient | null = null;

export function getInstagramClient(config?: InstagramClientConfig): IInstagramClient {
  if (defaultInstagramClientInstance) {
    return defaultInstagramClientInstance;
  }
  return new InstagramApiClient(config);
}

export function setInstagramClient(client: IInstagramClient | null) {
  defaultInstagramClientInstance = client;
}

export interface ClassifiedInstagramError {
  sanitizedMessage: string;
  formattedMessage: string;
  code?: number;
  subcode?: number;
  type?: string;
  errorType: string;
}

export function sanitizeInstagramErrorMessage(message?: unknown): string {
  if (!message || typeof message !== "string") {
    return "Unknown Instagram API error";
  }

  return message
    .replace(/EA[A-Za-z0-9_-]{10,}/g, "[REDACTED_TOKEN]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED_TOKEN]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED_SECRET]")
    .replace(/appsecret_proof=[^&\s]+/gi, "appsecret_proof=[REDACTED_PROOF]")
    .trim();
}

export function classifyInstagramError(error: unknown): ClassifiedInstagramError {
  if (error instanceof InstagramApiError) {
    const sanitized = sanitizeInstagramErrorMessage(error.message);
    let codeStr = "";
    if (error.code !== undefined) {
      codeStr = ` (Code ${error.code}${error.subcode !== undefined ? `, Subcode ${error.subcode}` : ""})`;
    }

    let errorCategory = "API_ERROR";
    if (error.code === 190) {
      errorCategory = "TOKEN_INVALID";
    } else if (error.code === 10) {
      errorCategory = "PERMISSION_DENIED";
    } else if (error.code === 100) {
      errorCategory = "INVALID_PARAMETER";
    } else if (error.code === 4 || error.code === 17 || error.code === 613) {
      errorCategory = "RATE_LIMITED";
    } else if (error.type === "OAuthException") {
      errorCategory = "OAUTH_EXCEPTION";
    }

    return {
      sanitizedMessage: sanitized,
      formattedMessage: `Instagram API error${codeStr}: ${sanitized}`,
      code: error.code,
      subcode: error.subcode,
      type: error.type,
      errorType: errorCategory,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeInstagramErrorMessage(rawMessage);

  return {
    sanitizedMessage: sanitized,
    formattedMessage: `Instagram API error: ${sanitized}`,
    errorType: "UNKNOWN_ERROR",
  };
}
