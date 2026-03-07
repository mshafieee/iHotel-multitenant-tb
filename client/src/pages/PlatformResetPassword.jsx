import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { LayoutDashboard, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';

export default function PlatformResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPw, setShowPw]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center space-y-4">
          <XCircle size={40} className="text-red-400 mx-auto" />
          <p className="text-sm font-semibold text-gray-800">Invalid reset link</p>
          <p className="text-xs text-gray-400">No token found in URL. Request a new password reset from the login page.</p>
          <Link to="/platform/login" className="text-xs text-brand-500 underline underline-offset-2">Back to login</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/public/reset-password/platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Reset failed. The link may have expired.');
      } else {
        setDone(true);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-[340px]">

        {/* Brand */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="p-2 bg-slate-800 rounded-xl">
            <LayoutDashboard size={18} className="text-white" />
          </div>
          <span className="font-bold text-gray-800 text-lg">iHotel Platform</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7">
          {done ? (
            <div className="text-center space-y-3 py-2">
              <CheckCircle size={40} className="text-emerald-500 mx-auto" />
              <p className="text-sm font-semibold text-gray-800">Password updated</p>
              <p className="text-xs text-gray-500">Your super admin password has been changed successfully.</p>
              <button
                onClick={() => navigate('/platform/login')}
                className="btn btn-primary w-full py-2.5 mt-2"
              >
                Sign In
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900">Reset password</h2>
                <p className="text-xs text-gray-400 mt-1">Enter a new password for the super admin account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      className="input pr-10"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-2.5 text-gray-300 hover:text-gray-500"
                      onClick={() => setShowPw(!showPw)}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Confirm password
                  </label>
                  <input
                    className="input"
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat new password"
                    required
                  />
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2"
                >
                  {loading ? 'Saving…' : 'Set New Password'}
                </button>

                <div className="text-center">
                  <Link to="/platform/login" className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">
                    Back to login
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
