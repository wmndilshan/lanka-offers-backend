/**
 * Minimal IP-based rate limiter (no extra dependencies).
 * @param {{ windowMs?: number, max?: number }} opts
 */
function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 300;
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits.entries()) {
      const kept = times.filter((t) => now - t < windowMs);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, windowMs).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const times = hits.get(key) || [];
    const recent = times.filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded' });
    }
    recent.push(now);
    hits.set(key, recent);
    return next();
  };
}

module.exports = { createRateLimiter };
