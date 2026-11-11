import "server-only";
import type {
  InstagramWebhookPayload,
  ParsedInstagramInboundMessage,
  InstagramAttachment,
} from "../domain/types";

/**
 * Generates a human-readable text representation for messages that contain attachments or interactive elements.
 */
function buildBodyFromAttachments(
  text: string | undefined,
  attachments?: InstagramAttachment[],
  quickReplyPayload?: string
): string {
  const trimmedText = text?.trim();
  if (trimmedText && trimmedText.length > 0) {
    return trimmedText;
  }

  if (quickReplyPayload) {
    return `[Выбор: ${quickReplyPayload}]`;
  }

  if (!attachments || attachments.length === 0) {
    return "[Пустое сообщение]";
  }

  const descriptions: string[] = [];

  for (const att of attachments) {
    switch (att.type) {
      case "image":
        descriptions.push("[Изображение]");
        break;
      case "audio":
        descriptions.push("[Голосовое сообщение]");
        break;
      case "video":
        descriptions.push("[Видео]");
        break;
      case "file":
        descriptions.push(`[Файл${att.payload?.title ? `: ${att.payload.title}` : ""}]`);
        break;
      case "share":
        descriptions.push("[Поделился публикацией / Reels]");
        break;
      case "story_mention":
        descriptions.push("[Упоминание в истории]");
        break;
      case "fallback":
        descriptions.push("[Вложение]");
        break;
      default:
        descriptions.push(`[Вложение: ${att.type}]`);
        break;
    }
  }

  return descriptions.join(" ");
}

/**
 * Parses raw Meta Instagram Webhook payload into structured inbound messages.
 */
export function parseInstagramWebhookMessages(
  payload: InstagramWebhookPayload
): ParsedInstagramInboundMessage[] {
  const messages: ParsedInstagramInboundMessage[] = [];

  if (!payload || !Array.isArray(payload.entry)) {
    return messages;
  }

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.messaging)) {
      continue;
    }

    for (const event of entry.messaging) {
      // 1. Regular or attachment message
      if (event.message && event.message.mid && event.sender?.id && event.recipient?.id) {
        const text = event.message.text;
        const attachments = event.message.attachments;
        const quickReply = event.message.quick_reply?.payload;
        const body = buildBodyFromAttachments(text, attachments, quickReply);

        const rawTimestamp = event.timestamp ?? entry.time ?? Date.now();
        const timestamp = new Date(rawTimestamp > 1e11 ? rawTimestamp : rawTimestamp * 1000);

        messages.push({
          providerMessageId: event.message.mid,
          senderId: event.sender.id,
          recipientId: event.recipient.id,
          body,
          attachments,
          timestamp,
          isEcho: Boolean(event.message.is_echo),
          replyToMid: event.message.reply_to?.mid,
          rawEvent: event,
        });
        continue;
      }

      // 2. Postback interaction (e.g. "Get Started" or Icebreaker buttons)
      if (event.postback && event.sender?.id && event.recipient?.id) {
        const postbackMid = event.postback.mid || `postback_${event.sender.id}_${event.timestamp || Date.now()}`;
        const rawTimestamp = event.timestamp ?? entry.time ?? Date.now();
        const timestamp = new Date(rawTimestamp > 1e11 ? rawTimestamp : rawTimestamp * 1000);
        const title = event.postback.title || event.postback.payload || "Кнопка действия";

        messages.push({
          providerMessageId: postbackMid,
          senderId: event.sender.id,
          recipientId: event.recipient.id,
          body: `[Нажата кнопка: ${title}]`,
          timestamp,
          isEcho: false,
          rawEvent: event,
        });
        continue;
      }

      // 3. Reactions to messages
      if (event.reaction && event.reaction.mid && event.sender?.id && event.recipient?.id) {
        const reactionEmoji = event.reaction.emoji || event.reaction.reaction || "❤️";
        const isUnreact = event.reaction.action === "unreact";
        const rawTimestamp = event.timestamp ?? entry.time ?? Date.now();
        const timestamp = new Date(rawTimestamp > 1e11 ? rawTimestamp : rawTimestamp * 1000);
        const reactionMid = `reaction_${event.reaction.mid}_${event.sender.id}_${rawTimestamp}`;

        messages.push({
          providerMessageId: reactionMid,
          senderId: event.sender.id,
          recipientId: event.recipient.id,
          body: isUnreact ? `[Удалена реакция]` : `[Реакция: ${reactionEmoji}]`,
          timestamp,
          isEcho: false,
          replyToMid: event.reaction.mid,
          rawEvent: event,
        });
      }
    }
  }

  return messages;
}
