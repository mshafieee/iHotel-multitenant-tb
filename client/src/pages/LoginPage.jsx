import React, { useState, useEffect } from 'react';
import { Building2, Shield, Eye, EyeOff } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { setTokens } from '../utils/api';
import { useSearchParams } from 'react-router-dom';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, error, setError } = useAuthStore();
  const [searchParams] = useSearchParams();

  // Detect guest mode from URL: /guest?token=xxx or /guest?room=1501
  const guestToken = searchParams.get('token');
  const guestRoom = searchParams.get('room');
  const isGuestMode = !!guestToken || !!guestRoom;

  // Guest login fields
  const [guestName, setGuestName] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState('');

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(username, password);
    setLoading(false);
  };

  const handleGuestSubmit = async (e) => {
    e.preventDefault();
    setGuestLoading(true);
    setGuestError('');
    try {
      const body = guestToken ? { token: guestToken, lastName: guestName.trim(), password: guestPassword }
        : { room: guestRoom, lastName: guestName.trim(), password: guestPassword };

      const res = await fetch('/api/guest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setGuestError(data.error || 'Login failed');
        return;
      }
      // Store guest token and redirect (update API module token state)
      setTokens(data.accessToken, null);
      localStorage.setItem('guestRoom', data.room);
      localStorage.setItem('guestName', data.guestName);
      window.location.href = '/guest-portal';
    } catch (e) {
      setGuestError('Connection failed. Please try again.');
    } finally {
      setGuestLoading(false);
    }
  };

  const quickLogin = async (user) => {
    setLoading(true);
    await login(user, 'hilton2026');
    setLoading(false);
  };

  // ═══ GUEST LOGIN PAGE — no staff access buttons ═══
  if (isGuestMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Welcome, Guest</h1>
            <p className="text-white/50 text-sm mt-1">Hilton Grand Hotel · Room Control</p>
          </div>

          <div className="card p-8">
            <div className="text-center mb-4">
              <div className="text-sm font-semibold text-gray-700">Guest Room Access</div>
              <div className="text-xs text-gray-400 mt-1">Enter your name and password to control your room</div>
            </div>

            <form onSubmit={handleGuestSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Your Name</label>
                <input className="input" value={guestName} onChange={e => setGuestName(e.target.value)}
                  placeholder="Enter your name" autoFocus required />
                <div className="text-[9px] text-gray-400 mt-1">As provided during check-in (first name, last name, or full name)</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative">
                  <input className="input pr-10 text-lg tracking-widest" type={showPw ? 'text' : 'password'} value={guestPassword}
                    onChange={e => setGuestPassword(e.target.value)} placeholder="6-digit code" required
                    maxLength={6} inputMode="numeric" />
                  <button type="button" className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPw(!showPw)}>
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="text-[9px] text-gray-400 mt-1">Provided by the reception desk</div>
              </div>

              {guestError && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{guestError}</div>}

              <button type="submit" disabled={guestLoading}
                className="btn btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm">
                {guestLoading ? '⏳ Signing in...' : '🚪 Enter Room'}
              </button>
            </form>

            <div className="mt-4 text-center text-[10px] text-gray-400">
              Need help? Please contact the reception desk.
            </div>
          </div>

          <p className="text-center text-white/30 text-[10px] mt-6">
            Hilton Grand Hotel · IoT Smart Room
          </p>
        </div>
      </div>
    );
  }

  // ═══ STAFF LOGIN PAGE — with quick access (no guest can reach here via QR) ═══
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <Building2 className="w-8 h-8 text-gold-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Hilton Grand Hotel</h1>
          <p className="text-white/50 text-sm mt-1">IoT Management Platform v2.0</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleStaffSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Username</label>
              <input className="input" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Enter username" autoFocus required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input className="input pr-10" type={showPw ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="Enter password" required />
                <button type="button" className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading}
              className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2">
              <Shield size={16} />
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Quick access demo removed to prevent guest QR misuse */}
        </div>

        <p className="text-center text-white/30 text-[10px] mt-6">
          Secured with JWT · Encrypted · Rate-Limited
        </p>
      </div>
    </div>
  );
}
