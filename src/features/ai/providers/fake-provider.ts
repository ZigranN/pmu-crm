import {
  type AiProvider,
  type GenerateStructuredOptions,
  type GenerateStructuredResult,
  type GenerateTextOptions,
  type GenerateTextResult,
  AiMalformedOutputError,
  AiRateLimitError,
  AiTimeoutError,
  AiProviderError,
} from "./types";

export type FakeStructuredHandler = (
  options: GenerateStructuredOptions<any>,
  promptVersion: string
) => any;

export type FakeTextHandler = (
  options: GenerateTextOptions,
  promptVersion: string
) => string;

export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  private defaultModel = "fake-copilot-v1";
  
  isConfigured(): boolean {
    return true;
  }
  
  public structuredHandler?: FakeStructuredHandler;
  public textHandler?: FakeTextHandler;
  
  public simulateRateLimit = false;
  public simulateTimeout = false;
  public simulateNetworkError = false;
  public simulateMalformedJson = false;

  public callHistory: Array<{
    type: "structured" | "text";
    prompt: string;
    systemPrompt?: string;
    promptVersion: string;
    timestamp: Date;
  }> = [];

  constructor(defaultModel = "fake-copilot-v1") {
    this.defaultModel = defaultModel;
  }

  reset() {
    this.structuredHandler = undefined;
    this.textHandler = undefined;
    this.simulateRateLimit = false;
    this.simulateTimeout = false;
    this.simulateNetworkError = false;
    this.simulateMalformedJson = false;
    this.callHistory = [];
  }

  async generateStructured<T>(
    options: GenerateStructuredOptions<T>,
    promptVersion: string
  ): Promise<GenerateStructuredResult<T>> {
    this.callHistory.push({
      type: "structured",
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      promptVersion,
      timestamp: new Date(),
    });

    if (this.simulateRateLimit) {
      throw new AiRateLimitError("Fake provider: simulated 429 rate limit");
    }
    if (this.simulateTimeout) {
      throw new AiTimeoutError("Fake provider: simulated timeout");
    }
    if (this.simulateNetworkError) {
      throw new AiProviderError("Fake provider: simulated network failure", "AI_NETWORK_ERROR", 500);
    }
    if (this.simulateMalformedJson) {
      throw new AiMalformedOutputError("Fake provider: malformed JSON output");
    }

    let rawValue: any;
    if (this.structuredHandler) {
      rawValue = this.structuredHandler(options, promptVersion);
    } else {
      rawValue = this.generateDefaultMock(promptVersion);
    }

    // Validate with Zod
    const parseResult = options.schema.safeParse(rawValue);
    if (!parseResult.success) {
      throw new AiMalformedOutputError(
        `Output schema validation failed: ${parseResult.error.message}`,
        parseResult.error
      );
    }

    return {
      data: parseResult.data,
      rawText: JSON.stringify(rawValue),
      usage: {
        inputTokens: 150,
        outputTokens: 75,
        totalTokens: 225,
        model: options.model || this.defaultModel,
        provider: this.name,
      },
      promptVersion,
      provider: this.name,
      model: options.model || this.defaultModel,
    };
  }

  async generateText(
    options: GenerateTextOptions,
    promptVersion: string
  ): Promise<GenerateTextResult> {
    this.callHistory.push({
      type: "text",
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      promptVersion,
      timestamp: new Date(),
    });

    if (this.simulateRateLimit) {
      throw new AiRateLimitError("Fake provider: simulated 429 rate limit");
    }
    if (this.simulateTimeout) {
      throw new AiTimeoutError("Fake provider: simulated timeout");
    }
    if (this.simulateNetworkError) {
      throw new AiProviderError("Fake provider: simulated network failure", "AI_NETWORK_ERROR", 500);
    }

    let text: string;
    if (this.textHandler) {
      text = this.textHandler(options, promptVersion);
    } else {
      text = `Fake generated text for ${promptVersion}`;
    }

    return {
      text,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        model: options.model || this.defaultModel,
        provider: this.name,
      },
      promptVersion,
      provider: this.name,
      model: options.model || this.defaultModel,
    };
  }

  private generateDefaultMock(promptVersion: string): any {
    switch (promptVersion) {
      case "client_summary.v1":
        return {
          summary: "Client has completed initial consultation and is in active treatment planning.",
          blockers: [],
          suggestedActions: [
            {
              id: "act-1",
              label: "Review Treatment Plan",
              actionType: "VIEW_CLIENT",
              description: "Review client profile and schedule upcoming visit.",
            },
          ],
          dataConfidence: "high",
          sourceCitations: ["client_record", "cycle_history"],
        };

      case "conversation_summary.v1":
        return {
          summary: "Client inquired about aftercare guidelines and requested appointment details.",
          openQuestions: ["What are the next available slots?"],
          latestClientIntent: "booking_inquiry",
          unansweredItems: ["availability confirmation"],
          referencedMessageIds: [],
        };

      case "reply_draft.v1":
        return {
          draftReply: "Hello! Thank you for reaching out. We have received your inquiry and are happy to help.",
          tone: "professional",
          rationale: "Addresses client question directly and politely.",
          suggestedFollowUpAction: "Schedule a consultation visit",
        };

      case "next_action_suggestion.v1":
        return {
          suggestedActions: [
            {
              id: "act-next-1",
              label: "Open Conversation",
              actionType: "OPEN_CONVERSATION",
              description: "Follow up with client regarding their latest message.",
            },
          ],
          blockers: [],
          rationale: "Recent inbound message requires staff response.",
        };

      case "needs_attention_explain.v1":
        return {
          explanation: "This item requires attention due to pending items.",
          deterministicReasonSummary: "Pending client action or review required.",
          recommendedHumanNextSteps: [
            "Review client details",
            "Contact client if necessary",
          ],
          blockers: [],
        };

      default:
        return {
          summary: "Default mock response for prompt",
          blockers: [],
          suggestedActions: [],
        };
    }
  }
}
