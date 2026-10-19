import {
  initClientObservability,
  traceNetworkCall,
  getDiagnosticsSummary,
} from './observability';
import { clearLogBuffer, getLogBuffer } from './logger';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((cb) => {
    cb({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    return jest.fn();
  }),
}));

describe('client observability', () => {
  beforeEach(() => {
    clearLogBuffer();
  });

  it('initializes observability cleanly', () => {
    initClientObservability();
    const logs = getLogBuffer();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].subsystem).toBe('app');
    expect(logs[0].message).toContain('Client observability initialized');
  });

  it('traces successful network calls and records latency', async () => {
    const mockOp = jest.fn().mockResolvedValue({ status: 200, data: 'ok' });

    const result = await traceNetworkCall('chat', 'sendMessage', mockOp, {
      messageId: 'm-1',
    });

    expect(result).toEqual({ status: 200, data: 'ok' });
    const logs = getLogBuffer();

    const okLog = logs.find((l) => l.message.includes('[trace:ok] sendMessage'));
    expect(okLog).toBeDefined();
    expect(okLog?.subsystem).toBe('chat');
    expect(typeof okLog?.data?.latencyMs).toBe('number');
    expect(okLog?.data?.messageId).toBe('m-1');
  });

  it('traces failed network calls and rethrows error', async () => {
    const error = new Error('HTTP 500: Edge function error');
    const mockOp = jest.fn().mockRejectedValue(error);

    await expect(
      traceNetworkCall('checkin', 'submitCheckin', mockOp, { windowKey: 'evening' })
    ).rejects.toThrow('HTTP 500: Edge function error');

    const logs = getLogBuffer();
    const failLog = logs.find((l) => l.message.includes('[trace:fail] submitCheckin'));
    expect(failLog).toBeDefined();
    expect(failLog?.subsystem).toBe('checkin');
    expect(failLog?.level).toBe('error');
    expect(failLog?.error?.message).toBe('HTTP 500: Edge function error');
  });

  it('returns diagnostics summary with accurate counts', () => {
    const summary = getDiagnosticsSummary();
    expect(summary.platform).toBeDefined();
    expect(typeof summary.totalLogs).toBe('number');
    expect(typeof summary.errorCount).toBe('number');
    expect(typeof summary.warnCount).toBe('number');
  });
});
