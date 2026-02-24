const d = JSON.parse(require('fs').readFileSync('./output/hnb_validity_rows_v5.json', 'utf8'));
const issues = [];

d.rows.forEach((r, i) => {
  const raw = r.raw_period_text || '';

  if (r.recurrence_type === 'daily' && /every\s+\w/i.test(raw)) {
    issues.push({ row: i, type: 'MISSED_RECURRENCE', detail: raw.substring(0, 80) });
  }

  if (r.valid_from && r.valid_to && r.valid_from > r.valid_to) {
    issues.push({ row: i, type: 'FROM_AFTER_TO', detail: `${r.valid_from} > ${r.valid_to}` });
  }

  if (r.valid_from && r.valid_to && r.valid_from === r.valid_to && /\bto\b/i.test(raw) && r.recurrence_type !== 'specific_dates') {
    issues.push({ row: i, type: 'RANGE_COLLAPSED', detail: `${r.valid_from} | ${raw.substring(0, 80)}` });
  }

  if (r.exclusion_days && r.recurrence_days) {
    const excl = r.exclusion_days.split(',');
    const rec = r.recurrence_days.split(',');
    const overlap = excl.filter(dd => rec.includes(dd));
    if (overlap.length > 0) {
      issues.push({ row: i, type: 'EXCLUSION_OVERLAP', detail: `rec=${r.recurrence_days} excl=${r.exclusion_days}` });
    }
  }

  if (r.valid_from === null) issues.push({ row: i, type: 'NULL_FROM' });
  if (r.valid_to === null) issues.push({ row: i, type: 'NULL_TO' });

  if (r.recurrence_type === 'specific_weekdays' && !/every|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend/i.test(raw)) {
    issues.push({ row: i, type: 'FAKE_WEEKDAY', detail: `days=${r.recurrence_days} | ${raw.substring(0, 80)}` });
  }
});

const grouped = {};
issues.forEach(iss => {
  if (!grouped[iss.type]) grouped[iss.type] = [];
  grouped[iss.type].push(iss);
});

console.log(`Total rows: ${d.totalRows}`);
console.log(`Total issues: ${issues.length}\n`);

if (issues.length === 0) {
  console.log('ALL CLEAR - No issues found!');
} else {
  Object.entries(grouped).forEach(([type, items]) => {
    console.log(`${type}: ${items.length}`);
    items.slice(0, 5).forEach(it => {
      console.log(`  row ${it.row}: ${it.detail || ''}`);
    });
    if (items.length > 5) console.log(`  ...+${items.length - 5} more`);
    console.log();
  });
}
