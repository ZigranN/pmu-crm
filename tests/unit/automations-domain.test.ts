import { describe, it, expect } from "vitest";
import {
  appointmentReminderConfigSchema,
  conversationFollowUpConfigSchema,
  procedureFollowUpConfigSchema,
  createAutomationRuleSchema,
} from "@/features/automations/domain/types";
import {
  validateRuleConfig,
  buildAutomationEventKey,
} from "@/features/automations/domain/validation";
import { DEFAULT_AUTOMATION_RULES } from "@/features/automations/domain/defaults";

describe("Automations Domain Unit Tests", () => {
  describe("Config Validation", () => {
    it("validates appointment reminder config with negative offset (before appointment)", () => {
      const parsed = appointmentReminderConfigSchema.parse({
        offsetMinutes: -1440,
        titleTemplate: "Завтра процедура",
        priority: "normal",
      });
      expect(parsed.offsetMinutes).toBe(-1440);
      expect(parsed.titleTemplate).toBe("Завтра процедура");
    });

    it("rejects invalid offset out of bounds", () => {
      expect(() =>
        appointmentReminderConfigSchema.parse({
          offsetMinutes: 100000,
        })
      ).toThrow();
    });

    it("validates conversation follow-up config", () => {
      const parsed = conversationFollowUpConfigSchema.parse({
        durationMinutes: 45,
        titleTemplate: "Ответьте клиенту",
        priority: "high",
      });
      expect(parsed.durationMinutes).toBe(45);
      expect(parsed.priority).toBe("high");
    });

    it("validates procedure follow-up config", () => {
      const parsed = procedureFollowUpConfigSchema.parse({
        delayDays: 7,
        delayHours: 2,
        titleTemplate: "Контроль через неделю",
      });
      expect(parsed.delayDays).toBe(7);
      expect(parsed.delayHours).toBe(2);
    });

    it("validateRuleConfig routes correctly per trigger type", () => {
      const apptConfig = validateRuleConfig(
        "APPOINTMENT_CREATED",
        "CREATE_OPERATIONAL_REMINDER",
        { offsetMinutes: -120 }
      );
      expect(apptConfig).toHaveProperty("offsetMinutes", -120);

      const convConfig = validateRuleConfig(
        "CONVERSATION_INBOUND_RECEIVED",
        "CREATE_CONVERSATION_FOLLOW_UP",
        { durationMinutes: 60 }
      );
      expect(convConfig).toHaveProperty("durationMinutes", 60);

      const procConfig = validateRuleConfig(
        "PROCEDURE_COMPLETED",
        "CREATE_OPERATIONAL_REMINDER",
        { delayDays: 3 }
      );
      expect(procConfig).toHaveProperty("delayDays", 3);
    });
  });

  describe("Rule CRUD Schemas", () => {
    it("accepts valid create rule input", () => {
      const input = {
        code: "custom_reminder_48h",
        name: "Напоминание за 48 часов",
        description: "Двухдневное напоминание",
        enabled: true,
        triggerType: "APPOINTMENT_CREATED" as const,
        actionType: "CREATE_OPERATIONAL_REMINDER" as const,
        config: { offsetMinutes: -2880 },
      };
      const parsed = createAutomationRuleSchema.parse(input);
      expect(parsed.code).toBe("custom_reminder_48h");
    });

    it("rejects invalid code with spaces or special characters", () => {
      expect(() =>
        createAutomationRuleSchema.parse({
          code: "invalid code!",
          name: "Invalid",
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
        })
      ).toThrow();
    });
  });

  describe("Event Key Generator", () => {
    it("generates deterministic event key with qualifier", () => {
      const key = buildAutomationEventKey({
        ruleCode: "rem_24h",
        entityType: "appointment",
        entityId: "appt-123",
        qualifier: "2026-10-15T10:00:00.000Z",
      });
      expect(key).toBe("auto:rem_24h:appointment:appt-123:2026-10-15T10:00:00.000Z");
    });

    it("generates event key without qualifier", () => {
      const key = buildAutomationEventKey({
        ruleCode: "conv_unanswered",
        entityType: "conversation",
        entityId: "conv-456",
      });
      expect(key).toBe("auto:conv_unanswered:conversation:conv-456");
    });
  });

  describe("Defaults Registry", () => {
    it("contains standard default automation rules", () => {
      expect(DEFAULT_AUTOMATION_RULES.length).toBeGreaterThanOrEqual(4);
      const codes = DEFAULT_AUTOMATION_RULES.map((r) => r.code);
      expect(codes).toContain("appointment_reminder_24h");
      expect(codes).toContain("appointment_reminder_2h");
      expect(codes).toContain("conversation_unanswered_followup");
      expect(codes).toContain("procedure_healing_followup_3d");
    });
  });
});
