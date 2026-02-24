// Debug: load the actual module and test
const { PeriodParser } = require('./hnb-5.js');

const text = '01st February to 31st March 2026 (Exclude on Friday, Saturday & Long Weekends )';
console.log('Input:', text);

const days = PeriodParser.extractRecurrenceDays(text);
console.log('Recurrence days:', days);

const exclusions = PeriodParser.extractExclusions(text);
console.log('Exclusions:', exclusions);

// Parse the whole thing
const validities = PeriodParser.parse(text, '2026-02-01', '2026-03-31');
validities.forEach(v => {
  console.log('\nValidity:');
  console.log('  type:', v.recurrence_type);
  console.log('  days:', v.recurrence_days);
  console.log('  exclusion:', v.exclusion_days);
});
