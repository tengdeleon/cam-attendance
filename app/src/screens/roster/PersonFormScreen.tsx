// Admin: add a person, edit their name/role, or deactivate them.
// Non-admins get a 403 from the backend, shown as an error message.
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createPerson, updatePerson, deactivatePerson } from '../../services/peopleApi';
import { colors, radius } from '../../constants/theme';
import type { Role } from '../../types';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'PersonForm'>;

export default function PersonFormScreen({ navigation, route }: Props) {
  const editing = route.params?.person;
  const [fullName, setFullName] = useState(editing?.full_name ?? '');
  const [role, setRole] = useState<Role>(editing?.role ?? 'student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = { full_name: fullName.trim(), role };
      if (editing) {
        await updatePerson(editing.id, body);
      } else {
        await createPerson(body);
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const onDeactivate = () => {
    if (!editing) return;
    Alert.alert(
      'Deactivate person',
      `${editing.full_name} will no longer appear in the roster. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            setBusy(true);
            try {
              await deactivatePerson(editing.id);
              navigation.goBack();
            } catch (e: any) {
              setError(e.message ?? 'Deactivate failed');
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Full name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Juan Dela Cruz"
        value={fullName}
        onChangeText={setFullName}
        autoFocus={!editing}
      />

      <Text style={styles.label}>Role</Text>
      <View style={styles.roles}>
        {(['student', 'teacher'] as Role[]).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
            onPress={() => setRole(r)}
          >
            <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, (busy || !fullName.trim()) && styles.buttonDisabled]}
        onPress={onSave}
        disabled={busy || !fullName.trim()}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>{editing ? 'Save changes' : 'Add person'}</Text>
        )}
      </TouchableOpacity>

      {editing && (
        <TouchableOpacity style={styles.deactivate} onPress={onDeactivate} disabled={busy}>
          <Text style={styles.deactivateText}>Deactivate</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.gray, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
  roles: { flexDirection: 'row', gap: 8 },
  roleChip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  roleChipActive: { backgroundColor: colors.primary },
  roleText: { color: colors.text, textTransform: 'capitalize' },
  roleTextActive: { color: colors.onPrimary, fontWeight: '600' },
  error: { color: colors.error, marginTop: 16, textAlign: 'center' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  deactivate: { alignItems: 'center', marginTop: 20 },
  deactivateText: { color: colors.error, fontSize: 14 },
});
