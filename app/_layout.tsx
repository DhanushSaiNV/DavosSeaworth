import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { AuthProvider } from '../lib/auth';
import { useTheme } from '../theme';
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
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const router = useRouter();
  const [, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const initialNavDone = useRef(false);
  const { colors } = useTheme();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setLoading(false);
      loadingRef.current = false;
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
          router.replace('/(app)/chat');
        } else {
          router.replace('/sign-in');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <LoadingMark size="large" />
      </View>
    );
  }

  // Always render single Stack with all screens; auth listener handles navigation
  return (
    <RootErrorBoundary>
      <AuthProvider>
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="verify-code" options={{ headerShown: false }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        </Stack>
      </AuthProvider>
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