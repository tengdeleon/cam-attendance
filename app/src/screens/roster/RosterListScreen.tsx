// Searchable list of people (teacher/student filter).
// Also serves as the M1 smoke test: proves the API accepts our token.
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listPeople } from '../../services/peopleApi';
import { useAuth } from '../../hooks/useAuth';
import type { Person, Role } from '../../types';
import { colors, radius } from '../../constants/theme';

type Filter = 'all' | Role;

export default function RosterListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople(await listPeople());
    } catch (e: any) {
      setError(e.message ?? 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, []);

  // reload whenever this screen regains focus (e.g. returning from PersonForm)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const visible = useMemo(
    () =>
      people.filter(
        (p) =>
          (filter === 'all' || p.role === filter) &&
          p.full_name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [people, search, filter]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Roster</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('PersonForm')}>
            <Text style={styles.addButtonText}>＋ Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search name…"
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.filters}>
        {(['all', 'teacher', 'student'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>No people found.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('PersonForm', { person: item })}
          >
            <Text style={styles.name}>{item.full_name}</Text>
            <Text style={[styles.role, item.role === 'teacher' && styles.roleTeacher]}>
              {item.role}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  signOut: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addButtonText: { color: colors.onPrimary, fontWeight: '700' },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    marginVertical: 12,
    backgroundColor: colors.surface,
  },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text, textTransform: 'capitalize' },
  chipTextActive: { color: colors.onPrimary },
  error: { color: colors.error, marginBottom: 8 },
  empty: { textAlign: 'center', color: colors.gray, marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { fontSize: 16, color: colors.text },
  role: { fontSize: 13, color: colors.gray, textTransform: 'capitalize' },
  roleTeacher: { color: colors.blue },
});
