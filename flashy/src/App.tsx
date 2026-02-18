import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { EditorPage } from './pages/EditorPage';
import { LandingPage } from './pages/LandingPage';
import { UpdateNotification } from './components/UpdateNotification';
import { testBroadcast } from './lib/test-broadcast';

// Protected route - requires auth, shows editor for a specific room
function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { isAuthenticated } = useAuth();

  if (!roomId) {
    return <Navigate to="/" replace />;
  }

  // If not authenticated, show login (which will redirect back after auth)
  if (!isAuthenticated) {
    return <LoginPage redirectTo={`/room/${roomId}`} />;
  }

  return <EditorPage roomId={roomId} />;
}

function AppContent() {
  useEffect(() => {
    // Test if Supabase Realtime works at all
    testBroadcast();
  }, []);

  return (
    <>
      <UpdateNotification />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        {/* Redirect old routes or 404s to landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function App() {
  // basename for GitHub Pages - matches homepage in package.json
  const basename = process.env.NODE_ENV === 'production' ? '/flashy' : '';

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
