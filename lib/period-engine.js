const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, decmber: 11
};

const MONTH_NAMES = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|decmber';

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
  const cleaned = text.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').replace(/\bof\b/gi, '').replace(/\s+/g, ' ').trim();
  
  // Handle "Month end"
  if (cleaned.toLowerCase().includes('month end')) {
    const parts = cleaned.toLowerCase().split('month end');
    // Try to parse what's left to get month and year
    const m = cleaned.match(new RegExp(`(${MONTH_NAMES})\\s*(20\\d{2})?`, 'i'));
    if (m || cleaned.toLowerCase().includes('every month')) {
      const month = m ? MONTHS[m[1].toLowerCase()] : new Date().getMonth();
      const year = m && m[2] ? parseInt(m[2]) : (fallbackYear || new Date().getFullYear());
      const lastDay = new Date(year, month + 1, 0).getDate();
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }
  }
  
  // ISO Date: 2026-04-20 or DD.MM.YYYY: 20.04.2026
  let m = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  m = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  // Month YYYY (no day) -> last day of month
  m = cleaned.match(new RegExp(`^(${MONTH_NAMES})\\s+(20\\d{2})$`, 'i'));
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const year = parseInt(m[2]);
    const lastDay = new Date(year, month + 1, 0).getDate();
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  // DD Month YYYY
  m = cleaned.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAMES})\\s*(\\d{4})?$`, 'i'));
  if (m) {
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const month = String(MONTHS[m[2].toLowerCase()] + 1).padStart(2, '0');
    const year = m[3] ? m[3] : fallbackYear;
    return `${year}-${month}-${day}`;
  }

  // Month DD YYYY
  m = cleaned.match(new RegExp(`^(${MONTH_NAMES})\\s+(\\d{1,2})(?:,)?\\s*(\\d{4})?$`, 'i'));
  if (m) {
    const month = String(MONTHS[m[1].toLowerCase()] + 1).padStart(2, '0');
    const day = String(parseInt(m[2], 10)).padStart(2, '0');
    const year = m[3] ? m[3] : fallbackYear;
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
  const re = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\s*(20\\d{2})?`, 'ig');
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const month = String(MONTHS[m[2].toLowerCase()] + 1).padStart(2, '0');
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

