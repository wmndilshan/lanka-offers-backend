const PeriodEngine = require('../lib/period-engine');

const testCases = [
  "Valid from 2026-01-15 to 2026-04-30",
  "Valid From 2026-03-01 to 2026-04-30",
  "Valid Until 2026-04-30",
  "Valid until 2026-04-30",
  "Valid 2026-03-15 to 2026-04-20",
  "Valid from 2026-03-01 to 2026-03-08 & 2026-03-30 to 2026-04-30",
  "Valid (Until stock lasts) from 2026-03-15 to 2026-04-30",
  "Valid Until 20th March to 2026-04-20",
  "Valid 1st to 2026-04-20"
];

console.log("Testing current PeriodEngine.parse:");
testCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
