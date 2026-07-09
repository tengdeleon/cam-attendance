// Items the sync queue could not replay (server returned 4xx).
// Teacher reviews, then dismisses. Dismissing deletes the local selfie file (§9).
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissAllFailed, dismissFailed, listFailed, type FailedItem } from '../../services/syncQueue';
import { colors, radius, spacing } from '../../constants/theme';

export default function FailedQueueScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<FailedItem[]>([]);

  const reload = useCallback(() => setItems(listFailed()), []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const onDismiss = async (id: string) => {
    await dismissFailed(id);
    reload();
  };

  const onDismissAll = () => {
    Alert.alert(
      'Dismiss all',
      'Remove all failed items? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss all',
          style: 'destructive',
          onPress: async () => { await dismissAllFailed(); reload(); },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Failed Items</Text>
        {items.length > 0 && (
          <TouchableOpacity onPress={onDismissAll}>
            <Text style={styles.dismissAll}>Dismiss all</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>No failed items — all clear.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.name}>{item.person_name}</Text>
              <Text style={styles.meta}>
                Check {item.direction} · {new Date(item.device_time).toLocaleString()}
              </Text>
              {item.error_message ? (
                <Text style={styles.error}>{item.error_message}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => onDismiss(item.id)}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  dismissAll: { color: colors.error, fontWeight: '600', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: colors.gray, fontSize: 15, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardBody: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12, color: colors.gray, marginTop: 2 },
  error: { fontSize: 12, color: colors.error, marginTop: 4 },
  dismissBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  dismissText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
