// Online/offline status via NetInfo. `online` is null until the first
// event arrives (unknown), then boolean.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useNetwork(): { online: boolean | null } {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable can be null while probing; fall back to isConnected.
      setOnline(state.isInternetReachable ?? state.isConnected);
    });
    return unsubscribe;
  }, []);

  return { online };
}
