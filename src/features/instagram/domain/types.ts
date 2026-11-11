export interface InstagramAttachment {
  type: "image" | "audio" | "video" | "file" | "share" | "story_mention" | "fallback" | string;
  payload?: {
    url?: string;
    title?: string;
    reel_video_id?: string;
    [key: string]: unknown;
  };
}

export interface InstagramQuickReply {
  payload?: string;
}

export interface InstagramWebhookMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    app_id?: number | string;
    attachments?: InstagramAttachment[];
    quick_reply?: InstagramQuickReply;
    reply_to?: {
      mid?: string;
    };
    [key: string]: unknown;
  };
  reaction?: {
    mid?: string;
    action?: "react" | "unreact";
    reaction?: string;
    emoji?: string;
  };
  read?: {
    watermark?: number;
    mid?: string;
  };
  postback?: {
    title?: string;
    payload?: string;
    mid?: string;
  };
  referral?: {
    ref?: string;
    source?: string;
    type?: string;
  };
  [key: string]: unknown;
}

export interface InstagramWebhookChange {
  field: string;
  value?: Record<string, unknown>;
}

export interface InstagramWebhookEntry {
  id: string;
  time?: number;
  messaging?: InstagramWebhookMessagingEvent[];
  changes?: InstagramWebhookChange[];
}

export interface InstagramWebhookPayload {
  object: "instagram" | "page" | string;
  entry: InstagramWebhookEntry[];
}

export interface ParsedInstagramInboundMessage {
  providerMessageId: string;
  senderId: string;
  recipientId: string;
  senderUsername?: string;
  body: string;
  attachments?: InstagramAttachment[];
  timestamp: Date;
  isEcho: boolean;
  replyToMid?: string;
  rawEvent: InstagramWebhookMessagingEvent;
}

export interface SendInstagramMessageParams {
  recipientId: string;
  text: string;
  pageAccessToken?: string;
  instagramAccountId?: string;
}

export interface SendInstagramAttachmentParams {
  recipientId: string;
  attachmentType: "image" | "audio" | "video" | "file";
  attachmentUrl: string;
  pageAccessToken?: string;
  instagramAccountId?: string;
}

export interface InstagramSendMessageResult {
  recipientId: string;
  messageId: string;
}

export interface InstagramUserProfile {
  id: string;
  username?: string;
  name?: string;
  profilePic?: string;
}

export interface InstagramServiceWindow {
  isWithin24hWindow: boolean;
  lastInboundAt?: Date | null;
  expiresAt?: Date | null;
}

export interface InstagramInboundProcessResult {
  success: boolean;
  deduplicated: boolean;
  isEcho: boolean;
  ignored?: boolean;
  reason?: string;
  messageId?: string;
  conversationId?: string;
  studioId?: string;
  clientId?: string;
  error?: string;
}
