import { useState, useEffect } from 'react';
import { View, Text, TextInput, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OTP_CODE_LENGTH = 6;
const PENDING_EMAIL_KEY = 'davos_pending_email';

export default function VerifyCodeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const routeEmail = (params.email as string) || '';
  const [storedEmail, setStoredEmail] = useState<string>('');
  const email = routeEmail || storedEmail;

  useEffect(() => {
    if (routeEmail) return;
    AsyncStorage.getItem(PENDING_EMAIL_KEY).then((value: string | null) => {
      if (value) setStoredEmail(value);
    }).catch(() => {
      // Non-blocking: user can navigate back and re-enter email
    });
  }, [routeEmail]);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!code.trim() || code.length !== OTP_CODE_LENGTH) {
      setError('Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'email',
      });

      if (verifyError) {
        setError(verifyError.message);
        Alert.alert('Error', verifyError.message);
      } else if (data.session) {
        try {
          await AsyncStorage.removeItem(PENDING_EMAIL_KEY);
        } catch {
          // Non-blocking
        }
        router.replace('/(app)/chat');
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    setCode('');

    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (resendError) {
        setError(resendError.message);
        Alert.alert('Error', resendError.message);
      } else {
        Alert.alert('Code sent', 'A new 6-digit code has been sent to your email.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to <Text style={styles.emailText}>{email}</Text>
        </Text>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.codeInput}
          placeholder="000000"
          placeholderTextColor="#999"
          value={code}
          onChangeText={setCode}
          onSubmitEditing={handleVerify}
          keyboardType="numeric"
          maxLength={OTP_CODE_LENGTH}
          editable={!loading}
          textAlign="center"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          returnKeyType="done"
          autoFocus
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Verifying...' : 'Verify Code'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resendButton}
          onPress={handleResend}
          disabled={loading}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          hitSlop={8}
        >
          <Text style={styles.resendText}>
            {loading ? 'Resending...' : 'Didn\u2019t receive it? Resend code'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.note}>
          The code expires in 60 minutes.
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
  emailText: {
    fontWeight: '600',
    color: '#111',
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
  codeInput: {
    height: 60,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 12,
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: 12,
    // Letter-spacing trails the last digit, pulling centered glyphs left; matching
    // left padding re-centers them.
    paddingLeft: 12,
    textAlign: 'center',
    backgroundColor: '#fafafa',
    marginBottom: 24,
    color: '#111',
  },
  button: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resendButton: {
    marginTop: 16,
    // Keep the tap target at a comfortable height rather than the text line alone.
    paddingVertical: 10,
  },
  resendText: {
    color: '#000',
    fontSize: 16,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
});