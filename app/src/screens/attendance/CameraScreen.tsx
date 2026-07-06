// Front-camera selfie capture -> confirm -> compress -> multipart upload.
// Rule: no selfie, no record (backend also enforces this).
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { logAttendance } from '../../services/attendanceApi';
import { ApiError } from '../../services/apiClient';
import { enqueue } from '../../services/syncQueue';
import { compressSelfie } from '../../utils/image';
import { colors, radius } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export default function CameraScreen({ navigation, route }: Props) {
  const { person, direction } = route.params;
  const insets = useSafeAreaInsets();
  const camRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>
          Camera access is required — a selfie is mandatory for every check-in/out.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const capture = async () => {
    if (!camRef.current) return;
    const photo = await camRef.current.takePictureAsync({ quality: 0.6 });
    setPhotoUri(photo.uri);
  };

  const submit = async () => {
    if (!photoUri) return;
    setBusy(true);
    try {
      const compressed = await compressSelfie(photoUri);
      try {
        await logAttendance({
          personId: person.id,
          direction,
          selfieUri: compressed,
        });
        Alert.alert(
          'Recorded',
          `${person.full_name} checked ${direction}.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } catch (e: any) {
        if (e instanceof ApiError) {
          // Server reached and rejected it — a real error, don't queue.
          Alert.alert('Failed', e.message ?? 'Could not record attendance');
          setBusy(false);
          return;
        }
        // Network failure: queue locally, sync when connectivity returns.
        await enqueue({
          personId: person.id,
          personName: person.full_name,
          direction,
          selfieUri: compressed,
        });
        Alert.alert(
          'Saved offline',
          `No connection — ${person.full_name}'s check-${direction} was queued and will sync automatically.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      }
    } catch (e: any) {
      Alert.alert('Failed', e.message ?? 'Could not record attendance');
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.banner, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.bannerText}>
          {person.full_name} — check {direction}
        </Text>
      </View>

      {photoUri ? (
        <>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => setPhotoUri(null)}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Confirm check {direction}</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <CameraView ref={camRef} style={styles.camera} facing="front" />
          <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shutter} onPress={capture}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <View style={styles.secondary} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.background,
    gap: 16,
  },
  permissionText: { textAlign: 'center', color: colors.text, fontSize: 16 },
  banner: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingBottom: 10,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  bannerText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  camera: { flex: 1 },
  preview: { flex: 1, resizeMode: 'cover' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#000',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 180,
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  secondary: { minWidth: 70, alignItems: 'center' },
  secondaryText: { color: '#fff', fontSize: 16 },
});
