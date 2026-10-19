import {
  logger,
  getLogBuffer,
  clearLogBuffer,
  subscribeToLogs,
  setLogBufferCapacity,
  exportLogsAsText,
  exportLogsAsJson,
  sanitizeData,
} from './logger';

describe('client structured logger', () => {
  beforeEach(() => {
    clearLogBuffer();
    setLogBufferCapacity(150);
  });

  it('records logs with appropriate severity, timestamp, and subsystem', () => {
    const entry = logger.info('auth', 'User authenticated successfully', { userId: 'u-123' });

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.level).toBe('info');
    expect(entry.subsystem).toBe('auth');
    expect(entry.message).toBe('User authenticated successfully');
    expect(entry.data).toEqual({ userId: 'u-123' });
    expect(entry.ts).toBeDefined();

    const buffer = getLogBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0]).toEqual(entry);
  });

  it('handles error objects and normalizes them', () => {
    const error = new Error('Network timeout');
    const entry = logger.error('net', 'Fetch failed', { url: '/api/checkin' }, error);

    expect(entry.level).toBe('error');
    expect(entry.subsystem).toBe('net');
    expect(entry.error).toBeDefined();
    expect(entry.error?.message).toBe('Network timeout');
    expect(entry.error?.stack).toBeDefined();
  });

  it('sanitizes sensitive keys to protect security boundaries', () => {
    const sensitive = {
      email: 'user@example.com',
      token: 'secret-token-123',
      password: 'mypassword',
      tactical_analysis: 'model reasoning',
      nested: {
        api_key: 'key-xyz',
        safe: 42,
      },
    };

    const sanitized = sanitizeData(sensitive) as Record<string, unknown>;
    expect(sanitized.email).toBe('user@example.com');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.tactical_analysis).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).safe).toBe(42);
  });

  it('enforces ring buffer capacity by dropping oldest entries', () => {
    setLogBufferCapacity(3);

    logger.info('app', 'First');
    logger.info('app', 'Second');
    logger.info('app', 'Third');
    logger.info('app', 'Fourth');

    const buffer = getLogBuffer();
    expect(buffer).toHaveLength(3);
    expect(buffer[0].message).toBe('Second');
    expect(buffer[1].message).toBe('Third');
    expect(buffer[2].message).toBe('Fourth');
  });

  it('notifies subscribers on each log event', () => {
    const events: string[] = [];
    const unsubscribe = subscribeToLogs((entry) => {
      events.push(`${entry.level}:${entry.message}`);
    });

    logger.warn('push', 'Permission denied');
    logger.debug('chat', 'Message rendered');

    expect(events).toEqual(['warn:Permission denied', 'debug:Message rendered']);

    unsubscribe();
    logger.info('app', 'After unsubscribe');
    expect(events).toHaveLength(2);
  });

  it('exports logs cleanly as text and JSON', () => {
    logger.info('dev', 'Test export', { foo: 'bar' });

    const text = exportLogsAsText();
    expect(text).toContain('[INFO] [dev] Test export');
    expect(text).toContain('data: {"foo":"bar"}');

    const json = exportLogsAsJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].message).toBe('Test export');
  });
});
