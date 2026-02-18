import { useState, useEffect, createContext, useContext } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    // Check if user was previously authenticated (stored in session)
    const wasAuthenticated = sessionStorage.getItem('flashy_auth') === 'true';
    const storedUsername = sessionStorage.getItem('flashy_username');
    setIsAuthenticated(wasAuthenticated);
    setUsername(storedUsername);

    // Ensure user_id is also restored (backwards compatibility)
    if (storedUsername && !sessionStorage.getItem('flashy_user_id')) {
      sessionStorage.setItem('flashy_user_id', storedUsername);
    }
  }, []);

  const login = (username: string): void => {
    setIsAuthenticated(true);
    setUsername(username);
    sessionStorage.setItem('flashy_auth', 'true');
    sessionStorage.setItem('flashy_username', username);
    sessionStorage.setItem('flashy_user_id', username);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUsername(null);
    sessionStorage.removeItem('flashy_auth');
    sessionStorage.removeItem('flashy_username');
    sessionStorage.removeItem('flashy_user_id');
  };

  const value = {
    isAuthenticated,
    username,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
