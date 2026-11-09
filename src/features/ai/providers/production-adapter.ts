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

export interface ProductionAiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export class ProductionAiAdapter implements AiProvider {
  readonly name = "openai-compatible";
  private apiKey?: string;
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: ProductionAiConfig = {}) {
    const rawKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY;
    this.apiKey = rawKey ? rawKey.trim() : undefined;
    this.baseUrl = (config.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.defaultModel = config.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.timeoutMs = config.timeoutMs ?? 20000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateStructured<T>(
    options: GenerateStructuredOptions<T>,
    promptVersion: string
  ): Promise<GenerateStructuredResult<T>> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        "LIVE AI PROVIDER VERIFICATION NOT POSSIBLE IN CURRENT ENVIRONMENT: No AI API key configured.",
        "AI_NOT_CONFIGURED",
        503
      );
    }

    const model = options.model || this.defaultModel;
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.prompt });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 1500,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === "AbortError") {
        throw new AiTimeoutError(`AI provider request timed out after ${this.timeoutMs}ms`);
      }
      throw new AiProviderError(`AI provider network request failed: ${err?.message || err}`, "AI_NETWORK_ERROR", 500);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AiRateLimitError("AI provider returned HTTP 429 Rate Limit");
    }
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new AiProviderError(
        `AI provider returned HTTP ${response.status}: ${errBody}`,
        "AI_PROVIDER_ERROR",
        response.status
      );
    }

    const json = await response.json();
    const requestId = response.headers.get("x-request-id") || json?.id || undefined;
    const rawContent = json?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      throw new AiMalformedOutputError("AI provider returned empty message content");
    }

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err: any) {
      throw new AiMalformedOutputError(`AI provider response is not valid JSON: ${err?.message}`);
    }

    const validated = options.schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new AiMalformedOutputError(
        `AI provider output did not match expected schema: ${validated.error.message}`,
        validated.error
      );
    }

    const usage = {
      inputTokens: json?.usage?.prompt_tokens,
      outputTokens: json?.usage?.completion_tokens,
      totalTokens: json?.usage?.total_tokens,
      model,
      provider: this.name,
      requestId,
    };

    return {
      data: validated.data,
      rawText: rawContent,
      usage,
      promptVersion,
      provider: this.name,
      model,
      requestId,
    };
  }

  async generateText(
    options: GenerateTextOptions,
    promptVersion: string
  ): Promise<GenerateTextResult> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        "LIVE AI PROVIDER VERIFICATION NOT POSSIBLE IN CURRENT ENVIRONMENT: No AI API key configured.",
        "AI_NOT_CONFIGURED",
        503
      );
    }

    const model = options.model || this.defaultModel;
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: options.prompt });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 1000,
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === "AbortError") {
        throw new AiTimeoutError(`AI provider request timed out after ${this.timeoutMs}ms`);
      }
      throw new AiProviderError(`AI provider network request failed: ${err?.message || err}`, "AI_NETWORK_ERROR", 500);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AiRateLimitError("AI provider returned HTTP 429 Rate Limit");
    }
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new AiProviderError(
        `AI provider returned HTTP ${response.status}: ${errBody}`,
        "AI_PROVIDER_ERROR",
        response.status
      );
    }

    const json = await response.json();
    const requestId = response.headers.get("x-request-id") || json?.id || undefined;
    const text = json?.choices?.[0]?.message?.content || "";

    const usage = {
      inputTokens: json?.usage?.prompt_tokens,
      outputTokens: json?.usage?.completion_tokens,
      totalTokens: json?.usage?.total_tokens,
      model,
      provider: this.name,
      requestId,
    };

    return {
      text,
      usage,
      promptVersion,
      provider: this.name,
      model,
      requestId,
    };
  }
}
