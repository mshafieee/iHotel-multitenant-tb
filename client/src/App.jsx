import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import LoginPage from './pages/LoginPage';
import GuestPortal from './pages/GuestPortal';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const { isAuthenticated, user, loading, checkAuth } = useAuthStore();

  useEffect(() => { checkAuth(); }, []);

  if (loading) {
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
      <Route path="/guest" element={isAuthenticated ? <Navigate to={user?.role === 'guest' ? '/guest-portal' : '/'} /> : <LoginPage />} />
      <Route path="/guest-portal" element={<GuestPortal />} />
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />} />
    </Routes>
  );
}
