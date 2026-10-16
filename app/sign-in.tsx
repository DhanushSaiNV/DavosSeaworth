import { useState, useEffect } from 'react';
import { View, Text, TextInput, Alert, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

    // Web: full-page redirect, not a popup. The client is created with `detectSessionInUrl`
    // on web (lib/supabase.ts), so supabase-js exchanges the PKCE code itself when the
    // callback page loads — in this same tab, where the single-use code verifier lives.
    // A popup cannot complete the flow: expo-web-browser only resolves the opener when the
    // landing page calls `maybeCompleteAuthSession()`, and the popup's own client would
    // already have spent the verifier. Nothing after this call runs — the browser leaves.
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

    // Native: keep the in-app browser and exchange the code ourselves.
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: googleRedirectUri,
        skipBrowserRedirect: true, // We'll open the browser ourselves
      },
    });

    if (oauthError || !data?.url) {
      setLoading(false);
      setError(oauthError?.message ?? 'Failed to start OAuth');
      return;
    }

    // Open the consent screen in an in-app browser that watches for the redirect
    const result = await WebBrowser.openAuthSessionAsync(data.url, googleRedirectUri);

    if (result.type === 'success' && result.url) {
      const code = new URL(result.url).searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          router.replace('/(app)/chat');
        } else {
          setError(error.message);
        }
      }
    }
    setLoading(false);
  };

  if (checkingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in to Davos</Text>
        <Text style={styles.subtitle}>Enter your email to receive a 6-digit code</Text>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!loading}
        />

        <TouchableOpacity
          style={[{ ...styles.button, opacity: loading ? 0.7 : 1 }]}
          onPress={handleSendCode}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Sending...' : 'Send Code'}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <Text style={styles.dividerText}>or</Text>
        </View>

        <TouchableOpacity
          style={[{ ...styles.button, ...styles.googleButton, opacity: loading ? 0.7 : 1 }]}
          onPress={handleGoogleSignIn}
          disabled={loading}
        >
          <Text style={[{ ...styles.buttonText, ...styles.googleButtonText }]}>
            {loading ? 'Signing in...' : 'Continue with Google'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.note}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    padding: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorContainer: {
    backgroundColor: '#fee',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#c00',
    textAlign: 'center',
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: '#fafafa',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerText: {
    color: '#999',
    fontSize: 14,
  },
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  googleButtonText: {
    color: '#111',
  },
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
});