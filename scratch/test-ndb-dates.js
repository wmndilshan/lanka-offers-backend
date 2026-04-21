const PeriodEngine = require('../lib/period-engine');

const ndbCases = [
  "Until 30th April 2026",
  "Until 30th April",
  "Until 30th April  2026",
  "Offer valid period : Until 30th April 2026",
  "Offer valid period : 30th June 2026",
  "Offer valid period : 25th March - 20th April 2026",
  "Offer valid period : 21st & 22nd March 2026",
  "Offer valid period : 14th , 28th March & 11th , 25th April 2026",
  "Offer valid period : 3rd, 10th, 17th , 24th March 2026 (Tuesdays) & 14th, 21st , 28th April 2026 (Tuesdays)",
  "Offer valid period : 2nd - 5th & 19th - 22nd April 2026",
  "Offer valid period : 20th - Month end in Every month 2026",
  "Every Thursday 26th March - 30th April 2026",
  "Every Thursday till 30th April 2026",
  "Every Weekend till 30th April 2026 (Saturday & Sunday)",
  "Every Weekend from Every Weekend till 30th April 2026 (Saturday & Sunday)",
  "Booking Period - 10th February - 31st July 2026",
  "Booking Period - 15th February – 30th April 2026",
  "Booking Period : 15th February – 30th April 2026",
  "Booking & Travel Period : 01 April - 30 June 2026",
  "Stay Period : 01st April – 31st October 2026",
  "Travel Period - Until 30th September 2026",
  "The promotion period is from valid till 31st May 2026"
];

console.log("Testing NDB Bank Patterns:");
ndbCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
