import React, { useEffect, useRef, useState } from 'react';
import { Building2, LogOut, LayoutGrid, BookOpen, ScrollText, Bell } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useHotelStore from '../store/hotelStore';
import KPIRow from '../components/KPIRow';
import Heatmap from '../components/Heatmap';
import RoomTable from '../components/RoomTable';
import RoomModal from '../components/RoomModal';
import PMSPanel from '../components/PMSPanel';
import LogsPanel from '../components/LogsPanel';
import AlertToast from '../components/AlertToast';

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
function playSOS() {
  // Three urgent high-pitched pulses
  [0, 0.35, 0.7].forEach(t => setTimeout(() => beep(1100, 0.28, 0.9), t * 1000));
}
function playMUR() {
  // Two medium-pitched chimes
  [0, 0.4].forEach(t => setTimeout(() => beep(750, 0.35, 0.6), t * 1000));
}
// ───────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: LayoutGrid },
  { id: 'pms', label: 'PMS', icon: BookOpen },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const { startPolling, stopPolling, connectSSE, alerts, dismissAlert } = useHotelStore();
  const [tab, setTab] = useState('rooms');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [clock, setClock] = useState('');
  const seenAlerts = useRef(new Set());

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

  const roleLabels = { owner: 'Owner — Full Access', admin: 'Operations', user: 'Front Desk' };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <header className="bg-brand-500 text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6 text-gold-400" />
            <div>
              <h1 className="font-bold text-sm tracking-tight">Hilton Grand Hotel</h1>
              <p className="text-[10px] text-white/50">IoT Platform v2.0</p>
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
              <div className="text-[10px] text-white/50">{roleLabels[user?.role] || user?.role}</div>
            </div>
            <button onClick={logout} className="p-2 rounded-lg hover:bg-white/10 transition">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 flex gap-1">
          {TABS.filter(t => t.id !== 'logs' || user?.role !== 'user').map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition ${
                tab === t.id ? 'border-brand-500 text-brand-500' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-[1600px] mx-auto p-4 space-y-4">
        {tab === 'rooms' && (
          <>
            <KPIRow role={user?.role} />
            {user?.role !== 'user' && <Heatmap onSelectRoom={setSelectedRoom} />}
            <RoomTable onSelectRoom={setSelectedRoom} role={user?.role} />
          </>
        )}
        {tab === 'pms' && <PMSPanel />}
        {tab === 'logs' && <LogsPanel />}
      </main>

      {/* Room Modal */}
      {selectedRoom && (
        <RoomModal roomId={selectedRoom} onClose={() => setSelectedRoom(null)} role={user?.role} />
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