function splitBySeparator(text) {
  // Split by & or "and" but only if not inside parentheses
  // AND not part of a day list (e.g., "Monday & Friday")
  const parts = [];
  let current = '';
  let parenCount = 0;
  const words = text.split(/\s+/);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = words[i+1] || '';
    const openParens = (word.match(/\(/g) || []).length;
    const closeParens = (word.match(/\)/g) || []).length;
    
    const isDay = /monday|tuesday|wednesday|thursday|friday|saturday|sunday|poya/i.test(word);
    const isNextDay = /monday|tuesday|wednesday|thursday|friday|saturday|sunday|poya/i.test(nextWord);

    if (parenCount === 0 && (word.toLowerCase() === '&' || word.toLowerCase() === 'and') && !isDay && !isNextDay) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += (current ? ' ' : '') + word;
      parenCount += openParens;
      parenCount -= closeParens;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Main parse entry point
 */
function parse(raw, options = {}) {
  const { defaultPeriodType = 'offer', fallbackYear = extractYear(raw) || new Date().getFullYear(), today = new Date().toISOString().split('T')[0] } = options;
  const periodType = defaultPeriodType;

  if (!raw || raw.trim().length === 0) return [];

  let text = raw.trim();

  // Unwrap outer parentheses if they cover the whole string: "((...))" or "(...)"
  while (text.startsWith('(') && text.endsWith(')')) {
    const inner = text.substring(1, text.length - 1).trim();
    // Only unwrap if parentheses are balanced within
    let count = 0;
    let balanced = true;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') count++;
      else if (inner[i] === ')') {
        count--;
        if (count < 0) { balanced = false; break; }
      }
    }
    if (balanced && count === 0) {
      text = inner;
    } else {
      break;
    }
  }

  // Split by multiple ranges
  const parts = splitBySeparator(text);
  if (parts.length > 1) {
    let all = [];
    parts.forEach(p => {
      all = all.concat(parse(p, { ...options, fallbackYear }));
    });
    return all;
  }

  // Pre-process: strip common keywords and notes
  text = text.replace(/\(until\s+stock\s+lasts\)/gi, '').trim();
  
  // Strip prefixes
  let cleaned = text.replace(/^valid\s*/i, '')
    .replace(/^(?:from|until|until\s+stock\s+lasts|till|expiration\s+date\s*:|on|before|only\s+on|promotional\s+period\s*[-:]|offer\s+valid\s+period\s*[-:]|booking\s*(?:&\s*)?(?:travel|stay|validity)?\s+period\s*[-:]|travel\s+period\s*[-:]|stay\s+period\s*[-:]|travelling\s+period\s*[-:]|special\s+offer\s+valid\s+from\s+|avurudu\s+offer\s+valid\s+on\s+|ramazan\s+offer\s+valid\s+on\s+|discount\s*s?\s+valid\s+(?:from|until)?\s*[;:]?|epp\s*(?:is)?\s*valid\s+(?:until|till)?\s*[;:]?|epp\s+(?:until|period|period\s*–\s*until)\s*|installment\s+plans\s+valid\s+until\s+|cyber\s+monday\s*-\s*|event\s+period\s*-\s*|april\s+offer\s*:\s*|march\s+offer\s*:\s*|validity\s*s?\s*[:–]?|period\s+)\s*/i, '')
    .replace(/^offer\s+is\s+valid\s+every\s+/i, '')
    .replace(/^the\s+promotion\s+period\s+is\s+from\s+valid\s+till\s+/i, '')
    .replace(/^the\s+promotion\s+period\s*,\s*/i, '')
    .replace(/^[•\s*]+\s*/, '')
    .trim();

  // Handle NDB duplication error: "Every Weekend from Every Weekend till..."
  cleaned = cleaned.replace(/^every\s+weekend\s+from\s+every\s+weekend\s+till/i, 'till').trim();

  // Extract parenthetical conditions (if any) at the END
  let condition = '';
  const condMatch = cleaned.match(/\s*\(\(?(.*?)\)?\)\s*$/);
  if (condMatch) {
    condition = condMatch[1].trim();
    cleaned = cleaned.replace(/\s*\(\(?(.*?)\)?\)\s*$/, '').trim();
  }

  // Detect recurrence from the current 'text' (which still has "On Fridays")
  const combinedText = (text + ' ' + condition).toLowerCase();
  
  // If after stripping condition we still have "On [Weekday]s" at start, strip it from cleaned
  cleaned = cleaned.replace(/^(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+(?:from\s+)?/i, '').trim();

  const lower = cleaned.toLowerCase();
  const condLower = condition.toLowerCase();

  // Parse recurrence, blackouts, and notes
  let recurrenceType = 'daily';
  let recurrenceDays = null;
  let blackoutPeriods = null;
  let exclusionNotes = [];
  let timeFrom = null;
  let timeTo = null;

  // Detect recurrence
  if (/weekend/i.test(combinedText)) {
    recurrenceType = 'specific_weekdays';
    recurrenceDays = ['saturday', 'sunday'];
  } else {
    const days = [];
    WEEKDAYS.forEach(d => {
      if (new RegExp(`every\\s+${d}|on\\s+${d}s?|${d}`, 'i').test(combinedText)) {
        days.push(d);
      }
    });
    if (days.length > 0) {
      recurrenceType = 'specific_weekdays';
      recurrenceDays = days;
    }
  }

  // Detect time range: 3.00 PM - 6:00 PM or 6:00 - 7:00 PM
  const timeMatch = combinedText.match(/(\d{1,2}(?:[:.]\d{2})?(?:\s*(?:am|pm))?)\s*-\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))/i);
  if (timeMatch) {
    timeFrom = timeMatch[1].toUpperCase();
    timeTo = timeMatch[2].toUpperCase();
    // If first time doesn't have AM/PM, inherit from second
    if (!/AM|PM/.test(timeFrom)) {
      const suffix = timeTo.match(/AM|PM/);
      if (suffix) timeFrom += ' ' + suffix[0];
    }
  }

  // Detect blackouts/exclusions
  // Check condition first as it's more likely to have specific terms
  let blackoutMatch = condition.toLowerCase().match(/(?:blackout|excluding|except)\s+(?:dates?|on)?\s*(.+)/i);
  if (!blackoutMatch) {
    blackoutMatch = cleaned.toLowerCase().match(/(?:blackout|excluding|except)\s+(?:dates?|on)?\s*(.+)/i);
  }
  if (blackoutMatch) {
    exclusionNotes.push(blackoutMatch[0].trim());
  }

  // Handle specific dates list: "17th, 18th, 30th, 31st March 2026"
  if (lower.match(/\d{1,2}(?:st|nd|rd|th)?\s*,\s*\d{1,2}/)) {
    const dates = extractSpecificDates(lower, fallbackYear);
    if (dates.length > 0) {
      return [buildPeriod({
        valid_from: dates[0],
        valid_to: dates[dates.length - 1],
        period_type: periodType,
        recurrence_type: 'specific_dates',
        recurrence_days: dates,
        raw_period_text: raw
      })];
    }
  }

  // "1st to 20th April 2026" or "1st to 2026-04-20"
  let m = lower.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|until|till)\s+(.+)$/i);
  if (m) {
    const toDate = parseHumanDate(m[2], fallbackYear);
    if (toDate) {
      const day = String(parseInt(m[1], 10)).padStart(2, '0');
      const [year, month] = toDate.split('-');
      const fromDate = `${year}-${month}-${day}`;
      return [buildPeriod({ 
        valid_from: fromDate, 
        valid_to: toDate, 
        period_type: periodType, 
        raw_period_text: raw,
        recurrence_type: recurrenceType,
        recurrence_days: recurrenceDays,
        time_from: timeFrom,
        time_to: timeTo,
        exclusion_notes: exclusionNotes.length > 0 ? exclusionNotes.join('; ') : null
      })];
    }
  }

  // "From X to Y" (handle "ti" typo and dash separators)
  // Try "X - Y" with various dash types and optional spaces
  m = lower.match(/^from\s+(.+?)\s+(?:to|ti)\s+(.+)/i);
  if (!m) m = lower.match(/^from\s+(.+?)\s*([-–])\s*(.+)/i);
  if (!m) m = lower.match(/^(.+?)\s+(?:to|ti)\s+(.+)/i);
  if (!m) {
    // Look for a dash that separates two date-like parts
    const dashMatch = lower.match(/(.+?)\s*([-–])\s*(.+)/);
    if (dashMatch) {
      // Validate that it's likely a date range split
      const p1 = dashMatch[1].trim();
      const p2 = dashMatch[3].trim();
      if ((parseHumanDate(p1, fallbackYear) || p1.match(/^\d{1,2}(st|nd|rd|th)?$/i)) && parseHumanDate(p2, fallbackYear)) {
        m = dashMatch;
      }
    }
  }
  if (!m) m = lower.match(/^(\d{1,2}(?:st|nd|rd|th)?)-(\d{1,2}(?:st|nd|rd|th)?\s+[\w\s]+)$/i); // 1-30th April 2026
  if (m) {
    const fromPart = m[1].trim();
    const toPart = m[m.length - 1].trim(); // Use last group for toPart to handle m = dashMatch correctly
    let fromDate = parseHumanDate(fromPart, fallbackYear);
    let toDate = parseHumanDate(toPart, fallbackYear);

    // Handle "21st & 22nd March 2026" or "25th March - 20th April 2026"
    // Handle "From 01st to 30th April 2026" or "1st to 2026-04-30"
    if (!fromDate && toDate) {
      const dayMatch = fromPart.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
      if (dayMatch) {
        const day = String(parseInt(dayMatch[1], 10)).padStart(2, '0');
        const [year, month] = toDate.split('-');
        fromDate = `${year}-${month}-${day}`;
      }
    }
    
    // Reverse inherit for "25th March - 20th April 2026"
    if (fromDate && !toDate) {
       // already handled by parseHumanDate if it has month
    }

    if (fromDate || toDate) {
      return [buildPeriod({ 
        valid_from: fromDate || today, 
        valid_to: toDate, 
        period_type: periodType, 
        raw_period_text: raw,
        recurrence_type: recurrenceType,
        recurrence_days: recurrenceDays,
        time_from: timeFrom,
        time_to: timeTo,
        exclusion_notes: exclusionNotes.length > 0 ? exclusionNotes.join('; ') : null
      })];
    }
  }

  // "Till X", "Until X", "Before X"
  m = lower.match(/^(?:till|until|before)\s+(.+)/i);
  if (!m) m = [null, lower]; // fallback to whole string if no prefix
  if (m) {
    const toDate = parseHumanDate(m[1], fallbackYear);
    if (toDate) {
      return [buildPeriod({ 
        valid_from: today, 
        valid_to: toDate, 
        period_type: periodType, 
        raw_period_text: raw,
        recurrence_type: recurrenceType,
        recurrence_days: recurrenceDays,
        time_from: timeFrom,
        time_to: timeTo,
        exclusion_notes: exclusionNotes.length > 0 ? exclusionNotes.join('; ') : null
      })];
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
        raw_period_text: raw
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
      raw_period_text: raw
    })];
  }

  // Specific dates list (if no from/to)
  const dates = extractSpecificDates(cleaned, fallbackYear);
  if (dates.length >= 2) {
    return [buildPeriod({
      valid_from: dates[0],
      valid_to: dates[dates.length - 1],
      period_type: periodType,
      recurrence_type: 'specific_dates',
      recurrence_days: dates,
      raw_period_text: raw
    })];
  }

  // "Until/Till X"
  m = lower.match(/^(?:until|till)\s+(.+)/i);
  if (m) {
    const toDate = parseHumanDate(m[1], fallbackYear);
    if (toDate) {
      return [buildPeriod({ valid_from: today, valid_to: toDate, period_type: periodType, raw_period_text: raw })];
    }
  }

  // Single date
  const single = parseHumanDate(cleaned, fallbackYear);
  if (single) {
    return [buildPeriod({ valid_from: today, valid_to: single, period_type: periodType, raw_period_text: raw })];
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
