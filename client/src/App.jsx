import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import usePlatformStore from './store/platformStore';
import LoginPage from './pages/LoginPage';
import GuestPortal from './pages/GuestPortal';
import DashboardPage from './pages/DashboardPage';
import PlatformLogin from './pages/PlatformLogin';
import PlatformDashboard from './pages/PlatformDashboard';

// Guard for platform admin routes
function PlatformRoute({ children }) {
  const { isAuthenticated, authLoading } = usePlatformStore();
  if (authLoading) return null;
  return isAuthenticated ? children : <Navigate to="/platform/login" />;
}

export default function App() {
  const { isAuthenticated, user, loading, checkAuth } = useAuthStore();
  const { isAuthenticated: isPlatformAuth, checkAuth: checkPlatformAuth, authLoading } = usePlatformStore();

  useEffect(() => {
    checkAuth();
    checkPlatformAuth();
  }, []);

  // Wait for both auth checks before rendering
  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Platform admin routes */}
      <Route path="/platform/login" element={
        isPlatformAuth ? <Navigate to="/platform" /> : <PlatformLogin />
      } />
      <Route path="/platform" element={
        <PlatformRoute><PlatformDashboard /></PlatformRoute>
      } />

      {/* Guest routes */}
      <Route path="/guest" element={
        isAuthenticated
          ? <Navigate to={user?.role === 'guest' ? '/guest-portal' : '/'} />
          : <LoginPage />
      } />
      <Route path="/guest-portal" element={<GuestPortal />} />

      {/* Staff routes */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}
