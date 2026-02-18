import { useEffect, useState, useRef } from 'react';
import { collaborationManager } from '../../lib/CollaborationManager';
import { USER_COLORS } from '../../lib/userColors';
import { logger } from '../../lib/logger';
import './OnlineUsers.css';

interface UserInfo {
  name: string;
  color: string;
  clientId: number;
  mode?: 'wysiwyg' | 'markdown';
  cursorPosition?: number; // Character offset for CodeMirror
  isLocal?: boolean;
}

interface OnlineUsersProps {
  onUserClick?: (user: UserInfo) => void;
}

export function OnlineUsers({ onUserClick }: OnlineUsersProps) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [, setLocalClientId] = useState<number | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [usedColors, setUsedColors] = useState<string[]>([]);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Close color picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };

    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { provider } = await collaborationManager.connect();
        setLocalClientId(provider.awareness.doc.clientID);

        const updateUsers = () => {
          const states = provider.awareness.getStates();
          const myClientId = provider.awareness.doc.clientID;

          // Use a Map to deduplicate by user name
          // Only ONE entry per name - local user takes priority, otherwise most recent clientId
          const userMap = new Map<string, UserInfo>();

          logger.log('👥 OnlineUsers: Awareness states:', states.size);

          states.forEach((state: any, clientId: number) => {
            logger.log('  Client', clientId, ':', state);
            if (state.user?.name) {
              const isLocal = clientId === myClientId;
              const name = state.user.name;

              // Get cursor position from either CodeMirror (cmCursor) or TipTap (cursorPosition)
              const cursorPos = state.cmCursor?.position ?? state.cursorPosition;

              const userInfo: UserInfo = {
                name,
                color: state.user.color || '#999',
                clientId,
                mode: state.editorMode || 'markdown',
                cursorPosition: cursorPos,
                isLocal,
              };

              // Dedupe by name only - one entry per unique name
              const existing = userMap.get(name);
              if (!existing) {
                // First time seeing this name
                userMap.set(name, userInfo);
              } else if (isLocal) {
                // Local user always wins
                userMap.set(name, userInfo);
              } else if (!existing.isLocal && clientId > existing.clientId) {
                // Both remote, keep most recent
                userMap.set(name, userInfo);
              }
              // Otherwise keep existing (either it's local, or it's more recent)
            }
          });

          const userList = Array.from(userMap.values());
          logger.log('👥 OnlineUsers: Final user list (deduped):', userList);

          // Track colors used by other users
          const otherColors = userList
            .filter(u => !u.isLocal)
            .map(u => u.color.toUpperCase());
          setUsedColors(otherColors);

          // Sort: local user first, then alphabetically
          userList.sort((a, b) => {
            if (a.isLocal) return -1;
            if (b.isLocal) return 1;
            return a.name.localeCompare(b.name);
          });

          setUsers(userList);
        };

        // Initial update
        updateUsers();

        // Listen for awareness changes
        provider.awareness.on('change', updateUsers);

        cleanup = () => {
          provider.awareness.off('change', updateUsers);
          collaborationManager.disconnect();
        };
      } catch (error) {
        logger.error('Failed to connect OnlineUsers:', error);
      }
    })();

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const handleColorChange = (color: string) => {
    collaborationManager.setUserColor(color);
    setShowColorPicker(false);
  };

  const localUser = users.find(u => u.isLocal);

  if (users.length === 0) return null;

  return (
    <div className="online-users">
      {users.map((user) => (
        <div key={user.clientId} className="online-user-wrapper">
          <button
            className={`online-user ${user.isLocal ? 'is-local' : ''}`}
            style={{ backgroundColor: user.color }}
            title={user.isLocal
              ? `Click to change your color`
              : `Click to jump to ${user.name}'s position`}
            onClick={() => {
              if (user.isLocal) {
                setShowColorPicker(!showColorPicker);
              } else {
                onUserClick?.(user);
              }
            }}
          >
            <span className="user-name">{user.name}</span>
            {user.isLocal && <span className="user-you">(you)</span>}
          </button>

          {/* Color picker for local user */}
          {user.isLocal && showColorPicker && (
            <div ref={colorPickerRef} className="color-picker-popup">
              <div className="color-picker-title">Choose your color</div>
              <div className="color-picker-grid">
                {USER_COLORS.map((color) => {
                  const isUsed = usedColors.includes(color.toUpperCase());
                  const isCurrentColor = localUser?.color.toUpperCase() === color.toUpperCase();
                  return (
                    <button
                      key={color}
                      className={`color-option ${isCurrentColor ? 'current' : ''} ${isUsed ? 'used' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => !isUsed && handleColorChange(color)}
                      disabled={isUsed}
                      title={isUsed ? 'Color in use by another user' : isCurrentColor ? 'Current color' : 'Select this color'}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
