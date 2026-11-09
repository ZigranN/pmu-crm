export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number?: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: {
          name: string;
        };
        wa_id: string;
      }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        text?: {
          body: string;
        };
        interactive?: {
          type: string;
          button_reply?: { id: string; title: string };
          list_reply?: { id: string; title: string; description?: string };
        };
      }>;
      statuses?: Array<{
        id: string;
        status: "sent" | "delivered" | "read" | "failed";
        timestamp: string;
        recipient_id: string;
        errors?: Array<{
          code: number;
          title: string;
          message?: string;
        }>;
      }>;
    };
    field: string;
  }>;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface ParsedWhatsAppInboundMessage {
  providerMessageId: string;
  fromPhone: string;
  senderName?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  body: string;
  timestamp: Date;
  rawPayload: any;
}

export interface ParsedWhatsAppStatusUpdate {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  recipientPhone: string;
  errorCode?: number;
  errorMessage?: string;
  rawPayload: any;
}

export interface SendWhatsAppTextMessageInput {
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface SendWhatsAppTemplateMessageInput {
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<Record<string, unknown>>;
}

export interface WhatsAppSendMessageResponse {
  messagingProduct: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface WhatsAppServiceWindowStatus {
  isWithin24hWindow: boolean;
  lastInboundAt: Date | null;
  windowExpiresAt: Date | null;
}
