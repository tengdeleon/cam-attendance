// In-memory selfie viewer — RA 10173 §9 compliant.
// URL lives only in component state; never written to AsyncStorage, file system,
// media library, or SQLite. Cleared on modal close.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getSelfieUrl } from '../services/attendanceApi';
import { ApiError } from '../services/apiClient';
import type { Direction } from '../types';
import { colors, radius, spacing, type } from '../constants/theme';

export interface SelfieModalProps {
  attendanceId: string | null;
  visible: boolean;
  onClose: () => void;
  personName: string;
  direction: Direction;
  serverTime: string;
}

type FetchState = 'idle' | 'loading' | 'success' | 'error' | 'purged';

export default function SelfieModal({
  attendanceId,
  visible,
  onClose,
  personName,
  direction,
  serverTime,
}: SelfieModalProps) {
  // URL lives only here — component state, never persisted anywhere.
  const [url, setUrl] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');

  const fetchUrl = async (id: string) => {
    setFetchState('loading');
    setUrl(null);
    try {
      const res = await getSelfieUrl(id);
      setUrl(res.url);
      setFetchState('success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFetchState('purged');
      } else {
        setFetchState('error');
      }
    }
  };

  // Fetch on every open; never reuse a previously fetched URL (it expires in 60 s).
  useEffect(() => {
    if (visible && attendanceId) {
      fetchUrl(attendanceId);
    }
  }, [visible, attendanceId]);

  const handleClose = () => {
    setUrl(null);
    setFetchState('idle');
    onClose();
  };

  const directionLabel = direction === 'in' ? 'IN' : 'OUT';
  const directionColor = direction === 'in' ? colors.success : colors.gray;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.personName}>{personName}</Text>
              <Text style={styles.serverTime}>{serverTime}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: directionColor }]}>
              <Text style={styles.badgeText}>{directionLabel}</Text>
            </View>
          </View>

          {/* Body */}
          <View style={styles.body}>
            {fetchState === 'loading' && (
              <ActivityIndicator size="large" color={colors.primary} />
            )}

            {fetchState === 'success' && url !== null && (
              <Image
                source={{ uri: url }}
                style={styles.image}
                resizeMode="cover"
              />
            )}

            {fetchState === 'purged' && (
              <Text style={styles.infoText}>
                Selfie has been deleted per retention policy.
              </Text>
            )}

            {fetchState === 'error' && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText}>Could not load selfie.</Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => attendanceId && fetchUrl(attendanceId)}
                >
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Close */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flex: 1, marginRight: spacing.sm },
  personName: { ...type.body, fontWeight: '700' as const, color: colors.ink },
  serverTime: { ...type.caption, marginTop: 2 },
  badge: {
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' as const },
  body: {
    minHeight: 240,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  image: {
    width: '100%',
    height: 320,
  },
  infoText: {
    color: colors.gray,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorBlock: { alignItems: 'center', gap: spacing.sm },
  errorText: { color: colors.error, fontSize: 14 },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
  },
  retryText: { color: colors.onPrimary, fontWeight: '700' as const, fontSize: 14 },
  closeBtn: {
    margin: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
});
