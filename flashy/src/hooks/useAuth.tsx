import { useState, useEffect, createContext, useContext } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (password: string) => boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// The shared password - stored in environment variable
const SHARED_PASSWORD = process.env.REACT_APP_SHARED_PASSWORD || 'flashy123';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  useEffect(() => {
    // Check if user was previously authenticated (stored in session)
    const wasAuthenticated = sessionStorage.getItem('flashy_auth') === 'true';
    setIsAuthenticated(wasAuthenticated);
  }, []);

  const login = (password: string): boolean => {
    if (password === SHARED_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem('flashy_auth', 'true');
      return true;
    }
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem('flashy_auth');
  };

  const value = {
    isAuthenticated,
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
