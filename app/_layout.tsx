import { Stack } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const initialNavDone = useRef(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      loadingRef.current = false;
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      
      // Navigate only after initial load is complete
      if (!loadingRef.current) {
        if (!initialNavDone.current) {
          initialNavDone.current = true;
        }
        if (session) {
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  // Always render single Stack with all screens; auth listener handles navigation
  return (
    <AuthProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="verify-code" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});