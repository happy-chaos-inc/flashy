import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '../components/Logo';
import './AuthPages.css';

interface LoginPageProps {
  redirectTo?: string;
}

export function LoginPage({ redirectTo }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedName = username.trim();
    if (!trimmedName) {
      setError('Please enter your name');
      return;
    }

    if (trimmedName.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }

    if (trimmedName.length > 20) {
      setError('Name must be 20 characters or less');
      return;
    }

    login(trimmedName);

    if (redirectTo) {
      navigate(redirectTo);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <Logo size={50} strokeColor="#333" />
          <h1>Flashy</h1>
        </div>

        <p className="auth-subtitle">Enter your name to join</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your name"
            required
            autoFocus
            maxLength={20}
          />

          {error && <div className="error-message">{error}</div>}

          <button type="submit">Join</button>
        </form>
      </div>
    </div>
  );
}
