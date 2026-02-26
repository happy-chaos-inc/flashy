import { useState, useEffect, useRef } from 'react';
import { collaborationManager } from '../lib/CollaborationManager';
import type { SaveStatus } from '../lib/DocumentPersistence';

export type SyncState = 'saved' | 'saving' | 'offline' | 'error';

interface SyncStatusResult {
  syncState: SyncState;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}

/**
 * Hook that derives a composite sync status from:
 * - DocumentPersistence save-status events (saving/saved/error)
 * - SimpleSupabaseProvider connection status (connected/disconnected/failed)
 *
 * Priority: error > saving > offline > saved
 */
export function useSyncStatus(roomId: string): SyncStatusResult {
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [providerConnected, setProviderConnected] = useState(true);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        await collaborationManager.connect(roomId);
      } catch {
        return;
      }

      if (!mounted) return;

      const persistence = collaborationManager.persistence;
      const provider = collaborationManager.getProvider();

      // Subscribe to save-status events
      const saveHandler = ({ status, message }: { status: SaveStatus; message?: string }) => {
        if (!mounted) return;
        setSaveStatus(status);
        if (status === 'saved') {
          setLastSavedAt(new Date());
          setErrorMessage(null);
        } else if (status === 'error') {
          setErrorMessage(message || 'Save failed');
        }
      };

      persistence?.on('save-status', saveHandler);

      // Subscribe to provider status events
      const providerHandler = ({ status }: { status: string }) => {
        if (!mounted) return;
        setProviderConnected(status === 'connected');
      };

      provider?.on('status', providerHandler);

      // Set initial provider state
      if (provider) {
        setProviderConnected(provider.connected);
      }

      cleanupRef.current = () => {
        persistence?.off('save-status', saveHandler);
        provider?.off('status', providerHandler);
      };
    };

    setup();

    return () => {
      mounted = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [roomId]);

  // Derive composite state: error > saving > offline > saved
  let syncState: SyncState = 'saved';
  if (saveStatus === 'error') {
    syncState = 'error';
  } else if (saveStatus === 'saving') {
    syncState = 'saving';
  } else if (!providerConnected) {
    syncState = 'offline';
  }

  return { syncState, lastSavedAt, errorMessage };
}
