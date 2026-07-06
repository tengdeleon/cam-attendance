// Searchable list of people (teacher/student filter).
// Also serves as the M1 smoke test: proves the API accepts our token.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { listPeople } from '../../services/peopleApi';
import { useAuth } from '../../hooks/useAuth';
import type { Person, Role } from '../../types';

type Filter = 'all' | Role;

export default function RosterListScreen() {
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

  useEffect(() => {
    load();
  }, [load]);

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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Roster</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
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
          <View style={styles.row}>
            <Text style={styles.name}>{item.full_name}</Text>
            <Text style={[styles.role, item.role === 'teacher' && styles.roleTeacher]}>
              {item.role}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  signOut: { color: '#dc2626', fontSize: 14 },
  search: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    marginVertical: 12,
  },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
  },
  chipActive: { backgroundColor: '#1d4ed8' },
  chipText: { color: '#334155', textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  error: { color: '#dc2626', marginBottom: 8 },
  empty: { textAlign: 'center', color: '#64748b', marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  name: { fontSize: 16 },
  role: { fontSize: 13, color: '#64748b', textTransform: 'capitalize' },
  roleTeacher: { color: '#1d4ed8' },
});
