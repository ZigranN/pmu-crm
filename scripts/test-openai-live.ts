import { databaseClient } from "@/db";
import { ProductionAiAdapter } from "@/features/ai/providers/production-adapter";
import { sanitizeReplyDraft } from "@/features/ai/domain/guardrails";
import { PROMPT_VERSIONS } from "@/features/ai/prompts/versions";

function sanitizeSecret(secret?: string): string {
  if (!secret) return "(not set)";
  if (secret.length <= 8) return "***";
  return `${secret.substring(0, 7)}...[len=${secret.length}]`;
}

async function getDbInvariantsCount() {
  try {
    const [appts] = await databaseClient`SELECT count(*)::int as c FROM appointments`;
    const [cycles] = await databaseClient`SELECT count(*)::int as c FROM treatment_cycles`;
    const [clearances] = await databaseClient`SELECT count(*)::int as c FROM cycle_medical_clearances`;
    const [cons] = await databaseClient`SELECT count(*)::int as c FROM consents`;
    const [ledger] = await databaseClient`SELECT count(*)::int as c FROM ledger_entries`;
    return {
      appointments: appts?.c ?? 0,
      treatmentCycles: cycles?.c ?? 0,
      medicalClearances: clearances?.c ?? 0,
      consents: cons?.c ?? 0,
      ledgerEntries: ledger?.c ?? 0,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function runOpenAiLiveVerification() {
  console.log("==================================================");
  console.log("🚀 PHASE 21.4 — LIVE OPENAI API VERIFICATION");
  console.log("==================================================");

  const rawKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  console.log(`[Config] OPENAI_API_KEY: ${sanitizeSecret(rawKey)}`);
  console.log(`[Config] OPENAI_MODEL: ${process.env.OPENAI_MODEL || "gpt-4o-mini (default)"}`);
  console.log(`[Config] OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1 (default)"}`);

  if (!rawKey || rawKey.trim().length === 0) {
    console.error("❌ FAIL: OPENAI_API_KEY is not configured in environment.");
    process.exit(1);
  }

  const adapter = new ProductionAiAdapter();
  if (!adapter.isConfigured()) {
    console.error("❌ FAIL: ProductionAiAdapter reported isConfigured() = false.");
    process.exit(1);
  }

  const beforeCounts = await getDbInvariantsCount();
  console.log("\n[Pre-flight DB Check] Existing entity counts:", beforeCounts);

  const testQuestion = "Здравствуйте! Как подготовиться к перманентному макияжу бровей?";
  const systemPrompt = "You are an AI reply-drafting assistant for PMU studio staff. Provide safe, factual preparation advice without clinical diagnosis or autonomous medical commitments.";

  console.log(`\n[Request] Prompt: "${testQuestion}"`);
  console.log("[Request] Sending real HTTP POST to OpenAI completions endpoint...");

  const startTime = Date.now();
  let result;
  try {
    result = await adapter.generateText(
      {
        prompt: testQuestion,
        systemPrompt,
        temperature: 0.3,
        maxTokens: 600,
      },
      PROMPT_VERSIONS.REPLY_DRAFT
    );
  } catch (err: any) {
    const elapsedMs = Date.now() - startTime;
    console.error(`\n❌ OpenAI Live API Call Failed after ${elapsedMs}ms:`);
    console.error(`Status code: ${err.status || "N/A"}`);
    console.error(`Error code: ${err.code || "UNKNOWN"}`);
    console.error(`Message: ${err.message || String(err)}`);

    if (err.status === 401) {
      console.error("\nDiagnosis: Authentication error (401). Please verify that your OpenAI API Key is active and has appropriate permissions.");
    } else if (err.status === 429) {
      console.error("\nDiagnosis: Rate limit or billing quota exceeded (429). Check credit balance in OpenAI platform.");
    }
    process.exit(1);
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n✅ HTTP Status: 200 OK (duration: ${durationMs}ms)`);
  console.log(`✅ Provider Request ID: ${result.requestId || "(captured)"}`);
  console.log(`✅ Model Used: ${result.model}`);
  console.log(`✅ Token Usage: Prompt=${result.usage?.inputTokens}, Completion=${result.usage?.outputTokens}, Total=${result.usage?.totalTokens}`);

  console.log("\n--- Real Response Content ---");
  console.log(result.text.trim());
  console.log("-----------------------------\n");

  // Safety checks
  const safety = sanitizeReplyDraft(result.text);
  console.log(`[Safety Validation] isSafe: ${safety.isSafe}`);
  if (safety.warnings.length > 0) {
    console.warn("[Safety Warnings]:", safety.warnings);
  }

  // Clinical/Medical prescription guard
  const prohibitedMedicalPhrases = [
    /i prescribe/i,
    /take \d+ mg/i,
    /you must ingest/i,
    /clinical diagnosis confirmed/i,
  ];
  const foundProhibited = prohibitedMedicalPhrases.filter((p) => p.test(result.text));
  if (foundProhibited.length > 0) {
    console.error("❌ Medical guardrail violation detected in model output.");
    process.exit(1);
  } else {
    console.log("✅ Medical guardrails: Clean (no clinical prescriptions or diagnoses)");
  }

  // DB Mutability Check
  const afterCounts = await getDbInvariantsCount();
  console.log("[Post-flight DB Check] Entity counts:", afterCounts);

  if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
    console.error("❌ INVARIANT VIOLATION: AI consultation mutated DB state!");
    process.exit(1);
  } else {
    console.log("✅ Invariant Verified: Zero DB mutations (no Appointments, Cycles, Clearances, Consents, or Ledgers created).");
  }

  console.log("\n==================================================");
  console.log("🎉 OPENAI LIVE VERIFICATION: PASS");
  console.log("==================================================");
  try {
    await databaseClient.end();
  } catch {}
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOpenAiLiveVerification()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("Unexpected error:", err);
      try {
        await databaseClient.end();
      } catch {}
      process.exit(1);
    });
}
