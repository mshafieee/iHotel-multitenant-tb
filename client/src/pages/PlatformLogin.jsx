import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, Eye, EyeOff, Building2, Wifi, Shield,
  Zap, BarChart3, Smartphone, BedDouble, Thermometer,
  Lightbulb, Lock, Users, Activity, ChevronRight
} from 'lucide-react';
import usePlatformStore from '../store/platformStore';

// ── Mock room heatmap data ─────────────────────────────────────────────────────
const ROOMS = [
  1,1,0,4,1,0, 0,1,2,1,0,1,
  3,1,1,0,1,4, 1,0,1,1,2,0,
  1,4,0,1,1,0, 0,1,1,2,0,1,
];
// 0=vacant 1=occupied 2=service 3=maintenance 4=not-occ
const ROOM_CLR = [
  'bg-white/20',
  'bg-blue-400',
  'bg-amber-400',
  'bg-red-400',
  'bg-slate-500/50',
];
const ROOM_LBL = ['Vacant','Occupied','Service','Maintenance','Not Occupied'];

// ── Inline dashboard preview ───────────────────────────────────────────────────
function DashboardMockup() {
  return (
    <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 text-[11px]">
      {/* Browser chrome */}
      <div className="bg-slate-950 px-3 py-2 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
        </div>
        <div className="flex-1 mx-3">
          <div className="bg-white/10 rounded px-3 py-0.5 text-white/30 text-[9px] font-mono text-center truncate">
            app.ihotel.io — Hilton Grand Hotel
          </div>
        </div>
      </div>

      {/* App header */}
      <div className="bg-slate-800 px-4 py-2 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/10 rounded"><LayoutDashboard size={10} className="text-white" /></div>
          <span className="text-white font-bold text-[10px]">Hilton Grand</span>
          <span className="text-white/30 text-[9px]">iHotel</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/40 text-[9px]">24 rooms live</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="bg-slate-800/80 px-3 py-2 grid grid-cols-4 gap-2">
        {[
          { l: 'Occupied', v: '18', c: 'text-blue-300' },
          { l: 'Vacant',   v: '8',  c: 'text-white/50' },
          { l: 'Service',  v: '4',  c: 'text-amber-300' },
          { l: 'Revenue',  v: '94K SAR', c: 'text-emerald-300' },
        ].map(k => (
          <div key={k.l} className="bg-white/5 rounded px-2 py-1.5 text-center">
            <p className={`font-bold ${k.c} text-[11px]`}>{k.v}</p>
            <p className="text-white/30 text-[8px] uppercase tracking-wide">{k.l}</p>
          </div>
        ))}
      </div>

      {/* Room heatmap */}
      <div className="bg-slate-900 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-white/30 text-[9px] uppercase tracking-wider">Room Status</span>
          <div className="flex-1 h-px bg-white/5" />
          <span className="text-white/20 text-[8px]">Floor 1–3</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {ROOMS.map((s, i) => (
            <div key={i}
              className={`w-[18px] h-[18px] rounded-[3px] ${ROOM_CLR[s]} transition-all`}
              title={`Room ${101 + i}: ${ROOM_LBL[s]}`}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-3 mt-2">
          {[['bg-blue-400','Occupied'],['bg-amber-400','Service'],['bg-red-400','Maint.'],['bg-white/20','Vacant']].map(([c,l]) => (
            <div key={l} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-sm ${c}`} />
              <span className="text-white/30 text-[8px]">{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity log strip */}
      <div className="bg-slate-900 border-t border-white/5 px-3 py-2 space-y-1">
        {[
          { room: '214', msg: 'AC set → 22°C', color: 'text-blue-300' },
          { room: '301', msg: 'Guest checked in', color: 'text-green-300' },
          { room: '108', msg: 'DND activated', color: 'text-amber-300' },
        ].map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
            <span className={`font-semibold ${e.color}`}>Rm {e.room}</span>
            <span className="text-white/30 truncate">{e.msg}</span>
            <span className="text-white/15 ml-auto shrink-0">{i + 1}m ago</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Room control card floating over dashboard ─────────────────────────────────
function RoomControlCard() {
  return (
    <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-4 w-48">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-gray-800">Room 214</p>
          <p className="text-[9px] text-gray-400">Suite · Floor 2</p>
        </div>
        <span className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">Occupied</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-gray-500">
            <Thermometer size={11} />
            <span className="text-[10px]">AC</span>
          </div>
          <span className="text-[10px] font-bold text-gray-700">22°C · COOL</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-gray-500">
            <Lightbulb size={11} />
            <span className="text-[10px]">Lights</span>
          </div>
          <div className="flex gap-0.5">
            <div className="w-3 h-3 rounded-sm bg-amber-400" />
            <div className="w-3 h-3 rounded-sm bg-amber-400" />
            <div className="w-3 h-3 rounded-sm bg-gray-200" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-gray-500">
            <Lock size={11} />
            <span className="text-[10px]">Door</span>
          </div>
          <span className="text-[10px] font-semibold text-green-600">Locked</span>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-gray-100 grid grid-cols-2 gap-1">
        <div className="text-center bg-gray-50 rounded py-1">
          <p className="text-[8px] text-gray-400">CO₂</p>
          <p className="text-[10px] font-bold text-gray-700">612 ppm</p>
        </div>
        <div className="text-center bg-gray-50 rounded py-1">
          <p className="text-[8px] text-gray-400">Humidity</p>
          <p className="text-[10px] font-bold text-gray-700">51%</p>
        </div>
      </div>
    </div>
  );
}

// ── Feature item ──────────────────────────────────────────────────────────────
function Feature({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-white/10 shrink-0 mt-0.5">
        <Icon size={14} className="text-white/80" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white leading-tight">{title}</p>
        <p className="text-[11px] text-white/45 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PlatformLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login, error } = usePlatformStore();
  const navigate = useNavigate();

  const handleForgot = async () => {
    setForgotLoading(true);
    try {
      await fetch('/api/public/forgot-password/platform', { method: 'POST' });
    } catch {}
    setForgotLoading(false);
    setForgotSent(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (ok) navigate('/platform');
  };

  return (
    <div className="min-h-screen flex">

      {/* ════════════════════════════════════════════════════════
          LEFT — Marketing panel
      ════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex lg:w-[62%] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex-col p-10 relative overflow-hidden">

        {/* Ambient blobs */}
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-indigo-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-slate-700/20 rounded-full blur-3xl pointer-events-none" />

        {/* Brand */}
        <div className="relative flex items-center gap-3 mb-10">
          <div className="p-2.5 bg-white/10 rounded-xl">
            <LayoutDashboard size={20} className="text-white" />
          </div>
          <div>
            <span className="font-bold text-white text-lg tracking-tight">iHotel</span>
            <span className="ml-2 text-[10px] font-semibold text-white/30 uppercase tracking-widest bg-white/10 px-2 py-0.5 rounded-full">Platform</span>
          </div>
        </div>

        {/* Headline */}
        <div className="relative mb-8">
          <h1 className="text-[2rem] font-bold text-white leading-tight mb-3">
            Smart Hotel IoT<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-indigo-300">
              Management Platform
            </span>
          </h1>
          <p className="text-white/45 text-sm leading-relaxed max-w-md">
            One platform to onboard hotels, manage IoT rooms in real-time, control
            reservations, and track revenue — across multiple properties.
          </p>
        </div>

        {/* Dashboard preview + floating room card */}
        <div className="relative mb-8">
          <DashboardMockup />
          {/* Floating room control card */}
          <div className="absolute -right-4 -bottom-6 shadow-2xl">
            <RoomControlCard />
          </div>
        </div>

        {/* Feature grid */}
        <div className="relative grid grid-cols-2 gap-x-6 gap-y-4 mb-8">
          <Feature icon={Wifi}        title="Real-time IoT Control"   desc="Live telemetry: AC, lights, curtains, door, CO₂, humidity." />
          <Feature icon={BedDouble}   title="PMS & Guest Portal"      desc="Reservations, QR check-in, and in-room guest controls." />
          <Feature icon={BarChart3}   title="Revenue & Shifts"        desc="Income tracking, shift reconciliation, room-type rates." />
          <Feature icon={Shield}      title="Multi-tenant Secure"     desc="Isolated per hotel, JWT auth, bcrypt, rate limiting." />
          <Feature icon={Smartphone}  title="Heatmap & Monitoring"    desc="Visual floor-by-floor room status with live SSE updates." />
          <Feature icon={Zap}         title="Instant Room Automation" desc="Auto-cleanup on checkout, motion-triggered NOT_OCCUPIED." />
        </div>

      </div>

      {/* ════════════════════════════════════════════════════════
          RIGHT — Login panel
      ════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col justify-center items-center bg-gray-50 p-8">

        {/* Mobile-only brand */}
        <div className="lg:hidden mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="p-2 bg-slate-800 rounded-xl">
              <LayoutDashboard size={18} className="text-white" />
            </div>
            <span className="font-bold text-gray-800 text-lg">iHotel Platform</span>
          </div>
          <p className="text-sm text-gray-400">Smart Hotel Management</p>
        </div>

        <div className="w-full max-w-[340px]">

          {/* Heading */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-sm text-gray-400 mt-1">Super Admin Portal</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7">
            {forgotSent ? (
              <div className="text-center py-4 space-y-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                  <ChevronRight size={20} className="text-emerald-600" />
                </div>
                <p className="text-sm font-semibold text-gray-800">Check your email</p>
                <p className="text-xs text-gray-500">A password reset link has been sent to the super admin email address. The link expires in 30 minutes.</p>
                <button onClick={() => { setForgotSent(false); setForgotMode(false); }}
                  className="text-xs text-brand-500 underline underline-offset-2">Back to login</button>
              </div>
            ) : forgotMode ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 leading-relaxed">
                  A reset link will be sent to the super admin email address on file. Check your inbox after requesting.
                </p>
                <button onClick={handleForgot} disabled={forgotLoading}
                  className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2">
                  {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
                <button onClick={() => setForgotMode(false)}
                  className="w-full text-center text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">
                  Back to login
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  className="input"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="superadmin"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password"
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

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1"
              >
                <LayoutDashboard size={15} />
                {loading ? 'Signing in…' : 'Sign In to Platform'}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setForgotMode(true)}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                >
                  Forgot password?
                </button>
              </div>
            </form>
            )}
          </div>

          {/* What you can do */}
          <div className="mt-5 bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Platform admin can</p>
            {[
              'Onboard and configure hotel tenants',
              'Manage staff accounts and roles',
              'Connect ThingsBoard IoT instances',
              'View cross-hotel metrics and revenue',
            ].map(item => (
              <div key={item} className="flex items-center gap-2 text-xs text-gray-500">
                <ChevronRight size={11} className="text-brand-500 shrink-0" />
                {item}
              </div>
            ))}
          </div>

          {/* Hotel staff link */}
          <div className="mt-5 text-center text-[11px] text-gray-400">
            Hotel staff?{' '}
            <Link to="/login" className="text-gray-600 hover:text-gray-800 underline underline-offset-2 font-medium">
              Go to hotel login
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}
