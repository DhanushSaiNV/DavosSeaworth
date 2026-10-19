import { useEffect } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme';
import { LoadingMark } from '../../components/ui';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;

    const goToChat = () => {
      if (!cancelled) {
        router.replace('/(app)/chat');
      }
    };

    // Carry the reason back to sign-in so a failed sign-in is never a silent bounce.
    const goToSignIn = (authError?: string) => {
      if (cancelled) {
        return;
      }
      if (authError) {
        router.replace({ pathname: '/sign-in', params: { auth_error: authError } });
      } else {
        router.replace('/sign-in');
      }
    };

    const handleCallback = async () => {
      const code = typeof params.code === 'string' ? params.code : '';
      const urlError = typeof params.error === 'string'
        ? params.error
        : typeof params.error_code === 'string'
          ? params.error_code
          : '';

      // The PKCE verifier is single-use. On web the client is created with
      // `detectSessionInUrl` (lib/supabase.ts), so supabase-js exchanges this code itself
      // while the client initialises and then strips it from the URL. `getSession()` awaits
      // that client init, so the persisted session is the source of truth: if one exists, the
      // sign-in is done. Exchanging the code again here is what threw
      // `AuthPKCECodeVerifierMissingError`.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        goToChat();
        return;
      }

      // The provider reported a failure on the way back — most often the user closed the
      // consent screen (`access_denied`), which is a cancel rather than an error.
      if (urlError) {
        // eslint-disable-next-line no-console
        console.error('Auth callback error:', urlError, params.error_description);
        goToSignIn(urlError === 'access_denied' ? 'cancelled' : 'failed');
        return;
      }

      // No session yet. Only a native cold-start deep link still owns an unspent code:
      // `detectSessionInUrl` is web-only, so on web supabase-js has already had its turn and a
      // second exchange can only fail (the verifier is spent either way).
      if (Platform.OS !== 'web' && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          goToChat();
          return;
        }
        console.error('Auth callback error:', error);
        goToSignIn('failed');
        return;
      }

      goToSignIn(code ? 'failed' : undefined);
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_code, params.error_description, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LoadingMark size="large" />
      <Text style={[styles.text, { color: colors.textSecondary }]}>Signing in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
  },
});