import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { LexicalEditor } from '../components/editor/LexicalEditor';
import { ConnectionStatus } from '../components/editor/ConnectionStatus';
import './EditorPage.css';

export function EditorPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="editor-page">
      <div className="editor-header">
        <h1 className="editor-title">Flashy</h1>
        <div className="header-actions">
          <ConnectionStatus />
          <button onClick={handleLogout} className="lock-button">
            🔒 Lock
          </button>
        </div>
      </div>

      <div className="editor-container">
        <div className="editor-content">
          <LexicalEditor />
        </div>

        <div className="flashcard-sidebar">
          <h3>Flashcards</h3>
          <p className="sidebar-placeholder">
            Flashcards will appear here as you add headers
          </p>
        </div>
      </div>
    </div>
  );
}
