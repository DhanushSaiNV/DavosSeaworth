import { useState } from 'react';
import { View, Text, TextInput, Button, Alert, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from 'react-native';
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

  // Determine the correct redirect URL based on platform
  const getRedirectUrl = () => {
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
    // In development (LAN mode), we need an HTTP URL that email clients can open
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

    // Production or fallback: use Expo's auth proxy
    // Generates: https://auth.expo.io/@dansai/davos
    // After auth, Expo redirects to davos://auth/callback
    const url = Linking.createURL('auth/callback', { scheme: 'davos' });
    console.log('[Auth] Production/Expo proxy redirect URL:', url, '| Platform:', Platform.OS);
    return url;
  };

  const handleSignIn = async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    setLoading(true);
    setError(null);

    const redirectUrl = getRedirectUrl();
    console.log('[Auth] Final magic link redirect URL being sent:', redirectUrl);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      Alert.alert('Error', signInError.message);
    } else {
      Alert.alert('Magic link sent', 'Check your email for the sign-in link.');
    }
  };

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
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
});