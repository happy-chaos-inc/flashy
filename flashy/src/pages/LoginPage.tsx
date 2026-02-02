import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './AuthPages.css';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const success = login(password);

    if (success) {
      navigate('/');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Welcome to Flashy</h1>
        <p className="auth-subtitle">Enter the shared password to access your study group's notes</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter shared password"
              required
              autoFocus
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="auth-button">
            Enter
          </button>
        </form>

        <p className="auth-footer-note">
          💡 This is a shared workspace for your study group
        </p>
      </div>
    </div>
  );
}
