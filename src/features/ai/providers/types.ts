import { z } from "zod";

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: string;
  requestId?: string;
}

export interface GenerateStructuredOptions<T> {
  prompt: string;
  systemPrompt?: string;
  schema: z.ZodType<T>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateStructuredResult<T> {
  data: T;
  rawText: string;
  usage?: AiUsage;
  promptVersion: string;
  provider: string;
  model: string;
  requestId?: string;
}

export interface GenerateTextOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextResult {
  text: string;
  usage?: AiUsage;
  promptVersion: string;
  provider: string;
  model: string;
  requestId?: string;
}

export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateStructured<T>(
    options: GenerateStructuredOptions<T>,
    promptVersion: string
  ): Promise<GenerateStructuredResult<T>>;
  generateText(
    options: GenerateTextOptions,
    promptVersion: string
  ): Promise<GenerateTextResult>;
}

export class AiProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code = "AI_PROVIDER_ERROR", status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
  }
}

export class AiRateLimitError extends AiProviderError {
  constructor(message = "AI provider rate limit reached (429)") {
    super(message, "AI_RATE_LIMIT", 429);
    this.name = "AiRateLimitError";
  }
}

export class AiTimeoutError extends AiProviderError {
  constructor(message = "AI provider request timed out") {
    super(message, "AI_TIMEOUT", 504);
    this.name = "AiTimeoutError";
  }
}

export class AiMalformedOutputError extends AiProviderError {
  readonly validationErrors?: z.ZodError;
  constructor(message = "AI provider returned malformed structured output", validationErrors?: z.ZodError) {
    super(message, "AI_MALFORMED_OUTPUT", 422);
    this.name = "AiMalformedOutputError";
    this.validationErrors = validationErrors;
  }
}
