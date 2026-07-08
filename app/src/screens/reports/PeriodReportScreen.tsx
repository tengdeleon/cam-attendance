// Bi-monthly attendance report (H1/H2/Full) with missed-checkout column.
// CSV export reuses the FileSystem.writeAsStringAsync → Sharing.shareAsync pattern.
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getPeriodReport, getPeriodReportCsv, type PeriodReportRow } from '../../services/reportsApi';
import { todayManila } from '../../utils/date';
import { colors, radius, spacing, type as typeStyle } from '../../constants/theme';

type Period = 'h1' | 'h2' | 'full';

const PERIOD_LABELS: Record<Period, string> = {
  h1: 'H1 (1–15)',
  h2: 'H2 (16–end)',
  full: 'Full month',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function currentManilaMonth(): { y: number; m: number } {
  const [y, m] = todayManila().split('-').map(Number); // todayManila() = 'yyyy-mm-dd'
  return { y, m }; // m is 1-based
}

// Current month + past 6 months, newest first.
function recentMonths(count = 7): { value: string; label: string }[] {
  const { y, m } = currentManilaMonth();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    // 0-based month index counting back i months from (m - 1), wrapped via floor division.
    const idx = (m - 1) - i;
    const year = y + Math.floor(idx / 12);
    const monthIdx = ((idx % 12) + 12) % 12;
    out.push({
      value: `${year}-${String(monthIdx + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[monthIdx]} ${year}`,
    });
  }
  return out;
}

export default function PeriodReportScreen() {
  const months = useMemo(() => recentMonths(7), []);
  const [month, setMonth] = useState(months[0].value);
  const [period, setPeriod] = useState<Period>('h1');
  const [rows, setRows] = useState<PeriodReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setRows(null);
    try {
      const data = await getPeriodReport(month, period);
      setRows(data);
    } catch (e: any) {
      Alert.alert('Load failed', e.message ?? 'Could not load report');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await getPeriodReportCsv(month, period);
      const filename = `period_report_${month}_${period}.csv`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, csv);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: `Period report ${month} ${PERIOD_LABELS[period]}`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `CSV saved to:\n${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'Could not export CSV');
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={typeStyle.title}>Period Report</Text>

      {/* Controls */}
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
          <View style={styles.monthRow}>
            {months.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[styles.monthChip, month === m.value && styles.monthChipActive]}
                onPress={() => setMonth(m.value)}
              >
                <Text style={[styles.monthText, month === m.value && styles.monthTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <View style={styles.periodRow}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodChip, period === p && styles.periodChipActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {PERIOD_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.loadBtn} onPress={load} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.loadText}>Load</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportBtn} onPress={exportCsv} disabled={exporting}>
            {exporting ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.exportText}>Export CSV</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Table header */}
      {rows !== null && (
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2 }]}>Teacher</Text>
          <Text style={styles.th}>Days</Text>
          <Text style={styles.th}>Late</Text>
          <Text style={styles.th}>Min</Text>
          <Text style={styles.th}>Missed</Text>
        </View>
      )}

      {/* Rows */}
      {rows !== null && (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.person_id}
          ListEmptyComponent={<Text style={styles.empty}>No data for this period.</Text>}
          renderItem={({ item }) => {
            const expanded = expandedId === item.person_id;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setExpandedId(expanded ? null : item.person_id)}
                activeOpacity={0.7}
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.td, { flex: 2 }]} numberOfLines={1}>{item.full_name}</Text>
                  <Text style={styles.td}>{item.days_present}</Text>
                  <Text style={styles.td}>{item.late_days}</Text>
                  <Text style={styles.td}>{item.total_late_minutes}</Text>
                  <Text style={[styles.td, item.missed_checkouts > 0 && styles.missed]}>
                    {item.missed_checkouts}
                  </Text>
                </View>
                {expanded && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailScroll}>
                    <View>
                      <View style={styles.detailHeader}>
                        {['Date', 'First in', 'Late min', 'Missed'].map((h) => (
                          <Text key={h} style={styles.detailTh}>{h}</Text>
                        ))}
                      </View>
                      {item.daily_detail.map((d) => (
                        <View key={d.date} style={styles.detailRow}>
                          <Text style={styles.detailTd}>{d.date}</Text>
                          <Text style={styles.detailTd}>{d.first_in}</Text>
                          <Text style={styles.detailTd}>{d.late_minutes}</Text>
                          <Text style={[styles.detailTd, d.missed_checkout && styles.missed]}>
                            {d.missed_checkout ? 'Yes' : '—'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  controls: { gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.md },
  monthScroll: { flexGrow: 0 },
  monthRow: { flexDirection: 'row', gap: spacing.sm },
  monthChip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  monthText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  monthTextActive: { color: colors.onPrimary },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  periodTextActive: { color: colors.onPrimary },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  loadBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  exportBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  exportText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  th: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.gray, textTransform: 'uppercase' },
  row: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  rowMain: { flexDirection: 'row' },
  td: { flex: 1, fontSize: 13, color: colors.text },
  missed: { color: colors.error, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.gray, marginTop: 32 },
  detailScroll: { marginTop: spacing.sm },
  detailHeader: { flexDirection: 'row', gap: 12, paddingBottom: 2 },
  detailTh: { width: 80, fontSize: 11, fontWeight: '700', color: colors.gray },
  detailRow: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  detailTd: { width: 80, fontSize: 12, color: colors.text },
});
