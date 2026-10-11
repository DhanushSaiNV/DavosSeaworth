import { useState, useEffect } from 'react';
import { View, Text, TextInput, Alert, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';

// Expo username for auth proxy redirect
const EXPO_USERNAME = 'dansai';

// Manual override for testing (set via EXPO_PUBLIC_AUTH_REDIRECT_OVERRIDE env var)
const AUTH_REDIRECT_OVERRIDE = process.env.EXPO_PUBLIC_AUTH_REDIRECT_OVERRIDE;

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Determine the correct redirect URL based on platform and auth type
  const getRedirectUrl = (useAuthProxy = false) => {
    // Allow manual override for testing
    if (AUTH_REDIRECT_OVERRIDE) {
      console.log('[Auth] Using manual override redirect:', AUTH_REDIRECT_OVERRIDE);
      return AUTH_REDIRECT_OVERRIDE;
    }

    if (Platform.OS === 'web') {
      // Web: use the current origin + callback path
      const url = `${window.location.origin}/auth/callback`;
      console.log('[Auth] Web redirect URL:', url);
      return url;
    }

    // Native (Expo Go / standalone)
    // In development (LAN mode), we need an HTTP URL that OAuth providers can redirect to
    // In production, use Expo's auth proxy
    if (__DEV__) {
      // Get LAN host from Expo manifest
      // Constants.expoConfig?.hostUri or Constants.manifest?.debuggerHost
      const hostUri = Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
      console.log('[Auth] Expo hostUri:', hostUri);
      
      if (hostUri) {
        // hostUri format: "10.82.132.253:8081" or "localhost:8081"
        const [host] = hostUri.split(':');
        const port = hostUri.split(':')[1] || '8081';
        // Use http for LAN, https for localhost
        const protocol = host === 'localhost' || host === '127.0.0.1' ? 'https' : 'http';
        const url = `${protocol}://${hostUri}/auth/callback`;
        console.log('[Auth] LAN redirect URL:', url);
        return url;
      }
    }

    // Production or fallback
    if (useAuthProxy) {
      // Use Expo's auth proxy for OAuth (Google, etc.)
      // Generates: https://auth.expo.io/@dansai/davos
      // After auth, Expo redirects to davos://auth/callback
      const url = Linking.createURL('auth/callback', { scheme: 'davos' });
      console.log('[Auth] Expo auth proxy redirect URL:', url, '| Platform:', Platform.OS);
      return url;
    } else {
      // For magic links, use custom scheme directly
      const url = `davos://auth/callback`;
      console.log('[Auth] Custom scheme redirect URL:', url);
      return url;
    }
  };

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

  const handleSignIn = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const redirectUrl = getRedirectUrl(false); // false = magic link uses custom scheme in prod
      console.log('[Auth] Final magic link redirect URL being sent:', redirectUrl);

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (signInError) {
        setError(signInError.message);
        Alert.alert('Error', signInError.message);
      } else {
        Alert.alert('Magic link sent', 'Check your email for the sign-in link.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      // Google OAuth MUST use Expo's auth proxy URL (fixed, registerable in Google Cloud Console)
      // This works for both development (Expo Go) and production
      // Magic links can use LAN URLs, but OAuth providers require pre-registered redirect URIs
      let redirectTo: string;
      if (Platform.OS === 'web') {
        redirectTo = `${window.location.origin}/auth/callback`;
      } else {
        // Native: ALWAYS use Expo's auth proxy for OAuth
        // Generates: https://auth.expo.io/@dansai/davos (fixed, registerable)
        // After auth, Expo redirects to davos://auth/callback
        redirectTo = Linking.createURL('auth/callback', { scheme: 'davos' });
      }

      console.log('[Auth] Google OAuth redirectTo:', redirectTo);

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        Alert.alert('Error', oauthError.message);
      }
      // On success, the deep link will be handled by auth/callback screen
      // Loading will be reset by finally block
    } finally {
      setLoading(false);
    }
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
        <Text style={styles.subtitle}>Enter your email to receive a magic link</Text>

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
          onPress={handleSignIn}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Sending...' : 'Send Magic Link'}
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
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  googleButtonText: {
    color: '#111',
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
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
});