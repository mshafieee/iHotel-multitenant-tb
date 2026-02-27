import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LayoutDashboard, Eye, EyeOff } from 'lucide-react';
import usePlatformStore from '../store/platformStore';

export default function PlatformLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, error } = usePlatformStore();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (ok) navigate('/platform');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <LayoutDashboard className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">iHotel Platform</h1>
          <p className="text-white/50 text-sm mt-1">Super Admin Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <input className="input" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Platform admin username" autoFocus required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <input className="input pr-10" type={showPw ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="Enter password" required />
                <button type="button" className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2">
              <LayoutDashboard size={16} />
              {loading ? 'Signing in...' : 'Sign In to Platform'}
            </button>
          </form>
        </div>

        <div className="mt-4 text-center text-[11px] text-white/40">
          Hotel staff?{' '}
          <Link to="/login" className="text-white/70 hover:text-white underline underline-offset-2">
            Go to hotel login
          </Link>
        </div>
      </div>
    </div>
  );
}
