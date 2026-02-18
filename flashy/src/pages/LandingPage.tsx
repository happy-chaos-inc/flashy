import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Plus, Users, ArrowRight } from 'lucide-react';
import './LandingPage.css';

// Generate a short, readable room ID
function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function LandingPage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  const handleCreateRoom = () => {
    const roomId = generateRoomId();
    navigate(`/room/${roomId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();

    if (!code) {
      setError('Please enter a room code');
      return;
    }

    // Extract room ID from full URL if pasted
    let roomId = code;
    if (code.includes('/room/')) {
      const match = code.match(/\/room\/([a-z0-9]+)/);
      if (match) {
        roomId = match[1];
      }
    }

    // Basic validation
    if (!/^[a-z0-9]+$/.test(roomId)) {
      setError('Invalid room code');
      return;
    }

    navigate(`/room/${roomId}`);
  };

  return (
    <div className="landing-page">
      <div className="landing-content">
        <div className="landing-header">
          <Logo size={80} />
          <h1>Flashy</h1>
          <p className="landing-tagline">
            Collaborative flashcards with AI assistance
          </p>
        </div>

        <div className="landing-actions">
          <button className="landing-create-btn" onClick={handleCreateRoom}>
            <Plus size={24} />
            <span>Create a Room</span>
          </button>

          <div className="landing-divider">
            <span>or join existing</span>
          </div>

          <form className="landing-join-form" onSubmit={handleJoinRoom}>
            <div className="landing-join-input-wrapper">
              <Users size={20} className="landing-join-icon" />
              <input
                type="text"
                className="landing-join-input"
                placeholder="Enter room code or paste link"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setError('');
                }}
              />
              <button
                type="submit"
                className="landing-join-btn"
                disabled={!joinCode.trim()}
              >
                <ArrowRight size={20} />
              </button>
            </div>
            {error && <p className="landing-error">{error}</p>}
          </form>
        </div>

        <div className="landing-features">
          <div className="landing-feature">
            <span className="feature-icon">📝</span>
            <span>Real-time collaboration</span>
          </div>
          <div className="landing-feature">
            <span className="feature-icon">🤖</span>
            <span>AI study assistant</span>
          </div>
          <div className="landing-feature">
            <span className="feature-icon">🎯</span>
            <span>Study mode with flashcards</span>
          </div>
        </div>

        <p className="landing-footer">
          Share your room link with up to 3 friends to study together
        </p>
      </div>
    </div>
  );
}
