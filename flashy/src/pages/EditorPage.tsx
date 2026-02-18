import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { MarkdownEditor } from '../components/editor/MarkdownEditor';
import { TiptapEditor } from '../components/editor/TiptapEditor';
import { VersionHistory } from '../components/editor/VersionHistory';
import { OnlineUsers } from '../components/editor/OnlineUsers';
import { MouseCursors } from '../components/editor/MouseCursors';
import { Logo } from '../components/Logo';
import { StudyMode } from '../components/StudyMode';
import { ModeSelector, EditorMode } from '../components/editor/ModeSelector';
import { FlashcardSidebar, Flashcard } from '../components/FlashcardSidebar';
import { ChatSidebar } from '../components/ChatSidebar';
import { collaborationManager } from '../lib/CollaborationManager';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';
import { logger } from '../lib/logger';
import { useEffect, useState } from 'react';
import { LogOut, ChevronLeft, ChevronRight, Share2, Check } from 'lucide-react';
import './EditorPage.css';

// Type for user info from OnlineUsers
interface ClickedUser {
  name: string;
  color: string;
  clientId: number;
  mode?: 'wysiwyg' | 'markdown';
  cursorPosition?: number;
}

interface EditorPageProps {
  roomId: string;
}

export function EditorPage({ roomId }: EditorPageProps) {
  // Single source of truth for editor and sidebar minimum widths
  const MIN_PANEL_WIDTH = 400;
  const MARGIN_LEFT = 24;
  const MARGIN_GAP = 16;

  const { logout } = useAuth();
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showStudyMode, setShowStudyMode] = useState(false);
  // Three-panel layout: left sidebar (flashcards), center (editor), right sidebar (chat)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(420);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(420);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [isAnimatingLeft, setIsAnimatingLeft] = useState(false);
  const [isAnimatingRight, setIsAnimatingRight] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [starredCards, setStarredCards] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('starredCards');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [isRoomFull, setIsRoomFull] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    const saved = localStorage.getItem('flashy_editor_mode');
    return (saved as EditorMode) || 'markdown';
  });
  const [scrollTarget, setScrollTarget] = useState<{ position: number; timestamp: number } | null>(null);

  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleModeChange = async (mode: EditorMode) => {
    // No sync needed - Y.XmlFragment is the only source of truth
    // Both editors read/write to Y.XmlFragment
    setEditorMode(mode);
    localStorage.setItem('flashy_editor_mode', mode);

    // Broadcast mode change via awareness
    try {
      const { provider } = await collaborationManager.connect(roomId);
      provider.awareness.setLocalStateField('editorMode', mode);
    } catch (error) {
      logger.error('Failed to broadcast mode change:', error);
    }
  };

  // Handle clicking on a user to jump to their caret position
  const handleUserClick = (user: ClickedUser) => {
    const targetMode = user.mode || 'markdown';
    const position = user.cursorPosition;

    // If position is unknown, just switch modes
    if (position === undefined) {
      if (targetMode !== editorMode) {
        handleModeChange(targetMode);
      }
      return;
    }

    // Switch mode if needed, then scroll
    if (targetMode !== editorMode) {
      handleModeChange(targetMode);
      // Wait for mode switch, then scroll
      setTimeout(() => {
        setScrollTarget({ position, timestamp: Date.now() });
      }, 100);
    } else {
      setScrollTarget({ position, timestamp: Date.now() });
    }
  };

  const handleRestore = async (version: number) => {
    // Access the persistence layer from the collaboration manager
    const persistence = (collaborationManager as any).persistence;
    if (persistence) {
      await persistence.restoreVersion(version);
    } else {
      throw new Error('Persistence not initialized');
    }
  };

  // Parse flashcards from markdown content
  const parseFlashcards = (content: string): Flashcard[] => {
    const lines = content.split('\n');
    const cards: Flashcard[] = [];
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match H1 headers: # Section
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match) {
        currentSection = h1Match[1].trim();
        continue;
      }

      // Match H2 headers: ## Term
      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        const term = h2Match[1].trim();

        // Collect all content until next header (H1 or H2)
        let definition = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/^#{1,2}\s+/)) {
          definition += lines[j] + '\n';
          j++;
        }

        cards.push({
          id: `card-${i}`,
          term,
          definition: definition.trim(),
          lineNumber: i,
          section: currentSection || undefined,
        });
      }
    }

    return cards;
  };

  // Toggle star on flashcard
  const toggleStar = (cardId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Don't trigger card click
    const newStarred = new Set(starredCards);
    if (newStarred.has(cardId)) {
      newStarred.delete(cardId);
    } else {
      newStarred.add(cardId);
    }
    setStarredCards(newStarred);
    localStorage.setItem('starredCards', JSON.stringify(Array.from(newStarred)));
  };

  // Handle resizing for left sidebar (flashcards)
  const handleLeftMouseDown = (e: React.MouseEvent) => {
    setDragStartX(e.clientX);
    setIsDraggingLeft(true);
  };

  // Handle resizing for right sidebar (chat)
  const handleRightMouseDown = (e: React.MouseEvent) => {
    setDragStartX(e.clientX);
    setIsDraggingRight(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragStartX === null) return;

      // Only start dragging if moved more than 3 pixels
      const dragDistance = Math.abs(e.clientX - dragStartX);
      if (dragDistance < 3) return;

      if (isDraggingLeft) {
        // Left sidebar: width = mouse position from left edge
        const newWidth = e.clientX - MARGIN_LEFT;
        // Max width accounts for: right sidebar + editor min width + margins
        const maxWidth = window.innerWidth - (rightSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2);
        if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxWidth) {
          setLeftSidebarWidth(newWidth);
        }
      } else if (isDraggingRight) {
        // Right sidebar: width = distance from right edge
        const newWidth = window.innerWidth - e.clientX - MARGIN_LEFT;
        // Max width accounts for: left sidebar + editor min width + margins
        const maxWidth = window.innerWidth - (leftSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2);
        if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxWidth) {
          setRightSidebarWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
      setDragStartX(null);
    };

    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingLeft, isDraggingRight, dragStartX, leftSidebarWidth, rightSidebarWidth]);

  // Keyboard shortcut for mode switching (Ctrl/Cmd + Shift + M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const newMode = editorMode === 'wysiwyg' ? 'markdown' : 'wysiwyg';
        handleModeChange(newMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  // Add scroll listener for navbar effect
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 20;
      setIsScrolled(scrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Subscribe to document changes
  useEffect(() => {
    const init = async () => {
      try {
        const { ydoc, provider } = await collaborationManager.connect(roomId);

        // Broadcast initial editor mode
        provider.awareness.setLocalStateField('editorMode', editorMode);

        // Y.XmlFragment is the ONLY source of truth
        const yXmlFragment = ydoc.getXmlFragment('prosemirror');

        // Serialize Y.XmlFragment to markdown for flashcard parsing
        const getContent = (): string => {
          return prosemirrorToMarkdown(yXmlFragment);
        };

        // Initial parse
        const initialCards = parseFlashcards(getContent());
        setFlashcards(initialCards);

        // Listen for Y.XmlFragment changes (both modes)
        // Debounce to avoid rapid calls during transactions
        let debounceTimer: NodeJS.Timeout | null = null;
        const yXmlObserver = () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            try {
              const content = prosemirrorToMarkdown(yXmlFragment);
              const cards = parseFlashcards(content);
              setFlashcards(cards);
            } catch (e) {
              logger.warn('Failed to parse flashcards:', e);
            }
          }, 100);
        };

        yXmlFragment.observeDeep(yXmlObserver);

        return () => {
          yXmlFragment.unobserveDeep(yXmlObserver);
        };
      } catch (error: any) {
        if (error.message === 'ROOM_FULL') {
          logger.log('🚫 Room is full, cannot join');
          setIsRoomFull(true);
        } else {
          logger.error('Failed to connect:', error);
        }
      }
    };

    init();
  }, [editorMode, roomId]);

  // Show "party full" message if room is at capacity
  if (isRoomFull) {
    return (
      <div className="editor-page" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #F5E1FD 0%, #E8D5F2 100%)',
      }}>
        <div style={{
          textAlign: 'center',
          padding: '48px',
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          maxWidth: '500px',
        }}>
          <Logo size={80} />
          <h1 style={{
            fontSize: '32px',
            color: '#1f2937',
            marginTop: '24px',
            marginBottom: '16px',
          }}>
            Party's Full! 🎉
          </h1>
          <p style={{
            fontSize: '18px',
            color: '#6b7280',
            lineHeight: '1.6',
          }}>
            This study session has reached its maximum capacity of 4 users.
            Please try again later when someone leaves.
          </p>
          <button
            onClick={handleLogout}
            style={{
              marginTop: '32px',
              padding: '12px 32px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'white',
              background: '#B399D4',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#9b7ec4'}
            onMouseOut={(e) => e.currentTarget.style.background = '#B399D4'}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  const isAnimating = isAnimatingLeft || isAnimatingRight;

  return (
    <div className="editor-page" style={{
      '--left-sidebar-width': `${leftSidebarWidth}px`,
      '--right-sidebar-width': `${rightSidebarWidth}px`,
      '--min-panel-width': `${MIN_PANEL_WIDTH}px`,
      '--margin-left': `${MARGIN_LEFT}px`,
      '--margin-gap': `${MARGIN_GAP}px`
    } as React.CSSProperties}>
      <MouseCursors />
      <div className={`editor-header ${isScrolled ? 'scrolled' : ''}`}>
        <div className="editor-title-container">
          <Logo size={40} />
          <h1 className="editor-title">Flashy</h1>
        </div>
        <div className="header-actions">
          <OnlineUsers onUserClick={handleUserClick} />
          <button onClick={handleShare} className="share-button" title="Copy room link">
            {copied ? <Check size={20} /> : <Share2 size={20} />}
            <span>{copied ? 'Copied!' : 'Share'}</span>
          </button>
          <VersionHistory onRestore={handleRestore} roomId={roomId} />
          <button onClick={handleLogout} className="lock-button" title="Leave room">
            <LogOut size={22} />
          </button>
        </div>
      </div>

      {/* Left Sidebar - Flashcards */}
      <FlashcardSidebar
        flashcards={flashcards}
        starredCards={starredCards}
        onToggleStar={toggleStar}
        onStartStudy={() => setShowStudyMode(true)}
        isAnimating={isAnimatingLeft}
      />

      {/* Left Resize Handle */}
      <div
        className={`resize-handle-left ${isAnimatingLeft ? 'animating' : ''}`}
        style={{ left: `calc(var(--left-sidebar-width) + var(--margin-left) + var(--margin-gap) / 2 - 24px)` }}
        onMouseDown={handleLeftMouseDown}
      >
        <div className={`resize-stick ${isAnimatingLeft ? 'animating' : ''}`} />
        <button
          className={`resize-toggle-button ${isAnimatingLeft ? 'animating' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const maxWidth = window.innerWidth - (rightSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2);
            setIsAnimatingLeft(true);
            if (leftSidebarWidth >= maxWidth - 5) {
              setLeftSidebarWidth(MIN_PANEL_WIDTH);
            } else {
              setLeftSidebarWidth(maxWidth);
            }
            setTimeout(() => setIsAnimatingLeft(false), 500);
          }}
          title="Toggle flashcard sidebar"
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={32} height={32} viewBox="0 0 55 55" xmlns="http://www.w3.org/2000/svg">
              <g transform="translate(-30, -13) scale(4) rotate(-15)">
                <path d="M10 16.7 L13 18.5 C13.8321 19.1154 14.9154 18.8615 15.2857 18.0313L18.2815 11.4698C18.6518 10.6396 18.1606 9.67891 17.2518 9.53429L8.3871 8.16507 C7 8.02045 6.71766 8.79742 6.34815 9.68484 L5.6 11.5 C4.5 13.9 5 13.7 8 15.5 z" fill="#B399D4" stroke="#B399D4" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </g>
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white' }}>
              {leftSidebarWidth >= window.innerWidth - (rightSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2) - 5
                ? <ChevronLeft size={14} />
                : <ChevronRight size={14} />}
            </div>
          </div>
        </button>
      </div>

      {/* Editor Content */}
      <div className={`editor-content ${isAnimating ? 'animating' : ''}`}>
        <div className="mode-selector-overlay">
          <ModeSelector currentMode={editorMode} onModeChange={handleModeChange} />
        </div>
        <div className={`editor-panel ${editorMode === 'wysiwyg' ? 'active' : 'hidden'}`}>
          <TiptapEditor scrollTarget={scrollTarget} isActive={editorMode === 'wysiwyg'} />
        </div>
        <div className={`editor-panel ${editorMode === 'markdown' ? 'active' : 'hidden'}`}>
          <MarkdownEditor scrollTarget={scrollTarget} isActive={editorMode === 'markdown'} />
        </div>
      </div>

      {/* Right Resize Handle */}
      <div
        className={`resize-handle-right ${isAnimatingRight ? 'animating' : ''}`}
        style={{ right: `calc(var(--right-sidebar-width) + var(--margin-left) + var(--margin-gap) / 2 - 24px)` }}
        onMouseDown={handleRightMouseDown}
      >
        <div className={`resize-stick ${isAnimatingRight ? 'animating' : ''}`} />
        <button
          className={`resize-toggle-button ${isAnimatingRight ? 'animating' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const maxWidth = window.innerWidth - (leftSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2);
            setIsAnimatingRight(true);
            if (rightSidebarWidth >= maxWidth - 5) {
              setRightSidebarWidth(MIN_PANEL_WIDTH);
            } else {
              setRightSidebarWidth(maxWidth);
            }
            setTimeout(() => setIsAnimatingRight(false), 500);
          }}
          title="Toggle chat sidebar"
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={32} height={32} viewBox="0 0 55 55" xmlns="http://www.w3.org/2000/svg">
              <g transform="translate(-30, -13) scale(4) rotate(-15)">
                <path d="M10 16.7 L13 18.5 C13.8321 19.1154 14.9154 18.8615 15.2857 18.0313L18.2815 11.4698C18.6518 10.6396 18.1606 9.67891 17.2518 9.53429L8.3871 8.16507 C7 8.02045 6.71766 8.79742 6.34815 9.68484 L5.6 11.5 C4.5 13.9 5 13.7 8 15.5 z" fill="#B399D4" stroke="#B399D4" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </g>
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white' }}>
              {rightSidebarWidth >= window.innerWidth - (leftSidebarWidth + MIN_PANEL_WIDTH + MARGIN_GAP * 2 + MARGIN_LEFT * 2) - 5
                ? <ChevronRight size={14} />
                : <ChevronLeft size={14} />}
            </div>
          </div>
        </button>
      </div>

      {/* Right Sidebar - Chat */}
      <ChatSidebar isAnimating={isAnimatingRight} roomId={roomId} />

      {showStudyMode && flashcards.length > 0 && (
        <StudyMode
          flashcards={flashcards}
          starredCards={starredCards}
          onClose={() => setShowStudyMode(false)}
        />
      )}
    </div>
  );
}
