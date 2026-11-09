import { type AiProvider } from "./types";
import { FakeAiProvider } from "./fake-provider";
import { ProductionAiAdapter } from "./production-adapter";

export * from "./types";
export * from "./fake-provider";
export * from "./production-adapter";

let currentProvider: AiProvider | null = null;
let fakeProviderInstance: FakeAiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (currentProvider) {
    return currentProvider;
  }

  // If in test environment or no external API key, use FakeAiProvider
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    (!process.env.OPENAI_API_KEY && !process.env.AI_API_KEY)
  ) {
    if (!fakeProviderInstance) {
      fakeProviderInstance = new FakeAiProvider();
    }
    return fakeProviderInstance;
  }

  return new ProductionAiAdapter();
}

export function setAiProvider(provider: AiProvider | null): void {
  currentProvider = provider;
}

export function getFakeAiProvider(): FakeAiProvider {
  if (!fakeProviderInstance) {
    fakeProviderInstance = new FakeAiProvider();
  }
  return fakeProviderInstance;
}

export function resetAiProvider(): void {
  currentProvider = null;
  if (fakeProviderInstance) {
    fakeProviderInstance.reset();
  }
}
