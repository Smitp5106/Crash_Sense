/**
 * CrashSense Automated Test Runner
 *
 * Executes all 17 telematics scenarios and prints a formatted verification report.
 */

const { runScenarioTests } = require('./scenarios.test');

async function main() {
  console.log('================================================================');
  console.log('     CrashSense Telematics Automated Scenario Test Suite       ');
  console.log('================================================================');
  console.log('Target: Embedded Collision Detection, GNSS, SIM7600 & Alert Engine\n');

  const startTime = Date.now();
  const results = await runScenarioTests();
  const totalDuration = Date.now() - startTime;

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.passed) {
      passed++;
      console.log(`  [PASS] ${r.name} (${r.durationMs}ms)`);
    } else {
      failed++;
      console.log(`  [FAIL] ${r.name} (${r.durationMs}ms)`);
      console.log(`         Error: ${r.error}`);
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${results.length} Scenarios`);
  console.log(`Total Execution Time: ${totalDuration}ms`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
