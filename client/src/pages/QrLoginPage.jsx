/**
 * QrLoginPage — Auto-login via QR code token
 * Route: /qr?t=<token>
 * Calls POST /api/auth/qr-login and redirects to the dashboard.
 */
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { setTokens } from '../utils/api';
import useAuthStore from '../store/authStore';

export default function QrLoginPage() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const { checkAuth }  = useAuthStore();
  const [status, setStatus] = useState('loading'); // 'loading' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = searchParams.get('t');
    if (!token) { setStatus('error'); setErrorMsg('No QR token in URL.'); return; }

    fetch('/api/auth/qr-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Login failed');
        return data;
      })
      .then(async data => {
        setTokens(data.accessToken, data.refreshToken);
        await checkAuth();
        navigate('/', { replace: true });
      })
      .catch(e => { setStatus('error'); setErrorMsg(e.message); });
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/70 text-sm">Signing you in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
          <Building2 className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">QR Login Failed</h2>
        <p className="text-white/60 text-sm mb-6">{errorMsg}</p>
        <a href="/" className="text-white/80 underline text-sm hover:text-white">
          Go to login page
        </a>
      </div>
    </div>
  );
}
