const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};

const WEEKDAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
];

function normalizeWeekday(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (t.startsWith('mon')) return 'monday';
  if (t.startsWith('tue')) return 'tuesday';
  if (t.startsWith('wed')) return 'wednesday';
  if (t.startsWith('thu')) return 'thursday';
  if (t.startsWith('fri')) return 'friday';
  if (t.startsWith('sat')) return 'saturday';
  if (t.startsWith('sun')) return 'sunday';
  return WEEKDAYS.includes(t) ? t : null;
}

function extractWeekdays(text) {
  const found = [];
  const lower = (text || '').toLowerCase();
  for (const d of WEEKDAYS) {
    if (lower.includes(d)) found.push(d);
  }
  return found;
}

function extractYear(text) {
  const m = (text || '').match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function parseHumanDate(text, fallbackYear) {
  if (!text) return null;
  const cleaned = text.replace(/(\d+)(st|nd|rd|th)/gi, '$1').trim();
  let m = cleaned.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i);
  if (m) {
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3] || fallbackYear || new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }
  m = cleaned.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,)?\s*(\d{4})?/i);
  if (m) {
    const day = String(parseInt(m[2], 10)).padStart(2, '0');
    const month = MONTHS[m[1].toLowerCase()];
    const year = m[3] || fallbackYear || new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }
  return null;
}

function extractMonthlyRange(text) {
  const m = (text || '').toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d{1,2})(?:st|nd|rd|th)?\s+of\s+each\s+month/);
  if (!m) return null;
  return { from_day: parseInt(m[1], 10), to_day: parseInt(m[2], 10) };
}

function extractSpecificDates(text, fallbackYear) {
  const matches = [];
  const re = /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*(20\d{2})?/ig;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3] || fallbackYear || new Date().getFullYear();
    matches.push(`${year}-${month}-${day}`);
  }
  return matches;
}

function buildPeriod({
  valid_from,
  valid_to,
  period_type = 'offer',
  recurrence_type = 'daily',
  recurrence_days = null,
  time_from = null,
  time_to = null,
  exclusion_days = null,
  blackout_periods = null,
  exclusion_notes = null,
  raw_period_text = ''
}) {
  return {
    valid_from,
    valid_to,
    period_type,
    recurrence_type,
    recurrence_days,
    time_from,
    time_to,
    exclusion_days,
    blackout_periods,
    exclusion_notes,
    raw_period_text
  };
}

function parse(raw, opts = {}) {
  if (!raw || !raw.trim()) return [];
  const today = opts.today || new Date().toISOString().split('T')[0];
  const fallbackYear = opts.fallbackYear || extractYear(raw) || new Date().getFullYear();
  const periodType = opts.defaultPeriodType || 'offer';
  const text = raw.trim();
  const lower = text.toLowerCase();

  // "Valid until 15th March to 20th April 2026"
  let m = lower.match(/valid\s+until\s+(.+?)\s+to\s+(.+)/i);
  if (m) {
    const fromDate = parseHumanDate(m[1], fallbackYear);
    const toDate = parseHumanDate(m[2], fallbackYear);
    if (fromDate && toDate) {
      return [buildPeriod({ valid_from: fromDate, valid_to: toDate, period_type: periodType, raw_period_text: text })];
    }
  }

  // "From X to Y"
  m = lower.match(/from\s+(.+?)\s+to\s+(.+)/i);
  if (m) {
    const fromDate = parseHumanDate(m[1], fallbackYear);
    const toDate = parseHumanDate(m[2], fallbackYear);
    if (fromDate && toDate) {
      return [buildPeriod({ valid_from: fromDate, valid_to: toDate, period_type: periodType, raw_period_text: text })];
    }
  }

  // "X - Y"
  m = lower.match(/(\d{1,2}[^\\d]{0,4}\\w+[^\\d]{0,4}(?:20\\d{2})?)\s*-\s*(\d{1,2}[^\\d]{0,4}\\w+[^\\d]{0,4}(?:20\\d{2})?)/i);
  if (m) {
    const fromDate = parseHumanDate(m[1], fallbackYear);
    const toDate = parseHumanDate(m[2], fallbackYear);
    if (fromDate && toDate) {
      return [buildPeriod({ valid_from: fromDate, valid_to: toDate, period_type: periodType, raw_period_text: text })];
    }
  }

  // "Every Tuesday till 28th February 2026"
  if (/\bevery\b/i.test(lower)) {
    const days = extractWeekdays(lower);
    if (/weekend/i.test(lower)) {
      if (!days.includes('saturday')) days.push('saturday');
      if (!days.includes('sunday')) days.push('sunday');
    }
    if (days.length > 0) {
      const untilMatch = lower.match(/(?:until|till)\s+(.+)/i);
      const untilDate = untilMatch ? parseHumanDate(untilMatch[1], fallbackYear) : null;
      return [buildPeriod({
        valid_from: today,
        valid_to: untilDate,
        period_type: periodType,
        recurrence_type: 'specific_weekdays',
        recurrence_days: days,
        raw_period_text: text
      })];
    }
  }

  // Monthly range "1st to 28th of each month"
  const monthlyRange = extractMonthlyRange(lower);
  if (monthlyRange) {
    return [buildPeriod({
      valid_from: today,
      valid_to: null,
      period_type: periodType,
      recurrence_type: 'monthly_range',
      recurrence_days: `${monthlyRange.from_day}-${monthlyRange.to_day}`,
      raw_period_text: text
    })];
  }

  // Specific dates list (if no from/to)
  const dates = extractSpecificDates(text, fallbackYear);
  if (dates.length >= 2) {
    return [buildPeriod({
      valid_from: dates[0],
      valid_to: dates[dates.length - 1],
      period_type: periodType,
      recurrence_type: 'specific_dates',
      recurrence_days: dates,
      raw_period_text: text
    })];
  }

  // "Until/Till X"
  m = lower.match(/(?:until|till)\s+(.+)/i);
  if (m) {
    const toDate = parseHumanDate(m[1], fallbackYear);
    if (toDate) {
      return [buildPeriod({ valid_from: today, valid_to: toDate, period_type: periodType, raw_period_text: text })];
    }
  }

  // Single date
  const single = parseHumanDate(text, fallbackYear);
  if (single) {
    return [buildPeriod({ valid_from: today, valid_to: single, period_type: periodType, raw_period_text: text })];
  }

  return [];
}

module.exports = {
  parse,
  parseHumanDate,
  extractYear,
  extractWeekdays,
  extractMonthlyRange,
  extractSpecificDates,
  normalizeWeekday
};
