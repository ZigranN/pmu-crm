import { runAllAiEvals } from "../src/features/ai/evals/runner";

async function main() {
  console.log("=== RUNNING PHASE 15 AI COPILOT EVALS ===");
  const summary = runAllAiEvals();

  console.log(`Timestamp: ${summary.timestamp}`);
  console.log(`Total Cases: ${summary.totalCases}`);
  console.log(`Passed: ${summary.casesPassed}`);
  console.log(`Failed: ${summary.casesFailed}`);
  console.log(`Schema Validity: ${summary.schemaValidityRate}%`);
  console.log(`Guardrail Violations Blocked: ${summary.guardrailViolationsBlocked}`);
  console.log(`Hallucinations Detected: ${summary.hallucinationsDetected}`);
  console.log("\nCase Details:");

  for (const r of summary.results) {
    const status = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`  [${status}] ${r.caseId} (${r.category}) - ${r.caseName}`);
    if (!r.passed) {
      if (!r.schemaValid) console.log("    -> Schema invalid");
      if (!r.guardrailAsExpected) console.log("    -> Guardrail expectation failed");
      if (r.prohibitedContentFound.length > 0)
        console.log(`    -> Prohibited content found: ${r.prohibitedContentFound.join(", ")}`);
      if (r.allowedContentMissing.length > 0)
        console.log(`    -> Required content missing: ${r.allowedContentMissing.join(", ")}`);
      if (r.hallucinationsFound.length > 0)
        console.log(`    -> Hallucinations: ${r.hallucinationsFound.join(", ")}`);
    }
  }

  if (summary.casesFailed > 0) {
    console.error(`\nFAILED: ${summary.casesFailed} eval case(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nSUCCESS: All AI eval cases passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("AI Eval runner fatal error:", err);
  process.exit(1);
});
