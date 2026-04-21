const PeriodEngine = require('../lib/period-engine');

console.log("Testing parseHumanDate:");
const dates = ["2026-01-15", "2026-04-30", "20th March", "1st"];
dates.forEach(d => {
  console.log(`"${d}" -> ${PeriodEngine.parseHumanDate(d, 2026)}`);
});

console.log("\nTesting parse patterns:");
console.log(`"Valid 2026-03-15 to 2026-04-20" -> ${JSON.stringify(PeriodEngine.parse("Valid 2026-03-15 to 2026-04-20"), null, 2)}`);
console.log(`"Valid 1st to 2026-04-20" -> ${JSON.stringify(PeriodEngine.parse("Valid 1st to 2026-04-20"), null, 2)}`);
