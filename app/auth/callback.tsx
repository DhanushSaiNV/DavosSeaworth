import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    let cancelled = false;

    const goTo = (href: '/(app)/chat' | '/sign-in') => {
      if (!cancelled) {
        router.replace(href);
      }
    };

    const handleCallback = async () => {
      const code = typeof params.code === 'string' ? params.code : '';

      // The PKCE verifier is single-use. On web the client is created with
      // `detectSessionInUrl` (lib/supabase.ts), so supabase-js already exchanged this code
      // while the client initialised and stripped it from the URL. Exchanging it a second
      // time here is what produced `AuthPKCECodeVerifierMissingError`. `getSession()` awaits
      // that client init, so the persisted session is the source of truth: if it exists, the
      // code has already been spent and the sign-in is done.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        goTo('/(app)/chat');
        return;
      }

      // No session yet: this is a cold start that landed here directly (native deep link),
      // where nothing has consumed the code, so exchange it explicitly.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          goTo('/(app)/chat');
          return;
        }
        console.error('Auth callback error:', error);
      }

      goTo('/sign-in');
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [params.code, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#000" />
      <Text style={styles.text}>Signing in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});