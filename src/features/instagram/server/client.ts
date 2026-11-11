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

export class InstagramApiClient {
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

let defaultInstagramClientInstance: InstagramApiClient | null = null;

export function getInstagramClient(): InstagramApiClient {
  if (!defaultInstagramClientInstance) {
    defaultInstagramClientInstance = new InstagramApiClient();
  }
  return defaultInstagramClientInstance;
}
