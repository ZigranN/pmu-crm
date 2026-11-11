ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_channel_check";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_channel_check" CHECK ("conversation_messages"."channel" in ('MANUAL', 'WHATSAPP', 'INSTAGRAM', 'SMS', 'EMAIL'));
