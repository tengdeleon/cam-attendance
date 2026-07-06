// Home screen: pick a person -> choose in/out -> open camera.
// Direction defaults from the person's last state today (in -> out), overridable.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listPeople } from '../../services/peopleApi';
import { getToday } from '../../services/attendanceApi';
import { colors, radius } from '../../constants/theme';
import type { Direction, Person, TodayRow } from '../../types';
import type { RootStackParamList } from '../../navigation/RootNavigator';

export default function CheckInScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [people, setPeople] = useState<Person[]>([]);
  const [today, setToday] = useState<TodayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Person | null>(null);
  const [direction, setDirection] = useState<Direction>('in');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, t] = await Promise.all([listPeople(), getToday()]);
      setPeople(p);
      setToday(t);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setSelected(null);
      load();
    }, [load])
  );

  const lastDirection = useCallback(
    (personId: string): Direction | null =>
      today.find((t) => t.person_id === personId)?.last_direction ?? null,
    [today]
  );

  const onSelect = (person: Person) => {
    setSelected(person);
    // default: opposite of their last event today; first event of the day -> in
    setDirection(lastDirection(person.id) === 'in' ? 'out' : 'in');
  };

  const visible = useMemo(
    () =>
      people.filter((p) =>
        p.full_name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [people, search]
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
      <Text style={styles.title}>Check-In</Text>

      <TextInput
        style={styles.search}
        placeholder="Search name…"
        value={search}
        onChangeText={setSearch}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Text style={styles.empty}>No people found.</Text>}
        renderItem={({ item }) => {
          const isSelected = selected?.id === item.id;
          const last = lastDirection(item.id);
          return (
            <TouchableOpacity
              style={[styles.row, isSelected && styles.rowSelected]}
              onPress={() => onSelect(item)}
            >
              <View>
                <Text style={styles.name}>{item.full_name}</Text>
                <Text style={styles.caption}>
                  {item.role}
                  {last ? `  ·  last: ${last}` : ''}
                </Text>
              </View>
              {last === 'in' && <View style={styles.inDot} />}
            </TouchableOpacity>
          );
        }}
      />

      {selected && (
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.sheetName}>{selected.full_name}</Text>
          <View style={styles.directions}>
            {(['in', 'out'] as Direction[]).map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dirChip, direction === d && styles.dirChipActive]}
                onPress={() => setDirection(d)}
              >
                <Text style={[styles.dirText, direction === d && styles.dirTextActive]}>
                  Check {d}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.cameraButton}
            onPress={() =>
              navigation.navigate('Camera', { person: selected, direction })
            }
          >
            <Text style={styles.cameraButtonText}>📷 Take selfie to confirm</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    marginVertical: 12,
    backgroundColor: colors.surface,
  },
  error: { color: colors.error, marginBottom: 8 },
  empty: { textAlign: 'center', color: colors.gray, marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  rowSelected: { backgroundColor: colors.surface },
  name: { fontSize: 16, color: colors.text },
  caption: { fontSize: 12, color: colors.gray, textTransform: 'capitalize' },
  inDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  sheet: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    gap: 12,
  },
  sheetName: { fontSize: 18, fontWeight: '700', color: colors.ink },
  directions: { flexDirection: 'row', gap: 8 },
  dirChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  dirChipActive: { backgroundColor: colors.blue },
  dirText: { color: colors.text, fontWeight: '600' },
  dirTextActive: { color: colors.onPrimary },
  cameraButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    padding: 16,
    alignItems: 'center',
  },
  cameraButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
});
