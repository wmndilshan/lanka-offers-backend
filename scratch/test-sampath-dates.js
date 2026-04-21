const PeriodEngine = require('../lib/period-engine');

const sampathCases = [
  "Valid till 30th April 2026",
  "Valid from 01st March to 30th April 2026",
  "Valid from 01st to 30th April 2026",
  "Valid From 27th to 29th March 2026",
  "Valid from 1st April to 30th June 2026",
  "Valid 01st March to 30th April 2026",
  "Valid from 15th March to 30 June 2026",
  "Valid from 01st April ti 30th June 2026",
  "Valid from 01st April to 31th October 2026",
  "Valid before 30th April 2026",
  "Valid only on 26th March & 28th April 2026",
  "Offer is valid every Monday, Friday & Saturday from 07th to 28th July 2025, 6:00 - 7:00 PM.",
  "Promotional Period - Valid till 30th June 2026",
  "Promotional Period - Valid From 1st April to 30th June 2026"
];

console.log("Testing Sampath Bank Patterns:");
sampathCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
