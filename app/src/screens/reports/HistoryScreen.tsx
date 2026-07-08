// Date-filtered attendance history (Manila-local days).
// Quick ranges (Today / Yesterday / 7 days) + day stepping with ‹ ›.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { getHistory } from '../../services/reportsApi';
import { addDays, formatDateLabel, formatTime, manilaDateOf, todayManila } from '../../utils/date';
import type { HistoryRow } from '../../types';
import { colors, radius, spacing, type } from '../../constants/theme';
import SelfieModal from '../../components/SelfieModal';

type QuickRange = 'today' | 'yesterday' | 'week' | 'custom';

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [start, setStart] = useState(todayManila());
  const [end, setEnd] = useState(todayManila());
  const [quick, setQuick] = useState<QuickRange>('today');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalMeta, setModalMeta] = useState<{
    personName: string;
    direction: 'in' | 'out';
    serverTime: string;
  }>({ personName: '', direction: 'in', serverTime: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await getHistory(start, end));
    } catch (e: any) {
      setError(e.message ?? 'Failed to load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [start, end]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const applyQuick = (q: QuickRange) => {
    const today = todayManila();
    setQuick(q);
    if (q === 'today') {
      setStart(today);
      setEnd(today);
    } else if (q === 'yesterday') {
      setStart(addDays(today, -1));
      setEnd(addDays(today, -1));
    } else if (q === 'week') {
      setStart(addDays(today, -6));
      setEnd(today);
    }
  };

  // step a single-day range backward/forward
  const stepDay = (n: number) => {
    if (start !== end) return;
    const d = addDays(start, n);
    if (d > todayManila()) return;
    setQuick('custom');
    setStart(d);
    setEnd(d);
  };

  const rangeLabel = useMemo(
    () => (start === end ? formatDateLabel(start) : `${formatDateLabel(start)} – ${formatDateLabel(end)}`),
    [start, end]
  );

  // group rows by Manila-local day for multi-day ranges
  const listData = useMemo(() => {
    if (start === end) return rows.map((r) => ({ kind: 'row' as const, row: r }));
    const out: ({ kind: 'header'; day: string } | { kind: 'row'; row: HistoryRow })[] = [];
    let lastDay = '';
    for (const r of rows) {
      const day = manilaDateOf(r.server_time);
      if (day !== lastDay) {
        out.push({ kind: 'header', day });
        lastDay = day;
      }
      out.push({ kind: 'row', row: r });
    }
    return out;
  }, [rows, start, end]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.titleRow}>
        <Text style={type.title}>History</Text>
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => navigation.navigate('Export', { start, end })}
        >
          <Text style={styles.exportText}>Export CSV</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.chips}>
        {(
          [
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['week', 'Last 7 days'],
          ] as [QuickRange, string][]
        ).map(([q, label]) => (
          <TouchableOpacity
            key={q}
            style={[styles.chip, quick === q && styles.chipActive]}
            onPress={() => applyQuick(q)}
          >
            <Text style={[styles.chipText, quick === q && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.rangeBar}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => stepDay(-1)}
          disabled={start !== end}
        >
          <Text style={[styles.stepText, start !== end && styles.stepDisabled]}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.rangeLabel}>{rangeLabel}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => stepDay(1)}
          disabled={start !== end || end >= todayManila()}
        >
          <Text
            style={[
              styles.stepText,
              (start !== end || end >= todayManila()) && styles.stepDisabled,
            ]}
          >
            ›
          </Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => (item.kind === 'header' ? `h-${item.day}` : item.row.id)}
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
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <Text style={styles.dayHeader}>{formatDateLabel(item.day)}</Text>
            ) : (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setModalMeta({
                    personName: item.row.full_name,
                    direction: item.row.direction,
                    serverTime: item.row.server_time,
                  });
                  setSelectedId(item.row.id);
                }}
              >
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: item.row.direction === 'in' ? colors.success : colors.gray },
                  ]}
                >
                  <Text style={styles.badgeText}>{item.row.direction.toUpperCase()}</Text>
                </View>
                <View style={styles.rowMid}>
                  <Text style={styles.name}>{item.row.full_name}</Text>
                  <Text style={styles.role}>
                    {item.row.role === 'teacher' ? 'Teacher' : 'Student'}
                  </Text>
                </View>
                <Text style={styles.time}>{formatTime(item.row.server_time)}</Text>
              </TouchableOpacity>
            )
          }
          ListEmptyComponent={<Text style={styles.empty}>No records for this range.</Text>}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}

      <SelfieModal
        attendanceId={selectedId}
        visible={selectedId !== null}
        onClose={() => setSelectedId(null)}
        personName={modalMeta.personName}
        direction={modalMeta.direction}
        serverTime={modalMeta.serverTime}
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
  error: { color: colors.error, marginTop: spacing.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exportBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  exportText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.onPrimary },
  rangeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  stepBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  stepText: { fontSize: 26, color: colors.primary, fontWeight: '700' },
  stepDisabled: { color: colors.border },
  rangeLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  dayHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.gray,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  badge: {
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: spacing.md,
    minWidth: 44,
    alignItems: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  rowMid: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  role: { fontSize: 13, color: colors.gray, marginTop: 2 },
  time: { fontSize: 14, fontWeight: '600', color: colors.text },
  empty: { color: colors.gray, marginTop: spacing.xl, textAlign: 'center' },
});
