/**
 * ProduTime Cloud Admin Console - Main App Component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api, getStoredTokens, getStoredUser, clearStoredTokens, User } from './services/api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PairingPage } from './pages/PairingPage';
import { Sidebar } from './components/Sidebar';

// ============================================================================
// Auth Context
// ============================================================================

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = React.createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
});

// ============================================================================
// Protected Route
// ============================================================================

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tokens = getStoredTokens();
  const location = useLocation();

  if (!tokens?.accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

// ============================================================================
// Main Layout
// ============================================================================

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pendingCount, setPendingCount] = useState(0);
  const user = getStoredUser();

  // Load pending pairing count
  useEffect(() => {
    const loadPendingCount = async () => {
      try {
        const requests = await api.getPendingRequests();
        setPendingCount(requests.length);
      } catch {
        // Ignore errors
      }
    };

    loadPendingCount();
    const interval = setInterval(loadPendingCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar pendingCount={pendingCount} tenantName={user?.tenantName} />
      <main style={{ flex: 1, backgroundColor: '#f5f5f5', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
};

// ============================================================================
// App Component
// ============================================================================

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(!!getStoredTokens()?.accessToken);
  const navigate = useNavigate();

  // Handle auth errors (token expiry)
  useEffect(() => {
    api.setAuthErrorHandler(() => {
      clearStoredTokens();
      setUser(null);
      setIsAuthenticated(false);
      navigate('/login');
    });
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setUser(response.user);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setIsAuthenticated(false);
    navigate('/login');
  }, [navigate]);

  const authContextValue: AuthContextType = {
    user,
    isAuthenticated,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={authContextValue}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <MainLayout>
                <DashboardPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pairing"
          element={
            <ProtectedRoute>
              <MainLayout>
                <PairingPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
};

export default App;
