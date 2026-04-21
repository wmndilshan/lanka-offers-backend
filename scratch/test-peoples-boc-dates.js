const PeriodEngine = require('../lib/period-engine');

const peoplesCases = [
  "From April 1, 2026 to April 30, 2026",
  "From April 1, 2026 to October 31, 2026(Blackout Dates 10th to 16th April 2026)",
  "From February 15, 2026 to April 30, 2026((Blackout Dates -10th to 15th April))",
  "From March 1, 2026 to April 30, 2026((Excluding 1st to 5th April & 10th to 15th April))",
  "Till April 30, 2026",
  "Till April 30, 2026(Every Friday)",
  "Till April 30, 2026((Every Tuesday))",
  "Till April 30, 2026(Weekend Only)",
  "Till April 30, 2026((Except on blackout dates))",
  "Till April 30, 2026(Blackout Dates - 10th to 15th April 2026)",
  "Till April 30, 2026((Excluding 1st to 5th April & 10th to 15th April))",
  "Till April 30, 2026((Excluding special promotional events & festive days))",
  "Till April 30, 2026((Friday, Saturday, Sunday, & Poya Day) (Excluding special promotional events & festive days))",
  "Till April 30, 2026((3.00 PM - 6:00 PM))",
  "(26th April 2026)",
  "(16th April 2026)",
  "(6th April & 27th April 2026)",
  "(29th March & 5th April 2026)",
  "(20th to 31st March & 20th to 30th April 2026)",
  "(17th,18th, 30th,31st March & 8th to 10th, 29th,30th April 2026)"
];

const bocCases = [
  "Expiration date : 30 Apr 2026",
  "Valid till 31st August 2026",
  "From 17th February to 30th April 2026",
  "From 01st to 30th April 2026",
  "On Fridays from 06th March to 24th April 2026",
  "On Saturdays from 04th to 25th April 2026"
];

console.log("Testing People's Bank Patterns:");
peoplesCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});

console.log("\nTesting BOC Patterns:");
bocCases.forEach(tc => {
  const result = PeriodEngine.parse(tc);
  console.log(`\nInput: "${tc}"`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);
});
