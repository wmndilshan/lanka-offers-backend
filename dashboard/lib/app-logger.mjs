import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createLogger } = require('../../lib/logger');

export function getAppLogger(scope = 'dashboard') {
    return createLogger(scope);
}
