import { useState, useEffect } from 'react';
import { View, Alert, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { Screen, Card, Text, Input, Button, Icon } from '../components/ui';

const PENDING_EMAIL_KEY = 'davos_pending_email';

// Reasons the OAuth callback hands back as `auth_error` (app/auth/callback.tsx).
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  failed: 'Google sign-in did not complete. Please try again.',
};

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const authError = typeof params.auth_error === 'string' ? params.auth_error : '';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const { colors, spacing } = useTheme();

  // Check for existing session on mount (fallback for dropped deep links)
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/(app)/chat');
      }
      setCheckingSession(false);
    };
    checkSession();
  }, [router]);

  // Show why the callback sent us back instead of returning here silently.
  useEffect(() => {
    if (authError) {
      setError(AUTH_ERROR_MESSAGES[authError] ?? AUTH_ERROR_MESSAGES.failed);
    }
  }, [authError]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
        },
      });

      if (signInError) {
        setError(signInError.message);
        Alert.alert('Error', signInError.message);
      } else {
        // Persist email for verify screen fallback, then navigate
        try {
          await AsyncStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        } catch {
          // Non-blocking: route param remains primary source
        }
        // Navigate to verify code screen
        router.push(`/verify-code?email=${encodeURIComponent(email.trim())}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    // Build redirect URI: web uses HTTP, native uses custom scheme
    const googleRedirectUri = Platform.OS === 'web'
      ? `${window.location.origin}/auth/callback`
      : makeRedirectUri({ scheme: 'davos', path: 'auth/callback' });

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[Auth] Google OAuth redirectUri:', googleRedirectUri);
    }

    if (Platform.OS === 'web') {
      const { error: webOauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: googleRedirectUri },
      });

      if (webOauthError) {
        setLoading(false);
        setError(webOauthError.message);
      }
      return;
    }

    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: googleRedirectUri,
        skipBrowserRedirect: true,
      },
    });

    if (oauthError || !data?.url) {
      setLoading(false);
      setError(oauthError?.message ?? 'Failed to start OAuth');
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, googleRedirectUri);

    if (result.type === 'success' && result.url) {
      const code = new URL(result.url).searchParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!exchangeError) {
          router.replace('/(app)/chat');
        } else {
          setError(exchangeError.message);
        }
      }
    }
    setLoading(false);
  };

  if (checkingSession) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Screen keyboardAvoiding maxWidth={460} contentContainerStyle={styles.centerContainer}>
      <Card elevation="raised" padding={spacing.lg} style={styles.card}>
        {/* Brand Horizon Accent */}
        <View style={[styles.lanternAccent, { backgroundColor: colors.lantern }]} />

        <View style={styles.header}>
          <Text role="display" style={styles.title}>
            Davos
          </Text>
          <Text role="body" variant="secondary" style={styles.subtitle}>
            Enter your email to receive a secure login code
          </Text>
        </View>

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.dangerSurface, borderColor: colors.danger }]}>
            <Icon name="alert-circle" size="sm" color={colors.danger} />
            <Text role="caption" variant="danger" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : null}

        <Input
          placeholder="name@example.com"
          value={email}
          onChangeText={(val) => {
            setEmail(val);
            if (error) setError(null);
          }}
          onSubmitEditing={handleSendCode}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="send"
          editable={!loading}
          accessibilityLabel="Email address"
          leftIcon={<Icon name="mail" size="sm" color={colors.textTertiary} />}
        />

        <Button
          title={loading ? 'Sending code…' : 'Send Code'}
          onPress={handleSendCode}
          loading={loading}
          disabled={loading}
          size="lg"
          fullWidth
        />

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
          <Text role="caption" variant="tertiary" style={styles.dividerText}>
            or continue with
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
        </View>

        <Button
          title="Google Account"
          variant="secondary"
          size="lg"
          fullWidth
          onPress={handleGoogleSignIn}
          disabled={loading}
          icon={<Icon name="globe" size="sm" color={colors.textPrimary} />}
        />

        <Text role="caption" variant="tertiary" align="center" style={styles.legalNote}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerContainer: {
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
  },
  lanternAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  header: {
    marginTop: 8,
    marginBottom: 24,
  },
  title: {
    marginBottom: 6,
  },
  subtitle: {
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    marginLeft: 8,
    flex: 1,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 10,
  },
  legalNote: {
    marginTop: 20,
    lineHeight: 16,
  },
});