import { useState, useEffect } from 'react';
import { Building2, Shield, Eye, EyeOff } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { setTokens } from '../utils/api';

export default function LoginPage() {
  const [hotelSlug, setHotelSlug] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, error } = useAuthStore();
  const [searchParams] = useSearchParams();

  // Detect guest mode from URL: /guest?room=101&hotel=jory1  or /guest?token=xxx
  const guestToken = searchParams.get('token');
  const guestRoom  = searchParams.get('room');
  const guestHotel = searchParams.get('hotel');
  const isGuestMode = !!guestToken || !!guestRoom;

  // Guest login fields
  const [guestName, setGuestName] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState('');
  const [hotelDisplayName, setHotelDisplayName] = useState('');
  const [hotelNotFound, setHotelNotFound] = useState(false);

  // Fetch hotel display name from the slug in the URL
  useEffect(() => {
    if (!isGuestMode) return;
    if (guestHotel) {
      fetch(`/api/public/hotel?slug=${encodeURIComponent(guestHotel)}`)
        .then(r => r.json())
        .then(d => { if (d.name) setHotelDisplayName(d.name); else setHotelNotFound(true); })
        .catch(() => setHotelNotFound(true));
    } else if (!guestToken) {
      // No hotel slug and no token — link is broken
      setHotelNotFound(true);
    }
  }, [isGuestMode, guestHotel, guestToken]);

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(hotelSlug.trim(), username, password);
    setLoading(false);
  };

  const handleGuestSubmit = async (e) => {
    e.preventDefault();
    setGuestLoading(true);
    setGuestError('');
    try {
      const body = guestToken
        ? { token: guestToken, lastName: guestName.trim(), password: guestPassword }
        : { room: guestRoom, hotelSlug: guestHotel, lastName: guestName.trim(), password: guestPassword };

      const res  = await fetch('/api/guest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setGuestError(data.error || 'Login failed');
        return;
      }
      setTokens(data.accessToken, null);
      localStorage.setItem('guestRoom', data.room);
      localStorage.setItem('guestName', data.guestName);
      window.location.href = '/guest-portal';
    } catch {
      setGuestError('Connection failed. Please try again.');
    } finally {
      setGuestLoading(false);
    }
  };

  // ═══ GUEST LOGIN PAGE ═══
  if (isGuestMode) {
    // Invalid / incomplete link
    if (hotelNotFound) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-4">
          <div className="w-full max-w-md text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-6">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Link Not Recognised</h1>
            <p className="text-white/70 text-sm leading-relaxed mb-6">
              This guest access link appears to be incomplete or may have expired.<br />
              Please ask the reception desk for a new QR code or link.
            </p>
            <div className="bg-white/10 backdrop-blur rounded-xl px-6 py-4">
              <p className="text-white/60 text-xs">Reception — Dial 0 from your room phone</p>
            </div>
            <p className="text-white/30 text-[10px] mt-6">iHotel · Smart Room Platform</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            {hotelDisplayName ? (
              <>
                <h1 className="text-2xl font-bold text-white tracking-tight">{hotelDisplayName}</h1>
                <p className="text-white/50 text-sm mt-1">iHotel · Guest Portal</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white tracking-tight">Welcome, Guest</h1>
                <p className="text-white/50 text-sm mt-1">iHotel · Smart Room Control</p>
              </>
            )}
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
                <div className="text-[9px] text-gray-400 mt-1">As provided during check-in</div>
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
                {guestLoading ? 'Signing in...' : 'Enter Room'}
              </button>
            </form>

            <div className="mt-4 text-center text-[10px] text-gray-400">
              Need help? Please contact the reception desk.
            </div>
          </div>

          <p className="text-center text-white/30 text-[10px] mt-6">
            iHotel · Smart Room Platform
          </p>
        </div>
      </div>
    );
  }

  // ═══ STAFF LOGIN PAGE ═══
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <Building2 className="w-8 h-8 text-gold-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">iHotel Platform</h1>
          <p className="text-white/50 text-sm mt-1">Hotel Staff Portal</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleStaffSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Hotel Code</label>
              <input className="input" value={hotelSlug} onChange={e => setHotelSlug(e.target.value)}
                placeholder="e.g. hilton-grand" autoFocus required />
              <p className="text-[10px] text-gray-400 mt-1">Provided by your hotel administrator</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Username</label>
              <input className="input" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Enter username" required />
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
        </div>

        <div className="mt-4 text-center text-[11px] text-white/40">
          Platform administrator?{' '}
          <Link to="/platform/login" className="text-white/70 hover:text-white underline underline-offset-2">
            Sign in here
          </Link>
        </div>

        <p className="text-center text-white/30 text-[10px] mt-4">
          iHotel SaaS · Secured with JWT · Rate-Limited
        </p>
      </div>
    </div>
  );
}
