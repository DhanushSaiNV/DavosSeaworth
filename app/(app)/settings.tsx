import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { requireConfigBoolean, useConfig } from '../../lib/config';
import {
  DEV_FORCE_TIERS,
  isDevOverridesActive,
  setDevOverrides,
  useDevOverrides,
} from '../../lib/devOverrides';

/**
 * Settings, plus the Step 6 developer forcer.
 *
 * The forcer pins the classifier's confidence band and/or domain so every persona tier
 * can be exercised on a device (FR-7, FR-10). It is a dev-only surface behind two
 * independent gates — a dev build and `dev_overrides_enabled` (AGENTS.md §2); the server
 * re-checks the flag itself, so this UI is convenience, never the enforcement point.
 */
export default function SettingsScreen() {
  const config = useConfig();
  const overrides = useDevOverrides();

  // Fail closed: only render the forcer when the key is present AND a real boolean true.
  const devTools = useMemo(() => {
    if (!__DEV__ || config.status !== 'loaded') return false;
    try {
      return requireConfigBoolean('dev_overrides_enabled');
    } catch (err) {
      console.warn('[settings] dev_overrides_enabled unavailable:', err);
      return false;
    }
  }, [config.status]);

  // The domain is free text and committed on blur/submit, so a keystroke does not write
  // to storage. `null` means "not edited yet" — track the stored value until then, so a
  // late load still lands in the field.
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const domainValue = domainDraft ?? overrides.domain;

  const commitDomain = () => {
    if (domainDraft === null || domainDraft.trim() === overrides.domain) return;
    void setDevOverrides({ domain: domainDraft });
    setDomainDraft(null);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      {devTools ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer</Text>
          <Text style={styles.hint}>
            Forces the classifier band and/or domain on every message you send. Ignored
            unless `dev_overrides_enabled` is true in the project config.
          </Text>

          <Text style={styles.label}>Tier forcer</Text>
          <View style={styles.tierRow}>
            {DEV_FORCE_TIERS.map((tier) => {
              const active = overrides.tier === tier;
              return (
                <Pressable
                  key={tier}
                  onPress={() => void setDevOverrides({ tier })}
                  style={[styles.tierChip, active && styles.tierChipActive]}>
                  <Text style={[styles.tierText, active && styles.tierTextActive]}>
                    {tier}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Domain forcer</Text>
          <TextInput
            style={styles.input}
            value={domainValue}
            onChangeText={setDomainDraft}
            onBlur={commitDomain}
            onSubmitEditing={commitDomain}
            placeholder="e.g. Career — blank for none"
            placeholderTextColor="#999"
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={styles.hint}>
            {isDevOverridesActive(overrides)
              ? `Active: tier=${overrides.tier}${
                  overrides.domain ? `, domain=${overrides.domain}` : ''
                }`
              : 'No override — bands are derived normally.'}
          </Text>
        </View>
      ) : null}

      <Pressable style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    paddingTop: 64,
  },
  title: {
    fontSize: 24,
    color: '#333',
    marginBottom: 24,
  },
  section: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    backgroundColor: '#fafafa',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginTop: 12,
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    color: '#666',
  },
  tierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tierChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  tierChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  tierText: {
    fontSize: 13,
    color: '#333',
  },
  tierTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#111',
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
});
