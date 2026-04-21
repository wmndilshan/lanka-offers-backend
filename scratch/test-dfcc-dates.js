const PeriodEngine = require('../lib/period-engine');

const dfccCases = [
  "Valid till 30th April 2026",
  "Valid from 01st March to 30th April 2026",
  "Valid on 17th April 2026",
  "Valid on Every Tuesday from 03rd March to 28th April 2026",
  "15th March to 30th April 2026",
  "01st January 2026 to 30th November 2027",
  "01st to 30th of April 2026",
  "08th & 09th April 2026",
  "14th March & 12th April 2026",
  "23rd to 30th March and 6th to 14th April 2026",
  "26th to 29th March and 09th, 10th April 2026",
  "28th, 29th March & 09th to 12th April 2026",
  "21st, 22nd March and 01st, 11th April 2026",
  "08th – 15th March & 13th – 19th April 2026",
  "Every Monday from 13th to 27th April 2026",
  "Every Friday from 17th & 24th April 2026",
  "Offer Period: 07th January to 30th April 2026",
  "Booking & Stay Period: 01st to 30th of April 2026",
  "01st March 2026 to 31 March 2027"
];

console.log("Testing DFCC Bank Patterns:");
dfccCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
