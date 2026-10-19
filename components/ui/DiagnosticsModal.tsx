/**
 * DiagnosticsModal — In-app system diagnostics and log inspector.
 *
 * Provides a real-time developer & beta-tester diagnostic overlay to inspect:
 * - Structured client telemetry logs in the in-memory ring buffer.
 * - Subsystem filtering (auth, chat, checkin, push, net, app).
 * - Level filtering (all, errors, warnings).
 * - Expandable metadata and stack traces.
 * - Raw selectable text export for zero-dependency copy/paste on physical devices.
 * - Live platform environment snapshot (OS, version, connectivity).
 *
 * Adheres strictly to AGENTS.md §7 (React Native primitives only).
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
} from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Button } from './Button';
import { Badge } from './Badge';
import { Chip } from './Chip';
import { Icon } from './Icon';
import {
  getLogBuffer,
  clearLogBuffer,
  subscribeToLogs,
  exportLogsAsText,
  LogEntry,
  LogLevel,
  Subsystem,
} from '../../lib/logger';
import { getDiagnosticsSummary } from '../../lib/observability';

export interface DiagnosticsModalProps {
  visible: boolean;
  onClose: () => void;
}

type FilterLevel = 'all' | 'error' | 'warn';

export function DiagnosticsModal({ visible, onClose }: DiagnosticsModalProps) {
  const { colors, radius } = useTheme();
  const [logs, setLogs] = useState<readonly LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<FilterLevel>('all');
  const [subsystemFilter, setSubsystemFilter] = useState<Subsystem | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [rawExportMode, setRawExportMode] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Sync logs and subscribe to real-time additions while modal is open
  useEffect(() => {
    if (!visible) return;
    setLogs(getLogBuffer());

    const unsubscribe = subscribeToLogs(() => {
      setLogs(getLogBuffer());
    });

    return () => unsubscribe();
  }, [visible]);

  const summary = useMemo(() => getDiagnosticsSummary(), [logs.length]);

  const filteredLogs = useMemo(() => {
    return logs
      .filter((entry) => {
        if (levelFilter === 'error' && entry.level !== 'error') return false;
        if (levelFilter === 'warn' && entry.level !== 'warn' && entry.level !== 'error') return false;
        if (subsystemFilter !== 'all' && entry.subsystem !== subsystemFilter) return false;
        return true;
      })
      .reverse(); // Show latest on top
  }, [logs, levelFilter, subsystemFilter]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClear = () => {
    clearLogBuffer();
    setLogs([]);
    setExpandedIds(new Set());
  };

  const handleCopy = () => {
    const text = exportLogsAsText();
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopyFeedback('Copied to clipboard!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } else {
      setRawExportMode(true);
      setCopyFeedback('Raw text view enabled for copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
    } catch {
      return isoString;
    }
  };

  const getLevelBadgeVariant = (level: LogLevel): 'danger' | 'warning' | 'info' | 'neutral' => {
    switch (level) {
      case 'error':
        return 'danger';
      case 'warn':
        return 'warning';
      case 'info':
        return 'info';
      case 'debug':
      default:
        return 'neutral';
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <View>
            <Text role="title">System Diagnostics</Text>
            <Text role="caption" variant="secondary" style={styles.subtitle}>
              {summary.platform.toUpperCase()} • v0.1.0 • Net:{' '}
              {summary.network.isConnected ? 'Online' : 'Offline'} ({summary.network.type})
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close diagnostics"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: colors.surfaceSubtle, borderRadius: radius.full }]}
          >
            <Icon name="x" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>

        {/* Action & Filter Controls */}
        <View style={[styles.controls, { borderBottomColor: colors.borderSubtle }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <Chip
              label={`All (${logs.length})`}
              selected={levelFilter === 'all'}
              onPress={() => setLevelFilter('all')}
            />
            <Chip
              label={`Errors (${summary.errorCount})`}
              selected={levelFilter === 'error'}
              onPress={() => setLevelFilter('error')}
            />
            <Chip
              label={`Warnings (${summary.warnCount})`}
              selected={levelFilter === 'warn'}
              onPress={() => setLevelFilter('warn')}
            />
            <Chip
              label="Chat"
              selected={subsystemFilter === 'chat'}
              onPress={() => setSubsystemFilter(subsystemFilter === 'chat' ? 'all' : 'chat')}
            />
            <Chip
              label="Checkin"
              selected={subsystemFilter === 'checkin'}
              onPress={() => setSubsystemFilter(subsystemFilter === 'checkin' ? 'all' : 'checkin')}
            />
            <Chip
              label="Net"
              selected={subsystemFilter === 'net'}
              onPress={() => setSubsystemFilter(subsystemFilter === 'net' ? 'all' : 'net')}
            />
            <Chip
              label="Auth"
              selected={subsystemFilter === 'auth'}
              onPress={() => setSubsystemFilter(subsystemFilter === 'auth' ? 'all' : 'auth')}
            />
          </ScrollView>

          <View style={styles.actionRow}>
            <Button
              title={rawExportMode ? 'List View' : 'Raw View'}
              variant="secondary"
              size="sm"
              onPress={() => setRawExportMode(!rawExportMode)}
            />
            <Button
              title={copyFeedback ?? 'Copy All'}
              variant="secondary"
              size="sm"
              onPress={handleCopy}
            />
            <Button
              title="Clear"
              variant="ghost"
              size="sm"
              onPress={handleClear}
            />
          </View>
        </View>

        {/* Content View */}
        {rawExportMode ? (
          <View style={styles.rawContainer}>
            <Text role="caption" variant="secondary" style={styles.rawHint}>
              Tap below, select all, and copy to export full session diagnostics.
            </Text>
            <TextInput
              multiline
              editable={false}
              selectTextOnFocus
              value={exportLogsAsText()}
              style={[
                styles.rawInput,
                {
                  backgroundColor: colors.surfaceSubtle,
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
              ]}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.logList}>
            {filteredLogs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text role="body" variant="secondary" align="center">
                  No logs matching the active filter.
                </Text>
              </View>
            ) : (
              filteredLogs.map((entry) => {
                const isExpanded = expandedIds.has(entry.id);
                const hasDetails = Boolean(entry.data || entry.error);

                return (
                  <Pressable
                    key={entry.id}
                    disabled={!hasDetails}
                    accessibilityRole={hasDetails ? 'button' : undefined}
                    accessibilityLabel={`Log entry: ${entry.message}`}
                    onPress={() => hasDetails && toggleExpand(entry.id)}
                    style={[
                      styles.logCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: entry.level === 'error' ? colors.danger : colors.border,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.badgeRow}>
                        <Badge
                          label={entry.level.toUpperCase()}
                          variant={getLevelBadgeVariant(entry.level)}
                          size="sm"
                        />
                        <View style={[styles.subsystemPill, { backgroundColor: colors.surfaceSubtle, borderRadius: radius.sm }]}>
                          <Text role="caption" style={styles.subsystemText}>
                            {entry.subsystem}
                          </Text>
                        </View>
                      </View>
                      <Text role="caption" variant="tertiary" tabular>
                        {formatTime(entry.ts)}
                      </Text>
                    </View>

                    <Text role="body" style={styles.logMessage}>
                      {entry.message}
                    </Text>

                    {hasDetails && (
                      <Text role="caption" variant="tertiary" style={styles.expandHint}>
                        {isExpanded ? '▲ Collapse details' : '▼ Expand details'}
                      </Text>
                    )}

                    {isExpanded && (
                      <View style={[styles.expandedContent, { backgroundColor: colors.surfaceSubtle, borderRadius: radius.sm }]}>
                        {entry.data && (
                          <Text role="mono" style={styles.monoText}>
                            {JSON.stringify(entry.data, null, 2)}
                          </Text>
                        )}
                        {entry.error && (
                          <View style={styles.errorDetails}>
                            <Text role="body" variant="danger" style={styles.errorTitle}>
                              {entry.error.name ? `${entry.error.name}: ` : ''}
                              {entry.error.message}
                            </Text>
                            {entry.error.stack && (
                              <Text role="mono" variant="tertiary" style={styles.monoText}>
                                {entry.error.stack}
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subtitle: {
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  filterScroll: {
    gap: 8,
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  logList: {
    padding: 16,
    gap: 10,
    paddingBottom: 40,
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  logCard: {
    padding: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subsystemPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subsystemText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  logMessage: {
    lineHeight: 18,
  },
  expandHint: {
    marginTop: 6,
    fontSize: 11,
  },
  expandedContent: {
    marginTop: 8,
    padding: 10,
  },
  monoText: {
    fontSize: 11,
    lineHeight: 16,
  },
  errorDetails: {
    marginTop: 4,
  },
  errorTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  rawContainer: {
    flex: 1,
    padding: 16,
  },
  rawHint: {
    marginBottom: 8,
  },
  rawInput: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    textAlignVertical: 'top',
  },
});
