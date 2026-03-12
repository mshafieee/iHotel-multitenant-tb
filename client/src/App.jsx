import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import usePlatformStore from './store/platformStore';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import GuestPortal from './pages/GuestPortal';
import DashboardPage from './pages/DashboardPage';
import PlatformLogin from './pages/PlatformLogin';
import PlatformDashboard from './pages/PlatformDashboard';
import PlatformResetPassword from './pages/PlatformResetPassword';
import BookingPage from './pages/BookingPage';
import HotelDirectoryPage from './pages/HotelDirectoryPage';
import KioskBookingPage from './pages/KioskBookingPage';

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
      <Route path="/platform/reset-password" element={<PlatformResetPassword />} />
      <Route path="/platform" element={
        <PlatformRoute><PlatformDashboard /></PlatformRoute>
      } />

      {/* Public booking pages */}
      <Route path="/book" element={<HotelDirectoryPage />} />
      <Route path="/book/:slug" element={<BookingPage />} />
      <Route path="/kiosk/:slug" element={<KioskBookingPage />} />

      {/* Guest routes */}
      <Route path="/guest" element={
        isAuthenticated
          ? <Navigate to={user?.role === 'guest' ? '/guest-portal' : '/'} />
          : <LoginPage />
      } />
      <Route path="/guest-portal" element={
        !isAuthenticated ? <Navigate to="/guest" /> :
        user?.role !== 'guest' ? <Navigate to="/" /> :
        <GuestPortal />
      } />

      {/* Landing / hotel staff login */}
      <Route path="/" element={
        !isAuthenticated ? <LandingPage /> :
        user?.role === 'guest' ? <Navigate to="/guest-portal" /> :
        <DashboardPage />
      } />
      <Route path="/login" element={isAuthenticated ? <Navigate to={user?.role === 'guest' ? '/guest-portal' : '/'} /> : <LandingPage />} />
      <Route path="/*" element={
        !isAuthenticated ? <Navigate to="/" /> :
        user?.role === 'guest' ? <Navigate to="/guest-portal" /> :
        <DashboardPage />
      } />
    </Routes>
  );
}
