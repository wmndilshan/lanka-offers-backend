const PeriodEngine = require('../lib/period-engine');

const seylanCases = [
  "Valid until 30th April 2026",
  "Valid from 15th March - 30th April 2026",
  "Valid from 01.04.2026 - 30.04.2026",
  "Valid on 18th & 19th April 2026",
  "Valid on 10th, 11th, 12th, 27th and 28th April 2026.",
  "Valid on 8th & 9th of March | 27th & 28th of April 2026",
  "Valid every Saturday until 25th April 2026",
  "Validity Period: 1st April to 30th June 2026",
  "• Validity: 1st April – 30th June 2026",
  "Special Offer valid from 25th March - 15th April 2026",
  "Avurudu Offer valid on 28th & 29th March 2026",
  "Discount valid until ; 01st - 30th April 2026",
  "EPP valid until ; 31st December 2026",
  "EPP valid until 31st Decmber 2026",
  "Booking Period : 1st March - 30th April, 2026",
  "Booking Period : 1-30th April 2026",
  "Stay period – 1st April 2026 – 30th June 2026",
  "Stay period : 01st Apr to 30th of June 2026",
  "Blackout Period : 13th and 14th April, 2026",
  "Cyber Monday - Every Monday till 31st December 2026",
  "Event Period - 5th, 12th, and 19th of April 2026",
  "period 01.04.2026 to 30.04.2026"
];

console.log("Testing Seylan Bank Patterns:");
seylanCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
