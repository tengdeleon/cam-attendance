// Compress a selfie before upload (~50-80KB target) to protect
// the 1GB free-tier storage cap.
import * as ImageManipulator from 'expo-image-manipulator';

export async function compressSelfie(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 720 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
}
