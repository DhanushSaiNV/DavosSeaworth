/**
 * Centralized, structured client-side logger and in-memory diagnostics buffer.
 *
 * Designed for offline-first, mobile device debugging where attached debuggers
 * are unavailable. Stores recent telemetry in a bounded ring buffer, sanitizes
 * sensitive attributes, and provides real-time subscribers for in-app inspection.
 *
 * Adheres strictly to AGENTS.md §3 ($0 infra budget) and §4 (sensitive data boundaries).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Subsystem =
  | 'app'
  | 'auth'
  | 'chat'
  | 'checkin'
  | 'push'
  | 'journal'
  | 'net'
  | 'dev';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  subsystem: Subsystem;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

const DEFAULT_CAPACITY = 150;
let bufferCapacity = DEFAULT_CAPACITY;
let nextId = 1;
const ringBuffer: LogEntry[] = [];
type LogListener = (entry: LogEntry) => void;
const listeners = new Set<LogListener>();

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'access_token',
  'refresh_token',
  'tactical_analysis',
  'unsavable',
]);

/**
 * Recursively redacts sensitive keys to enforce security and privacy boundaries
 * (AGENTS.md §4.2, §4.3).
 */
export function sanitizeData(input: unknown): unknown {
  if (input === null || typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeData);
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      result[key] = sanitizeData(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function normalizeError(err: unknown): LogEntry['error'] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === 'string') {
    return {
      message: err,
    };
  }
  return {
    message: String(err),
  };
}

function appendEntry(
  level: LogLevel,
  subsystem: Subsystem,
  message: string,
  data?: Record<string, unknown>,
  error?: unknown
): LogEntry {
  const sanitizedData = data ? (sanitizeData(data) as Record<string, unknown>) : undefined;
  const normalizedErr = normalizeError(error);

  const entry: LogEntry = {
    id: nextId++,
    ts: new Date().toISOString(),
    level,
    subsystem,
    message,
    ...(sanitizedData ? { data: sanitizedData } : {}),
    ...(normalizedErr ? { error: normalizedErr } : {}),
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > bufferCapacity) {
    ringBuffer.shift();
  }

  // Notify active UI listeners (e.g. diagnostics modal)
  listeners.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // Ignore listener errors to protect logging pipeline
    }
  });

  // In development, also output formatted console statement
  if (__DEV__) {
    const prefix = `[${level.toUpperCase()}][${subsystem}] ${message}`;
    const args = [prefix];
    if (sanitizedData) args.push(JSON.stringify(sanitizedData));
    if (normalizedErr) args.push(normalizedErr.stack || normalizedErr.message);

    switch (level) {
      case 'error':
        // eslint-disable-next-line no-console
        console.error(...args);
        break;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(...args);
        break;
      case 'info':
        // eslint-disable-next-line no-console
        console.info(...args);
        break;
      case 'debug':
      default:
        // eslint-disable-next-line no-console
        console.log(...args);
        break;
    }
  }

  return entry;
}

export const logger = {
  debug(subsystem: Subsystem, message: string, data?: Record<string, unknown>): LogEntry {
    return appendEntry('debug', subsystem, message, data);
  },
  info(subsystem: Subsystem, message: string, data?: Record<string, unknown>): LogEntry {
    return appendEntry('info', subsystem, message, data);
  },
  warn(subsystem: Subsystem, message: string, data?: Record<string, unknown>, error?: unknown): LogEntry {
    return appendEntry('warn', subsystem, message, data, error);
  },
  error(subsystem: Subsystem, message: string, data?: Record<string, unknown>, error?: unknown): LogEntry {
    return appendEntry('error', subsystem, message, data, error);
  },
};

/**
 * Returns a read-only snapshot of current in-memory log entries.
 */
export function getLogBuffer(): readonly LogEntry[] {
  return [...ringBuffer];
}

/**
 * Clears the in-memory log buffer.
 */
export function clearLogBuffer(): void {
  ringBuffer.length = 0;
}

/**
 * Subscribes to real-time log events. Returns an unsubscribe function.
 */
export function subscribeToLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Sets the ring buffer capacity.
 */
export function setLogBufferCapacity(capacity: number): void {
  bufferCapacity = Math.max(1, capacity);
  while (ringBuffer.length > bufferCapacity) {
    ringBuffer.shift();
  }
}

/**
 * Formats the buffer contents into human-readable text for copying or export.
 */
export function exportLogsAsText(): string {
  if (ringBuffer.length === 0) {
    return 'No logs captured.';
  }
  return ringBuffer
    .map((e) => {
      let line = `[${e.ts}] [${e.level.toUpperCase()}] [${e.subsystem}] ${e.message}`;
      if (e.data && Object.keys(e.data).length > 0) {
        line += `\n  data: ${JSON.stringify(e.data)}`;
      }
      if (e.error) {
        line += `\n  error: ${e.error.message}`;
        if (e.error.stack) {
          line += `\n  stack: ${e.error.stack}`;
        }
      }
      return line;
    })
    .join('\n');
}

/**
 * Exports the buffer contents as JSON string.
 */
export function exportLogsAsJson(): string {
  return JSON.stringify(ringBuffer, null, 2);
}
