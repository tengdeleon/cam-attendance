// Live who-is-in / who-is-out board for the current Manila day.
// Refreshes on focus (e.g. returning from a check-in) and on pull-down.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getToday } from '../../services/attendanceApi';
import { formatTime } from '../../utils/date';
import type { TodayRow } from '../../types';
import { colors, radius, spacing, type } from '../../constants/theme';

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<TodayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await getToday());
    } catch (e: any) {
      setError(e.message ?? 'Failed to load today board');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sections = useMemo(() => {
    const byName = (a: TodayRow, b: TodayRow) => a.full_name.localeCompare(b.full_name);
    const ins = rows.filter((r) => r.last_direction === 'in').sort(byName);
    const outs = rows.filter((r) => r.last_direction === 'out').sort(byName);
    return [
      { title: `In (${ins.length})`, key: 'in', data: ins },
      { title: `Out (${outs.length})`, key: 'out', data: outs },
    ];
  }, [rows]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={type.title}>Today</Text>
      <Text style={type.subtitle}>Who's in and out right now</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.person_id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View
              style={[
                styles.dot,
                { backgroundColor: section.key === 'in' ? colors.success : colors.gray },
              ]}
            />
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.name}>{item.full_name}</Text>
              <Text style={styles.role}>{item.role === 'teacher' ? 'Teacher' : 'Student'}</Text>
            </View>
            <Text style={styles.time}>{formatTime(item.last_time)}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No attendance recorded yet today.</Text>
        }
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: {
    color: colors.error,
    marginTop: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowLeft: { flexShrink: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  role: { fontSize: 13, color: colors.gray, marginTop: 2 },
  time: { fontSize: 14, fontWeight: '600', color: colors.text },
  empty: {
    color: colors.gray,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
