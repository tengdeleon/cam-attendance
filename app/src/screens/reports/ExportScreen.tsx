// Download a date-range CSV from the backend and open the share sheet.
// Reached from HistoryScreen's "Export CSV" button (inherits its range).
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getHistoryCsv } from '../../services/reportsApi';
import { formatDateLabel } from '../../utils/date';
import { colors, radius, spacing, type } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Export'>;

export default function ExportScreen({ route }: Props) {
  const { start, end } = route.params;
  const [busy, setBusy] = useState(false);

  const rangeLabel =
    start === end ? formatDateLabel(start) : `${formatDateLabel(start)} – ${formatDateLabel(end)}`;

  const exportCsv = async () => {
    setBusy(true);
    try {
      const csv = await getHistoryCsv(start, end);
      const fileUri = `${FileSystem.cacheDirectory}attendance_${start}_${end}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: `Attendance ${rangeLabel}`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `CSV saved to app cache:\n${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'Could not export CSV');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={type.title}>Export CSV</Text>
      <Text style={[type.subtitle, styles.sub]}>
        Attendance records for {rangeLabel}, with Manila-local date and time, person, role,
        direction, and the logging teacher.
      </Text>

      <TouchableOpacity style={styles.button} onPress={exportCsv} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>Download &amp; share</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.note}>
        The file opens in the share sheet — send it to email, AirDrop, Files, or any app that
        accepts CSV.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
  },
  sub: { marginTop: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  note: { color: colors.gray, fontSize: 13, marginTop: spacing.md, textAlign: 'center' },
});
