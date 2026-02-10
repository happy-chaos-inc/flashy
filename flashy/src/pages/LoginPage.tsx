import { useState, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '../components/Logo';
import './AuthPages.css';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Please enter your name');
      return;
    }

    const success = login(password, username.trim());

    if (!success) {
      setError('Incorrect password');
      setPassword('');
    }
    // No reload on login - auth state change handles navigation
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <Logo size={50} strokeColor="#333" />
          <h1>Flashy</h1>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Name"
            required
            autoFocus
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
          />

          {error && <div className="error-message">{error}</div>}

          <button type="submit">Enter</button>
        </form>
      </div>
    </div>
  );
}
