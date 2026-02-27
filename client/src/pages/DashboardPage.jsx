import React, { useEffect, useRef, useState } from 'react';
import { Building2, LogOut, LayoutGrid, BookOpen, ScrollText, DollarSign, Users, Clock, FlaskConical } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';
import KPIRow from '../components/KPIRow';
import Heatmap from '../components/Heatmap';
import RoomTable from '../components/RoomTable';
import RoomModal from '../components/RoomModal';
import PMSPanel from '../components/PMSPanel';
import LogsPanel from '../components/LogsPanel';
import AlertToast from '../components/AlertToast';
import FinancePanel from '../components/FinancePanel';
import UsersPanel from '../components/UsersPanel';
import ShiftsPanel from '../components/ShiftsPanel';
import SimulatorPanel from '../components/SimulatorPanel';

// ── Audio alerts via Web Audio API ─────────────────────────────────────────
function beep(freq, duration, volume = 0.6) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}
function playSOS() { [0, 0.35, 0.7].forEach(t => setTimeout(() => beep(1100, 0.28, 0.9), t * 1000)); }
function playMUR() { [0, 0.4].forEach(t => setTimeout(() => beep(750, 0.35, 0.6), t * 1000)); }
// ───────────────────────────────────────────────────────────────────────────

const roleLabels = { owner: 'Owner — Full Access', admin: 'Operations', frontdesk: 'Front Desk' };

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const { startPolling, stopPolling, connectSSE, alerts, dismissAlert, todayCheckouts } = useHotelStore();
  const [tab, setTab] = useState('rooms');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [clock, setClock] = useState('');
  const seenAlerts = useRef(new Set());

  const role = user?.role;
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const [resettingAll, setResettingAll] = useState(false);

  const handleResetAll = async () => {
    if (!confirm('Reset ALL rooms to default? This will turn off all lights, AC, curtains and clear all service flags across every room.')) return;
    setResettingAll(true);
    try {
      const r = await api('/api/rooms/reset-all', { method: 'POST' });
      alert(`Reset started for ${r.total} rooms. Changes will appear on the dashboard as they apply.`);
    } catch (e) { alert('Reset failed: ' + e.message); }
    finally { setResettingAll(false); }
  };
  const isFrontdesk = role === 'frontdesk';
  const canSeeRooms = true;
  const canSeePMS = isOwner || isAdmin || isFrontdesk;
  const canSeeLogs = isOwner || isAdmin;
  const canSeeFinance = isOwner || isAdmin;
  const canSeeUsers = isOwner;
  const canSeeShifts = isOwner || isAdmin || isFrontdesk;

  const TABS = [
    { id: 'rooms',     label: 'Rooms',      icon: LayoutGrid,    visible: canSeeRooms },
    { id: 'pms',       label: 'PMS',        icon: BookOpen,      visible: canSeePMS,      badge: todayCheckouts?.length },
    { id: 'logs',      label: 'Logs',       icon: ScrollText,    visible: canSeeLogs },
    { id: 'finance',   label: 'Finance',    icon: DollarSign,    visible: canSeeFinance },
    { id: 'users',     label: 'Users',      icon: Users,         visible: canSeeUsers },
    { id: 'shifts',    label: 'Shifts',     icon: Clock,         visible: canSeeShifts },
    { id: 'simulator', label: 'Simulator',  icon: FlaskConical,  visible: isOwner || isAdmin },
  ].filter(t => t.visible);

  useEffect(() => {
    startPolling();
    connectSSE();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })), 1000);
    return () => { stopPolling(); clearInterval(t); };
  }, []);

  // Play audio when new SOS / MUR alerts arrive
  useEffect(() => {
    alerts.forEach(a => {
      if (seenAlerts.current.has(a.ts)) return;
      seenAlerts.current.add(a.ts);
      if (a.type === 'SOS') playSOS();
      else if (a.type === 'MUR') playMUR();
    });
  }, [alerts]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <header className="bg-brand-500 text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6 text-gold-400" />
            <div>
              <h1 className="font-bold text-sm tracking-tight">{user?.hotelName || 'iHotel'}</h1>
              <p className="text-[10px] text-white/50">iHotel Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/60">LIVE</span>
            </div>
            <span className="text-xs font-mono text-white/40">{clock}</span>
            <div className="text-right">
              <div className="text-xs font-semibold">{user?.fullName || user?.username}</div>
              <div className="text-[10px] text-white/50">{roleLabels[role] || role}</div>
            </div>
            <button onClick={logout} className="p-2 rounded-lg hover:bg-white/10 transition">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Checkout alert banner — frontdesk/admin */}
      {todayCheckouts?.length > 0 && (isFrontdesk || isAdmin) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="max-w-[1600px] mx-auto text-xs text-amber-700 font-semibold">
            🔔 {todayCheckouts.length} room{todayCheckouts.length > 1 ? 's' : ''} checking out today:
            {' '}{todayCheckouts.map(r => `Rm ${r.room}`).join(', ')}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition ${
                tab === t.id ? 'border-brand-500 text-brand-500' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              <t.icon size={14} />
              {t.label}
              {t.badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-400 text-white text-[8px] flex items-center justify-center font-bold">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-[1600px] mx-auto p-4 space-y-4">
        {tab === 'rooms' && (
          <>
            <KPIRow role={role} />
            {(isOwner || isAdmin) && (
              <div className="flex justify-end">
                <button onClick={handleResetAll} disabled={resettingAll}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition disabled:opacity-50">
                  {resettingAll ? '⏳ Resetting...' : '🔄 Reset All Rooms'}
                </button>
              </div>
            )}
            {!isFrontdesk && <Heatmap onSelectRoom={setSelectedRoom} />}
            <RoomTable onSelectRoom={setSelectedRoom} role={role} />
          </>
        )}
        {tab === 'pms'       && <PMSPanel />}
        {tab === 'logs'      && <LogsPanel />}
        {tab === 'finance'   && <FinancePanel />}
        {tab === 'users'     && <UsersPanel />}
        {tab === 'shifts'    && <ShiftsPanel />}
        {tab === 'simulator' && <SimulatorPanel />}
      </main>

      {/* Room Modal */}
      {selectedRoom && (
        <RoomModal roomId={selectedRoom} onClose={() => setSelectedRoom(null)} role={role} />
      )}

      {/* Alert Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {alerts.map((a, i) => (
          <AlertToast key={`${a.ts}-${i}`} alert={a} onDismiss={() => dismissAlert(i)} />
        ))}
      </div>
    </div>
  );
}
