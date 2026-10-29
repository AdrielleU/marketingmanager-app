/**
 * Small structured logger (no dependencies).
 * - LOG_LEVEL: debug | info | warn | error (default info)
 * - LOG_FORMAT=json, or NODE_ENV=production: one JSON object per line (for log shippers)
 * - otherwise: readable "time LEVEL [scope] message key=value" lines
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;
const json = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

function serialize(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

function write(level: Level, scope: string, message: string, fields: Fields) {
  if (LEVELS[level] < minLevel) return;
  const time = new Date().toISOString();
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

  if (json) {
    const entry: Fields = { time, level, scope, message };
    for (const [k, v] of Object.entries(fields)) entry[k] = serialize(v);
    out.write(JSON.stringify(entry) + '\n');
    return;
  }

  const extras = Object.entries(fields)
    .map(([k, v]) => {
      const s = serialize(v);
      return `${k}=${typeof s === 'string' ? s : JSON.stringify(s)}`;
    })
    .join(' ');
  out.write(`${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extras ? ' ' + extras : ''}\n`);
}

export function createLogger(scope: string, base: Fields = {}) {
  return {
    debug: (message: string, fields: Fields = {}) => write('debug', scope, message, { ...base, ...fields }),
    info: (message: string, fields: Fields = {}) => write('info', scope, message, { ...base, ...fields }),
    warn: (message: string, fields: Fields = {}) => write('warn', scope, message, { ...base, ...fields }),
    error: (message: string, fields: Fields = {}) => write('error', scope, message, { ...base, ...fields }),
    child: (childScope: string, fields: Fields = {}) => createLogger(`${scope}:${childScope}`, { ...base, ...fields }),
  };
}

export type Logger = ReturnType<typeof createLogger>;
