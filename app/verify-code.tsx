import { useState, useEffect } from 'react';
import { View, TextInput, Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { Screen, Card, Text, Button } from '../components/ui';

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
  const { colors, spacing, radius } = useTheme();

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
    <Screen keyboardAvoiding maxWidth={460} contentContainerStyle={styles.centerContainer}>
      <Card elevation="raised" padding={spacing.lg} style={styles.card}>
        <View style={[styles.lanternAccent, { backgroundColor: colors.lantern }]} />

        <View style={styles.header}>
          <Text role="display" style={styles.title}>
            Verify Code
          </Text>
          <Text role="body" variant="secondary" style={styles.subtitle}>
            Enter the 6-digit verification code sent to{' '}
            <Text role="bodyMedium" variant="primary" style={styles.emailText}>
              {email}
            </Text>
          </Text>
        </View>

        <TextInput
          style={[
            styles.codeInput,
            {
              backgroundColor: colors.surfaceSubtle,
              borderColor: error ? colors.danger : colors.border,
              color: colors.textPrimary,
              borderRadius: radius.md,
            },
            error ? styles.codeInputError : null,
          ]}
          placeholder="000000"
          placeholderTextColor={colors.textTertiary}
          value={code}
          onChangeText={(val) => {
            setCode(val);
            if (error) setError(null);
          }}
          onSubmitEditing={handleVerify}
          keyboardType="numeric"
          maxLength={OTP_CODE_LENGTH}
          editable={!loading}
          textAlign="center"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          returnKeyType="done"
          autoFocus
          accessibilityLabel="6-digit verification code"
        />

        {error ? (
          <View style={styles.inlineError}>
            <View style={[styles.inlineErrorBadge, { backgroundColor: colors.danger }]}>
              <Text role="caption" style={[styles.inlineErrorBadgeText, { color: colors.onAccent }]}>
                !
              </Text>
            </View>
            <Text role="caption" variant="danger" style={styles.inlineErrorText}>
              {error}
            </Text>
          </View>
        ) : null}

        <Button
          title={loading ? 'Verifying…' : 'Verify Code'}
          onPress={handleVerify}
          loading={loading}
          disabled={loading}
          size="lg"
          fullWidth
          style={styles.verifyButton}
        />

        <Button
          title={loading ? 'Resending…' : 'Didn’t receive a code? Resend'}
          variant="ghost"
          size="md"
          fullWidth
          onPress={handleResend}
          disabled={loading}
          style={styles.resendButton}
        />

        <Text role="caption" variant="tertiary" align="center" style={styles.expirationNote}>
          Verification codes expire in 60 minutes.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  emailText: {
    fontWeight: '600',
  },
  codeInput: {
    height: 64,
    borderWidth: 1.5,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 10,
    paddingLeft: 10,
    textAlign: 'center',
    marginBottom: 12,
  },
  codeInputError: {
    borderWidth: 1.5,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  inlineErrorBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  inlineErrorBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  inlineErrorText: {
    flexShrink: 1,
  },
  verifyButton: {
    marginTop: 4,
  },
  resendButton: {
    marginTop: 8,
  },
  expirationNote: {
    marginTop: 18,
  },
});