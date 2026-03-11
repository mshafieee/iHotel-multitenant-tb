import React, { useEffect, useRef, useState } from 'react';
import { Building2, LogOut, LayoutGrid, BookOpen, ScrollText, DollarSign, Users, Clock, FlaskConical, Zap, Hotel } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useHotelStore from '../store/hotelStore';
import useLangStore from '../store/langStore';
import { t } from '../i18n';
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
import ScenesPanel from '../components/ScenesPanel';
import HotelInfoPanel from '../components/HotelInfoPanel';

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

export default function DashboardPage() {
  const { user, logout } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const T = (key) => t(key, lang);
  const roleLabels = { owner: T('role_owner'), admin: T('role_admin'), frontdesk: T('role_frontdesk') };
  const { startPolling, stopPolling, connectSSE, alerts, dismissAlert, todayCheckouts, commandAcks, dismissCommandAck } = useHotelStore();
  const rooms = useHotelStore(s => s.rooms);
  const [tab, setTab] = useState('rooms');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [clock, setClock] = useState('');
  const seenAlerts = useRef(new Set());

  const role = user?.role;
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const isFrontdesk = role === 'frontdesk';
  const [resettingAll, setResettingAll] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [showRoomSearch, setShowRoomSearch] = useState(false);
  const [pmsAutoFillRoom, setPmsAutoFillRoom] = useState(null);
  const roomSearchRef = useRef(null);
  const [heatmapCols, setHeatmapCols] = useState(() => {
    const saved = localStorage.getItem('heatmapCols');
    return saved ? Number(saved) : 0;
  });
  const updateHeatmapCols = (n) => {
    setHeatmapCols(n);
    if (n === 0) localStorage.removeItem('heatmapCols');
    else localStorage.setItem('heatmapCols', String(n));
  };

  const handleResetAll = async () => {
    if (!confirm('Reset ALL rooms to default? This will turn off all lights, AC, curtains and clear all service flags across every room.')) return;
    setResettingAll(true);
    try {
      const r = await api('/api/rooms/reset-all', { method: 'POST' });
      alert(`Reset started for ${r.total} rooms. Changes will appear on the dashboard as they apply.`);
    } catch (e) { alert('Reset failed: ' + e.message); }
    finally { setResettingAll(false); }
  };
  const canSeeRooms = true;
  const canSeePMS = isOwner || isAdmin || isFrontdesk;
  const canSeeLogs = isOwner || isAdmin;
  const canSeeFinance = isOwner;
  const canSeeUsers = isOwner;
  const canSeeShifts = isOwner || isAdmin || isFrontdesk;

  const TABS = [
    { id: 'rooms',     label: T('tab_rooms'),     icon: LayoutGrid,    visible: canSeeRooms },
    { id: 'pms',       label: T('tab_pms'),        icon: BookOpen,      visible: canSeePMS,      badge: todayCheckouts?.length },
    { id: 'logs',      label: T('tab_logs'),       icon: ScrollText,    visible: canSeeLogs },
    { id: 'finance',   label: T('tab_finance'),    icon: DollarSign,    visible: canSeeFinance },
    { id: 'users',     label: T('tab_users'),      icon: Users,         visible: canSeeUsers },
    { id: 'shifts',    label: T('tab_shifts'),     icon: Clock,         visible: canSeeShifts },
    { id: 'scenes',    label: T('tab_scenes'),     icon: Zap,           visible: isOwner || isAdmin },
    { id: 'hotelinfo', label: T('tab_hotelinfo'),  icon: Hotel,         visible: isOwner },
    { id: 'simulator', label: T('tab_simulator'),  icon: FlaskConical,  visible: isOwner || isAdmin },
  ].filter(tb => tb.visible);

  useEffect(() => {
    if (user?.hotelName) document.title = `${user.hotelName} — iHotel`;
  }, [user?.hotelName]);

  useEffect(() => {
    startPolling();
    connectSSE();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })), 1000);
    return () => { stopPolling(); clearInterval(t); };
  }, []);

  // Keyboard shortcut: any printable character opens room search overlay
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && /[\d]/.test(e.key)) {
        setShowRoomSearch(true);
        setRoomSearch('');   // keep empty — browser will type the key into the focused input once
        // no manual focus needed; autoFocus on the input handles it
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
            {user?.logoUrl
              ? <img src={user.logoUrl} alt="logo" className="h-10 w-10 rounded-lg object-contain bg-white/10 p-0.5" />
              : <Building2 className="w-6 h-6 text-gold-400" />}
            <div>
              <h1 className="font-bold text-xl tracking-tight leading-tight">{user?.hotelName}</h1>
              <p className="text-[11px] text-white/50">iHotel</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/60">{T('live')}</span>
            </div>
            <span className="text-xs font-mono text-white/40">{clock}</span>
            <div className="text-right">
              <div className="text-xs font-semibold">{user?.fullName || user?.username}</div>
              <div className="text-[10px] text-white/50">{roleLabels[role] || role}</div>
            </div>
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold transition">
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
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
            🔔 {todayCheckouts.length} {T('dash_checkouts_today')}
            {' '}{todayCheckouts.map(r => `${T('room_prefix')} ${r.room}`).join(', ')}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-[1600px] mx-auto overflow-x-auto scrollbar-none">
          <div className="flex gap-0 px-2 min-w-max">
            {TABS.map(tb => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                className={`relative flex items-center gap-1 px-3 sm:px-4 py-3 text-[11px] sm:text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  tab === tb.id ? 'border-brand-500 text-brand-500' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}>
                <tb.icon size={13} />
                {tb.label}
                {tb.badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-400 text-white text-[8px] flex items-center justify-center font-bold">
                    {tb.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-[1600px] mx-auto p-4 space-y-4">
        {tab === 'rooms' && (
          <>
            <KPIRow role={role} />
            {(isOwner || isAdmin || isFrontdesk) && (
              <div className="flex items-center justify-between">
                {/* Heatmap cols selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{T('dash_heatmap_cols')}</span>
                  {[0, 5, 8, 10, 12, 15, 20].map(n => (
                    <button key={n} onClick={() => updateHeatmapCols(n)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${heatmapCols === n ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {n === 0 ? T('auto') : n}
                    </button>
                  ))}
                </div>
                {(isOwner || isAdmin) && (
                <button onClick={handleResetAll} disabled={resettingAll}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition disabled:opacity-50">
                  {resettingAll ? T('dash_resetting') : T('dash_reset_all')}
                </button>
                )}
              </div>
            )}
            <Heatmap onSelectRoom={setSelectedRoom} cols={heatmapCols} />
            <RoomTable onSelectRoom={setSelectedRoom} role={role} />
          </>
        )}
        {tab === 'pms'       && <PMSPanel autoFillRoom={pmsAutoFillRoom} onAutoFillConsumed={() => setPmsAutoFillRoom(null)} />}
        {tab === 'logs'      && <LogsPanel />}
        {tab === 'finance'   && <FinancePanel />}
        {tab === 'users'     && <UsersPanel />}
        {tab === 'shifts'    && <ShiftsPanel />}
        {tab === 'scenes'    && <ScenesPanel />}
        {tab === 'hotelinfo' && <HotelInfoPanel />}
        {tab === 'simulator' && <SimulatorPanel />}
      </main>

      {/* Room Modal */}
      {selectedRoom && (
        <RoomModal roomId={selectedRoom} onClose={() => setSelectedRoom(null)} role={role}
          onReserveRoom={(roomNum) => {
            setPmsAutoFillRoom(roomNum);
            setTab('pms');
          }}
        />
      )}

      {/* Alert Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {alerts.map((a, i) => (
          <AlertToast key={`${a.ts}-${i}`} alert={a} onDismiss={() => dismissAlert(i)} />
        ))}
        {/* Command acknowledgement toasts */}
        {commandAcks.map(ack => (
          <div key={ack.ts}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold border cursor-pointer transition-all ${
              ack.success
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            onClick={() => dismissCommandAck(ack.ts)}>
            <span>{ack.success ? '✓' : '⚠'}</span>
            <span>{lang === 'ar' ? 'غرفة' : 'Rm'} {ack.room}</span>
            <span className="text-gray-400">·</span>
            <span>{ack.success ? (lang === 'ar' ? 'تم التنفيذ' : 'Confirmed') : (lang === 'ar' ? 'لم يتم التأكيد' : 'Unconfirmed')}</span>
          </div>
        ))}
      </div>

      {/* Keyboard Room Search Overlay */}
      {showRoomSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => { setShowRoomSearch(false); setRoomSearch(''); }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">
              {T('dash_room_search')}
            </div>
            <input
              ref={roomSearchRef}
              className="input text-2xl font-bold font-mono text-center tracking-widest"
              value={roomSearch}
              onChange={e => setRoomSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = roomSearch.trim();
                  if (val && rooms[val]) {
                    setSelectedRoom(val);
                    setShowRoomSearch(false);
                    setRoomSearch('');
                  }
                } else if (e.key === 'Escape') {
                  setShowRoomSearch(false);
                  setRoomSearch('');
                }
              }}
              placeholder="301"
              autoFocus
              inputMode="numeric"
            />
            {roomSearch && !rooms[roomSearch.trim()] && (
              <p className="text-xs text-red-400 mt-2 text-center">
                {lang === 'ar' ? 'الغرفة غير موجودة' : 'Room not found'}
              </p>
            )}
            {roomSearch && rooms[roomSearch.trim()] && (
              <button
                onClick={() => { setSelectedRoom(roomSearch.trim()); setShowRoomSearch(false); setRoomSearch(''); }}
                className="btn btn-primary w-full mt-3">
                {lang === 'ar' ? `فتح غرفة ${roomSearch}` : `Open Room ${roomSearch}`}
              </button>
            )}
            <p className="text-[9px] text-gray-300 text-center mt-2">
              {lang === 'ar' ? 'Enter للفتح · Esc للإغلاق' : 'Enter to open · Esc to close'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
