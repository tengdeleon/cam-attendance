// Invisible component: replays the offline queue whenever connectivity
// returns (and once on startup). Mounted inside AuthProvider — flushes
// only while a teacher is signed in, since /attendance needs the token.
import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNetwork } from '../hooks/useNetwork';
import { flush, pendingCount } from '../services/syncQueue';

export default function SyncManager() {
  const { session } = useAuth();
  const { online } = useNetwork();
  const wasOnline = useRef<boolean | null>(null);

  useEffect(() => {
    const cameOnline = online === true && wasOnline.current !== true;
    wasOnline.current = online;

    if (!session || !cameOnline) return;
    if (pendingCount() === 0) return;

    flush().catch(() => {
      /* next connectivity change retries */
    });
  }, [online, session]);

  return null;
}
