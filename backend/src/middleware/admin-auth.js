const { config } = require('../utils/config');

/**
 * Require ADMIN_API_KEY via Authorization: Bearer <key> or X-Admin-Api-Key.
 * Only use when ADMIN_API_KEY is set; routes should not be mounted otherwise.
 */
function requireAdminApiKey(req, res, next) {
  const expected = config.adminApiKey;
  if (!expected) {
    return res.status(503).json({ error: 'Service Unavailable', message: 'Admin API is not configured' });
  }

  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const apiKey = req.get('x-admin-api-key') || bearer;

  if (!apiKey || apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing admin API key' });
  }

  return next();
}

module.exports = { requireAdminApiKey };
