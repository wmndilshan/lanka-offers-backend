const PeriodEngine = require('../lib/period-engine');

const auditCases = [
  "Till April 2026",
  "01st January 2026-31st March 2026",
  "25th March-20th April 2026",
  "20.04.2026 – 30.06.2026",
  "Every Friday from 3rd & 17th January 2026",
  "From March 2026 to April 2026",
  "Booking Period : 20th - Month end in Every month 2026",
  "Stay Period : 1-30 April 2026"
];

console.log("Testing Audit Fixes:");
auditCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
