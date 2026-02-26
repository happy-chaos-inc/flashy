import { useState, useEffect, useRef } from 'react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { collaborationManager } from '../../lib/CollaborationManager';
import { logger } from '../../lib/logger';
import './SyncStatus.css';

interface SyncStatusProps {
  roomId: string;
}

export function SyncStatus({ roomId }: SyncStatusProps) {
  const { syncState, lastSavedAt, errorMessage } = useSyncStatus(roomId);
  const [showDropdown, setShowDropdown] = useState(false);
  const [resetting, setResetting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const handleRetry = () => {
    collaborationManager.persistence?.saveNow();
    setShowDropdown(false);
  };

  const handleResetLocal = async () => {
    setResetting(true);
    try {
      await collaborationManager.resetRoom(roomId, 'local');
      setShowDropdown(false);
    } catch (error) {
      logger.error('Reset local failed:', error);
    } finally {
      setResetting(false);
    }
  };

  const handleResetFull = async () => {
    setResetting(true);
    try {
      await collaborationManager.resetRoom(roomId, 'full');
      setShowDropdown(false);
    } catch (error) {
      logger.error('Reset full failed:', error);
    } finally {
      setResetting(false);
    }
  };

  const formatLastSaved = (): string => {
    if (!lastSavedAt) return '';
    const seconds = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
    if (seconds < 10) return 'Saved';
    if (seconds < 60) return `Saved ${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Saved ${minutes}m ago`;
    return `Saved ${Math.floor(minutes / 60)}h ago`;
  };

  // Re-render periodically to update "Saved Xm ago" text
  const [, setTick] = useState(0);
  useEffect(() => {
    if (syncState !== 'saved' || !lastSavedAt) return;
    const timer = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(timer);
  }, [syncState, lastSavedAt]);

  const getLabel = (): string => {
    switch (syncState) {
      case 'saving': return 'Saving...';
      case 'offline': return 'Offline';
      case 'error': return 'Sync error';
      case 'saved': return formatLastSaved() || 'Saved';
    }
  };

  const isClickable = syncState === 'error';

  return (
    <div className="sync-status-container" ref={dropdownRef}>
      <button
        className={`sync-status sync-status--${syncState}${isClickable ? ' sync-status--clickable' : ''}`}
        onClick={isClickable ? () => setShowDropdown(!showDropdown) : undefined}
        title={errorMessage || getLabel()}
      >
        <span className={`sync-dot sync-dot--${syncState}`} />
        <span className="sync-label">{getLabel()}</span>
      </button>

      {showDropdown && (
        <div className="sync-dropdown">
          {errorMessage && (
            <div className="sync-dropdown-error">{errorMessage}</div>
          )}
          <button className="sync-dropdown-item" onClick={handleRetry}>
            Retry now
          </button>
          <button
            className="sync-dropdown-item"
            onClick={handleResetLocal}
            disabled={resetting}
          >
            Reset local cache
          </button>
          <button
            className="sync-dropdown-item sync-dropdown-item--danger"
            onClick={handleResetFull}
            disabled={resetting}
          >
            Reset room
          </button>
        </div>
      )}
    </div>
  );
}
