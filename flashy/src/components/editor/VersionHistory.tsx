import { useState, useEffect, useCallback } from 'react';
import { History } from 'lucide-react';
import { supabase } from '../../config/supabase';
import { logger } from '../../lib/logger';
import './VersionHistory.css';

interface Version {
  version: number;
  created_at: string;
  last_edited_by: string;
}

interface VersionHistoryProps {
  onRestore: (version: number) => Promise<void>;
  roomId: string;
}

export function VersionHistory({ onRestore, roomId }: VersionHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<Version | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      // Get all versions from last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const documentId = `room-${roomId}`;
      const { data, error } = await supabase
        .from('document_versions')
        .select('version, created_at, last_edited_by')
        .eq('document_id', documentId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50); // Show up to 50 snapshots

      if (error) throw error;

      // Show all snapshots (no daily grouping)
      setVersions(data || []);
    } catch (error) {
      logger.error('❌ Error loading versions:', error);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (isOpen) {
      loadVersions();
    }
  }, [isOpen, loadVersions]);

  const handleRestoreClick = (version: Version) => {
    setConfirmRestore(version);
  };

  const handleConfirmRestore = async () => {
    if (!confirmRestore) return;

    try {
      await onRestore(confirmRestore.version);
      setConfirmRestore(null);
      setIsOpen(false);
    } catch (error) {
      logger.error('❌ Restore failed:', error);
      alert('Restore failed. Check console for details.');
    }
  };

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const versionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const diffDays = Math.floor((today.getTime() - versionDate.getTime()) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  return (
    <>
      <div className="version-history-container">
        <button
          className="version-history-button"
          onClick={() => setIsOpen(!isOpen)}
        >
          <History size={22} />
        </button>

        {isOpen && (
          <div className="version-history-dropdown">
            <div className="version-history-header">
              <h3>Version History (7 Days)</h3>
              <button
                className="version-history-close"
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="version-history-list">
              {loading ? (
                <div className="version-history-loading">Loading...</div>
              ) : versions.length === 0 ? (
                <div className="version-history-empty">
                  No snapshots yet. Start editing and they'll appear here!
                </div>
              ) : (
                versions.map((version, index) => (
                  <div key={version.version} className="version-history-item">
                    <div className="version-history-info">
                      <div className="version-history-time">
                        {index === 0 ? '● ' : '○ '}
                        {formatTime(version.created_at)}
                      </div>
                      <div className="version-history-user">
                        by {version.last_edited_by || 'anonymous'}
                      </div>
                    </div>
                    {index === 0 ? (
                      <span className="version-history-current">Current</span>
                    ) : (
                      <button
                        className="version-history-restore"
                        onClick={() => handleRestoreClick(version)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmRestore && (
        <div className="version-history-modal-overlay">
          <div className="version-history-modal">
            <h3>Restore Version?</h3>
            <p>
              Restore to version from{' '}
              <strong>{formatTime(confirmRestore.created_at)}</strong>?
            </p>
            <p className="version-history-modal-warning">
              This will replace the current content. Other users will see the change.
            </p>
            <div className="version-history-modal-buttons">
              <button
                className="version-history-modal-cancel"
                onClick={() => setConfirmRestore(null)}
              >
                Cancel
              </button>
              <button
                className="version-history-modal-confirm"
                onClick={handleConfirmRestore}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
