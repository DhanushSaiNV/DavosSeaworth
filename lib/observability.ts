/**
 * Client-Side Observability & Diagnostics Manager.
 *
 * Provides:
 * 1. Global uncaught error and unhandled promise rejection tracking.
 * 2. Network connectivity state transition tracking.
 * 3. Network request tracing with latency and status measurement.
 * 4. Diagnostics telemetry summary for device debugging.
 *
 * Adheres strictly to AGENTS.md §3 ($0 budget, Supabase-only compute).
 */

import { Platform } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { logger, getLogBuffer, Subsystem } from './logger';

let initialized = false;
let lastNetState: NetInfoState | null = null;

// React Native global ErrorUtils definition
interface ExtendedErrorUtils {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

declare const ErrorUtils: ExtendedErrorUtils | undefined;

/**
 * Initializes global client observability listeners. Safe to call multiple times.
 */
export function initClientObservability(): void {
  if (initialized) return;
  initialized = true;

  logger.info('app', `Client observability initialized on ${Platform.OS}`, {
    platform: Platform.OS,
    version: Platform.Version,
  });

  // 1. Uncaught Exception Handler
  try {
    if (typeof ErrorUtils !== 'undefined' && ErrorUtils.setGlobalHandler) {
      const defaultHandler = ErrorUtils.getGlobalHandler ? ErrorUtils.getGlobalHandler() : undefined;
      ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        logger.error('app', `Uncaught exception (fatal=${Boolean(isFatal)})`, { isFatal }, error);
        if (defaultHandler) {
          defaultHandler(error, isFatal);
        }
      });
    }
  } catch (err) {
    logger.warn('app', 'Failed to attach ErrorUtils handler', undefined, err);
  }

  // Web unhandled rejection & error listeners
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      logger.error('app', `Uncaught window error: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }, event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      logger.error('app', 'Unhandled promise rejection', undefined, event.reason);
    });
  }

  // 2. Network Connectivity Monitoring
  try {
    NetInfo.addEventListener((state) => {
      if (!state) return;
      const changed =
        !lastNetState ||
        lastNetState.isConnected !== state.isConnected ||
        lastNetState.type !== state.type;

      if (changed) {
        lastNetState = state;
        const status = state.isConnected ? 'Connected' : 'Disconnected';
        logger.info('net', `Network state changed: ${status} (${state.type})`, {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
        });
      }
    });
  } catch (err) {
    logger.warn('net', 'Failed to attach NetInfo listener', undefined, err);
  }
}

/**
 * Executes a network call with structured tracing, recording duration, status, and failure cause.
 */
export async function traceNetworkCall<T>(
  subsystem: Subsystem,
  operationName: string,
  operation: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  logger.debug(subsystem, `[trace:start] ${operationName}`, metadata);

  try {
    const result = await operation();
    const latencyMs = Date.now() - start;
    logger.info(subsystem, `[trace:ok] ${operationName} (${latencyMs}ms)`, {
      ...metadata,
      latencyMs,
    });
    return result;
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error(subsystem, `[trace:fail] ${operationName} (${latencyMs}ms)`, {
      ...metadata,
      latencyMs,
    }, err);
    throw err;
  }
}

export interface DiagnosticsSummary {
  platform: string;
  osVersion: string | number;
  totalLogs: number;
  errorCount: number;
  warnCount: number;
  network: {
    isConnected: boolean | null;
    type: string;
  };
}

/**
 * Assembles an instant diagnostics snapshot for client-side debugging.
 */
export function getDiagnosticsSummary(): DiagnosticsSummary {
  const logs = getLogBuffer();
  let errorCount = 0;
  let warnCount = 0;

  for (const log of logs) {
    if (log.level === 'error') errorCount++;
    else if (log.level === 'warn') warnCount++;
  }

  return {
    platform: Platform.OS,
    osVersion: Platform.Version,
    totalLogs: logs.length,
    errorCount,
    warnCount,
    network: {
      isConnected: lastNetState?.isConnected ?? null,
      type: lastNetState?.type ?? 'unknown',
    },
  };
}
