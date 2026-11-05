import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider, useTheme } from '../theme';
import { LoadingMark, ErrorState, Button, DiagnosticsModal } from '../components/ui';
import { initClientObservability } from '../lib/observability';
import { logger } from '../lib/logger';

// Initialize client observability immediately on module evaluation
initClientObservability();

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDiagnostics: boolean;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDiagnostics: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('app', 'Uncaught component render error', {
      componentStack: errorInfo.componentStack,
    }, error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.errorBoundaryContainer}>
          <ErrorState
            title="Interface encountered an issue"
            message={this.state.error?.message ?? 'An unexpected error occurred while rendering the view.'}
            retryTitle="Reload interface"
            onRetry={() => this.setState({ hasError: false, error: null })}
          />
          {__DEV__ && (
            <>
              <View style={styles.errorDiagnosticsButton}>
                <Button
                  title="View Diagnostics & Logs"
                  variant="secondary"
                  size="md"
                  onPress={() => this.setState({ showDiagnostics: true })}
                />
              </View>
              <DiagnosticsModal
                visible={this.state.showDiagnostics}
                onClose={() => this.setState({ showDiagnostics: false })}
              />
            </>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

function RootNavigator() {
  const router = useRouter();
  const [, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const initialNavDone = useRef(false);
  const pendingNotificationUrlRef = useRef<string | null>(null);
  const { colors, isDark } = useTheme();
  const canvasBg = isDark ? colors.background : colors.surface;

  // Notification-response observer for warm start and cold start (expo-notifications SDK 57)
  // Guarded by Platform: web does not support local notification response listeners
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let isMounted = true;

    // Cold start observer: check if app was opened from a notification
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!isMounted || !response) return;
        const targetUrl = response.notification.request.content.data?.url;
        if (typeof targetUrl === 'string' && targetUrl.length > 0) {
          pendingNotificationUrlRef.current = targetUrl;
          if (!loadingRef.current) {
            router.push(targetUrl as any);
          }
        }
      })
      .catch((err) => {
        logger.warn('push', 'Failed to inspect cold-start notification response', undefined, err);
      });

    // Warm start observer: notification response received while app is alive
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const targetUrl = response.notification.request.content.data?.url;
      if (typeof targetUrl === 'string' && targetUrl.length > 0) {
        router.push(targetUrl as any);
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setLoading(false);
      loadingRef.current = false;

      // Handle pending cold-start notification landing if authenticated
      if (initialSession && pendingNotificationUrlRef.current) {
        const dest = pendingNotificationUrlRef.current;
        pendingNotificationUrlRef.current = null;
        router.replace(dest as any);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);

      // Navigate only after initial load is complete
      if (!loadingRef.current) {
        if (!initialNavDone.current) {
          initialNavDone.current = true;
        }
        if (currentSession) {
          const destination = pendingNotificationUrlRef.current ?? '/(app)/chat';
          pendingNotificationUrlRef.current = null;
          router.replace(destination as any);
        } else {
          router.replace('/sign-in');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: canvasBg }]}>
        <LoadingMark size="large" />
      </View>
    );
  }

  // Always render single Stack with all screens; auth listener handles navigation
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: canvasBg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="verify-code" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen
          name="oath"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen
          name="dev/notify"
          options={{ title: 'Dev Notify', headerShown: false }}
        />
        <Stack.Screen
          name="dev/components"
          options={{ title: 'Dev Components', headerShown: false }}
        />
      </Stack>
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorBoundaryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorDiagnosticsButton: {
    marginTop: 16,
  },
});
