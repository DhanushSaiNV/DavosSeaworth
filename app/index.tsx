import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme';
import { LoadingMark } from '../components/ui';

export default function Index() {
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      router.replace(session ? '/(app)/chat' : '/sign-in');
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LoadingMark size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
