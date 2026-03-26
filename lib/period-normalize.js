function toArray(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const arr = value.map(v => (v == null ? '' : String(v).trim())).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const arr = s.split(/[;,]\s*/).map(v => v.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  return [String(value)];
}

function parseRangeString(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':');
    const from = (parts[0] || '').trim();
    const to = (parts[1] || parts[0] || '').trim();
    if (!from) return null;
    return { from, to };
  }
  const toMatch = s.split(/\s+to\s+/i);
  if (toMatch.length === 2) {
    const from = toMatch[0].trim();
    const to = toMatch[1].trim() || from;
    if (!from) return null;
    return { from, to };
  }
  return { from: s, to: s };
}

function normalizeBlackoutPeriods(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const arr = value
      .map(v => {
        if (typeof v === 'string') return parseRangeString(v);
        if (v && typeof v === 'object') {
          const from = v.from || v.start || v.begin;
          const to = v.to || v.end || v.finish || v.from || v.start || v.begin;
          if (!from) return null;
          return { from, to };
        }
        return null;
      })
      .filter(Boolean);
    return arr.length ? arr : null;
  }
  if (typeof value === 'string') {
    const arr = value
      .split(/[;,]\s*/)
      .map(parseRangeString)
      .filter(Boolean);
    return arr.length ? arr : null;
  }
  return null;
}

function normalizeValidity(v) {
  return {
    ...v,
    recurrence_days: toArray(v.recurrence_days),
    exclusion_days: toArray(v.exclusion_days),
    blackout_periods: normalizeBlackoutPeriods(v.blackout_periods)
  };
}

module.exports = {
  toArray,
  parseRangeString,
  normalizeBlackoutPeriods,
  normalizeValidity
};
