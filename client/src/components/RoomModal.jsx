import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Zap, Play, BookOpen, Monitor, Moon, DoorOpen, LockKeyhole } from 'lucide-react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

const AC_MODES = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS = ['LOW', 'MED', 'HIGH', 'AUTO'];
const STATUSES = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const SCOL = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];
const MODE_COLORS = ['#6B7280', '#2563EB', '#DC2626', '#06B6D4', '#16A34A'];

// ── Smart Bulb Component ──────────────────────────────────────────────────────
function SmartBulb({ on, dimmer, label, onClick, onDimmerChange }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center p-3 rounded-2xl border-2 transition-all w-full ${
        on
          ? 'bg-amber-50 border-amber-300 shadow-lg shadow-amber-100'
          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* Bulb SVG */}
      <svg width="52" height="68" viewBox="0 0 52 68" fill="none" className="mb-1">
        {on && <ellipse cx="26" cy="24" rx="24" ry="24" fill="#FEF9C3" opacity="0.55" />}
        {/* Glass dome */}
        <path
          d="M10 26 C10 15 17 6 26 6 C35 6 42 15 42 26 C42 34 37 40 34 44 L18 44 C15 40 10 34 10 26Z"
          fill={on ? '#FCD34D' : '#E5E7EB'}
          stroke={on ? '#F59E0B' : '#D1D5DB'}
          strokeWidth="1.5"
        />
        {/* Filament */}
        {on && (
          <path d="M21 34 L26 22 L31 34" stroke="#EA580C" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        )}
        {/* Collar */}
        <rect x="19" y="44" width="14" height="4" rx="1.5" fill={on ? '#D97706' : '#9CA3AF'} />
        <rect x="20" y="48" width="12" height="4" rx="1.5" fill={on ? '#D97706' : '#9CA3AF'} />
        <rect x="21" y="52" width="10" height="4" rx="2" fill={on ? '#D97706' : '#9CA3AF'} />
        {/* Rays when on */}
        {on && (
          <g stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" opacity="0.75">
            <line x1="26" y1="1" x2="26" y2="4" />
            <line x1="7" y1="8" x2="9.5" y2="10.5" />
            <line x1="1" y1="24" x2="4" y2="24" />
            <line x1="45" y1="8" x2="42.5" y2="10.5" />
            <line x1="51" y1="24" x2="48" y2="24" />
          </g>
        )}
      </svg>
      <div className={`text-[10px] font-bold mt-0.5 ${on ? 'text-amber-700' : 'text-gray-400'}`}>{label}</div>
      {/* Dimmer mini-slider — only shown when on */}
      {on && dimmer !== undefined && (
        <div className="w-full mt-2 px-1" onClick={e => e.stopPropagation()}>
          <input
            type="range" min="0" max="100" value={dimmer}
            onChange={e => { e.stopPropagation(); onDimmerChange(+e.target.value); }}
            className="w-full accent-amber-400 h-1"
          />
          <div className="text-[9px] text-amber-500 text-center mt-0.5">{dimmer}%</div>
        </div>
      )}
    </button>
  );
}

export default function RoomModal({ roomId, onClose, role, onLockout, logoUrl }) {
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const STATUS_LABELS = [T('status_vacant'), T('status_occupied'), T('status_service'), T('status_maintenance'), T('status_not_occupied')];
  const rooms = useHotelStore(s => s.rooms);
  const rpc = useHotelStore(s => s.rpc);
  const checkout = useHotelStore(s => s.checkout);
  const [checkingOut, setCheckingOut] = useState(false);
  const [doorCountdown, setDoorCountdown] = useState(0);
  const [sleepFireAt, setSleepFireAt] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const applyingPresetRef  = useRef(false);
  const activePresetRef    = useRef(null);
  const prevDoorStatusRef  = useRef(undefined);

  const r = rooms[roomId];
  if (!r) return null;

  const can = role === 'owner' || role === 'admin';
  const isStaff = can || role === 'frontdesk';
  const isGuest = role === 'guest';
  const statusIdx = Math.min(r.roomStatus ?? 0, STATUSES.length - 1);
  const sc = SCOL[statusIdx] ?? SCOL[0];

  const send = useCallback((method, params) => {
    if (!applyingPresetRef.current && activePresetRef.current) {
      const prev = activePresetRef.current;
      activePresetRef.current = null;
      setActivePreset(null);
      setSleepFireAt(null);
      if (prev === 'sleep') {
        const timerUrl = role === 'guest' ? '/api/guest/sleep-timer' : `/api/rooms/${roomId}/sleep-timer`;
        api(timerUrl, { method: 'DELETE' }).catch(() => {});
      }
    }
    if (role === 'guest') {
      useHotelStore.setState(s => {
        const prev = s.rooms[roomId];
        if (!prev) return s;
        const updated = { ...prev };
        if (method === 'setAC') Object.assign(updated, params);
        else if (method === 'setLines') Object.assign(updated, params);
        else if (method === 'setCurtainsBlinds') Object.assign(updated, params);
        else if (method === 'setService') Object.assign(updated, params);
        else if (method === 'resetServices') (params.services || []).forEach(k => { updated[k] = false; });
        return { rooms: { ...s.rooms, [roomId]: updated } };
      });
      return api('/api/guest/rpc', { method: 'POST', body: JSON.stringify({ method, params }) })
        .catch(e => {
          if (e.message === 'session_expired' && onLockout) onLockout();
          else if (e.message === 'room_pd') {
            useHotelStore.setState(s => ({
              rooms: { ...s.rooms, [roomId]: { ...s.rooms[roomId], pdMode: true } }
            }));
          }
          throw e;
        });
    }
    return rpc(roomId, method, params);
  }, [roomId, rpc, role, onLockout]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const current = r?.doorStatus;
    if (current !== prevDoorStatusRef.current) {
      prevDoorStatusRef.current = current;
      if (activePresetRef.current) {
        const prev = activePresetRef.current;
        activePresetRef.current = null;
        setActivePreset(null);
        setSleepFireAt(null);
        if (prev === 'sleep') {
          const timerUrl = role === 'guest' ? '/api/guest/sleep-timer' : `/api/rooms/${roomId}/sleep-timer`;
          api(timerUrl, { method: 'DELETE' }).catch(() => {});
        }
      }
    }
  }, [r?.doorStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const adjTemp = (delta) => {
    const current = Math.round((r.acTemperatureSet ?? 22) * 2) / 2;
    const temp = Math.max(16, Math.min(30, current + delta));
    send('setAC', { acTemperatureSet: temp });
  };

  const handleDoorUnlock = () => {
    if (doorCountdown > 0) return;
    send('setDoorUnlock', {});
    let count = 5;
    setDoorCountdown(count);
    const iv = setInterval(() => {
      count--;
      setDoorCountdown(count);
      if (count <= 0) {
        clearInterval(iv);
        const doorOpen = useHotelStore.getState().rooms[roomId]?.doorStatus;
        if (!doorOpen) send('setDoorLock', {});
      }
    }, 1000);
  };

  const handleReset = async () => {
    if (!confirm(`Reset Room ${r.room} to default? All lights off, AC off, curtains closed, status → VACANT.`)) return;
    try { await api(`/api/rooms/${r.room}/reset`, { method: 'POST' }); }
    catch (e) { console.error('Reset failed:', e.message); }
  };

  // Checkout for any "active" state room (task 13/14)
  const canCheckout = isStaff && (
    r.roomStatus === 1 || r.roomStatus === 4 ||
    r.murService || r.sosService || r.dndService || r.pdMode
  );

  const handleCheckout = async () => {
    if (!confirm(`Check out Room ${r.room}? This will cancel any reservations and set status to SERVICE.`)) return;
    setCheckingOut(true);
    try { await checkout(r.room); onClose(); }
    catch (e) { console.error('Checkout failed:', e.message); }
    finally { setCheckingOut(false); }
  };

  const cancelSleepTimer = () => {
    const timerUrl = role === 'guest' ? '/api/guest/sleep-timer' : `/api/rooms/${r.room}/sleep-timer`;
    api(timerUrl, { method: 'DELETE' }).catch(() => {});
  };

  const handlePreset = async (mode) => {
    if (activePreset === mode) {
      activePresetRef.current = null;
      setActivePreset(null);
      setSleepFireAt(null);
      if (mode === 'sleep') cancelSleepTimer();
      return;
    }
    if (activePresetRef.current === 'sleep') { cancelSleepTimer(); setSleepFireAt(null); }

    activePresetRef.current = mode;
    setActivePreset(mode);
    applyingPresetRef.current = true;

    if (mode === 'reading') {
      // Turn on bedside light (line2) + dim the ambient dimmer
      send('setLines', { line1: false, line2: true, line3: false, dimmer1: 0, dimmer2: 80 });
    } else if (mode === 'tv') {
      send('setLines', { line1: false, line2: false, line3: false, dimmer1: 10, dimmer2: 10 });
      send('setCurtainsBlinds', { curtainsPosition: 0 });
    } else if (mode === 'sleep') {
      send('setLines', { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 });
      send('setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 });
      send('setAC', { acMode: 1, acTemperatureSet: 23 });
      try {
        const timerUrl = role === 'guest' ? '/api/guest/sleep-timer' : `/api/rooms/${r.room}/sleep-timer`;
        const result = await api(timerUrl, { method: 'POST' });
        if (result.fireAt) {
          setSleepFireAt(new Date(result.fireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          setTimeout(() => {
            if (activePresetRef.current === 'sleep') {
              activePresetRef.current = null;
              setActivePreset(null);
              setSleepFireAt(null);
            }
          }, 2 * 60 * 60 * 1000);
        }
      } catch {}
    }

    applyingPresetRef.current = false;
  };

  const togglePD = () => {
    const newPD = !r.pdMode;
    if (newPD && !confirm(`Activate Power Down for Room ${r.room}? All power will be cut.`)) return;
    rpc(roomId, 'setPDMode', { pdMode: newPD });
  };

  // ── Section components ────────────────────────────────────────────────────
  const sensorSection = !isGuest && (
    <Section title={T('rm_sensors')}>
      <div className="grid grid-cols-4 gap-3 text-center">
        <Stat label={T('rm_temp')} value={r.temperature != null ? `${r.temperature}°` : '—'} color={(r.temperature || 22) > 28 ? 'text-red-500' : 'text-emerald-500'} />
        <Stat label={T('rm_humid')} value={r.humidity != null ? `${r.humidity}%` : '—'} color="text-blue-500" />
        <Stat label="CO₂" value={r.co2 ?? '—'} color={(r.co2 || 400) > 1000 ? 'text-red-500' : 'text-emerald-500'} />
        <Stat label="PIR" value={r.pirMotionStatus ? T('rm_pir_detected') : T('rm_pir_clear')} color={r.pirMotionStatus ? 'text-blue-500' : 'text-gray-300'} />
      </div>
    </Section>
  );

  const doorSection = (can || isGuest) && (
    <Section title={T('rm_door')}>
      {!isGuest && (
        <div className="flex gap-4 mb-3">
          <div className="flex-1 text-center">
            <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">{T('rm_contact')}</div>
            <div className={`text-sm font-bold ${r.doorStatus ? 'text-amber-500' : 'text-emerald-500'}`}>
              {r.doorStatus ? T('rm_opened') : T('rm_closed')}
            </div>
            {r.doorContactsBattery != null && <div className="text-[9px] text-gray-300">🔋{r.doorContactsBattery}%</div>}
          </div>
          <div className="flex-1 text-center">
            <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">{T('rm_lock')}</div>
            <div className={`text-sm font-bold ${r.doorUnlock ? 'text-amber-500' : 'text-emerald-500'}`}>
              {r.doorUnlock ? T('rm_unlocked') : T('rm_locked')}
            </div>
            {r.doorLockBattery != null && <div className="text-[9px] text-gray-300">🔋{r.doorLockBattery}%</div>}
          </div>
        </div>
      )}
      <button onClick={handleDoorUnlock} disabled={doorCountdown > 0}
        className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition border ${
          doorCountdown > 0
            ? 'bg-amber-50 text-amber-600 border-amber-200 cursor-default'
            : isGuest
              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-md shadow-blue-200'
              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
        }`}>
        {doorCountdown > 0
          ? <><LockKeyhole size={16} className="text-amber-600" /> {lang === 'ar' ? `مفتوح — يُقفل بعد ${doorCountdown}ث` : `Unlocked — locking in ${doorCountdown}s`}</>
          : <><DoorOpen size={isGuest ? 20 : 16} /> {T('rm_unlock_door')}</>
        }
      </button>
    </Section>
  );

  const lightsSection = (can || isGuest) && !r.pdMode && (
    <Section title={T('rm_lights')}>
      {isGuest ? (
        // ── Guest: Smart bulb cards ───────────────────────────────────────
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['line1', T('rm_line1')],
              ['line2', T('rm_line2')],
              ['line3', T('rm_line3')],
            ].map(([k, label]) => (
              <SmartBulb
                key={k}
                on={!!r[k]}
                label={label}
                onClick={() => send('setLines', { [k]: !r[k] })}
              />
            ))}
          </div>
          {/* Dimmers */}
          <div className="space-y-2 pt-1">
            {['dimmer1', 'dimmer2'].map((k, i) => (
              <div key={k} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${r[k] > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                  {i + 1}
                </div>
                <input type="range" min="0" max="100" value={r[k] || 0}
                  onChange={e => send('setLines', { [k]: +e.target.value })}
                  className="flex-1 accent-amber-400 h-1.5" />
                <span className={`text-xs font-mono w-8 text-right ${r[k] > 0 ? 'text-amber-500' : 'text-gray-300'}`}>{r[k] || 0}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // ── Staff: simple toggles ─────────────────────────────────────────
        <>
          {[['line1', T('rm_line1')], ['line2', T('rm_line2')], ['line3', T('rm_line3')]].map(([k, l]) => (
            <div key={k} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-gray-600">{l}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => send('setLines', { [k]: !r[k] })}
                  className={`toggle ${r[k] ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                  <div className={`toggle-knob ${r[k] ? 'translate-x-5' : ''}`} />
                </button>
                <span className={`text-[10px] font-semibold w-6 ${r[k] ? 'text-emerald-500' : 'text-gray-300'}`}>
                  {r[k] ? T('on') : T('off')}
                </span>
              </div>
            </div>
          ))}
          {['dimmer1', 'dimmer2'].map((k, i) => (
            <div key={k} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-gray-600">{lang === 'ar' ? `معدِّل ${i + 1}` : `Dimmer ${i + 1}`}</span>
              <div className="flex items-center gap-2 flex-1 ml-4">
                <input type="range" min="0" max="100" value={r[k] || 0}
                  onChange={e => send('setLines', { [k]: +e.target.value })}
                  className="flex-1 accent-brand-500 h-1.5" />
                <span className="text-xs font-mono text-brand-500 w-8 text-right">{r[k] || 0}%</span>
              </div>
            </div>
          ))}
        </>
      )}
    </Section>
  );

  const acSection = (can || isGuest) && !r.pdMode && (
    <Section title={T('rm_ac')}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{T('rm_ac_mode')}</span>
          <div className="flex gap-1">
            {AC_MODES.map((m, i) => (
              <button key={i} onClick={() => send('setAC', { acMode: i })}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${r.acMode === i ? 'text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                style={r.acMode === i ? { background: MODE_COLORS[i] } : {}}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{T('rm_ac_temp')}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => adjTemp(-0.5)} className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-lg font-bold text-gray-500 transition">−</button>
            <span className="text-lg font-bold font-mono text-blue-500 w-12 text-center">
              {Math.round((r.acTemperatureSet ?? 22) * 2) / 2}°
            </span>
            <button onClick={() => adjTemp(0.5)} className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-lg font-bold text-gray-500 transition">+</button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">{T('rm_ac_fan')}</span>
          <div className="flex gap-1">
            {FAN_SPEEDS.map((f, i) => (
              <button key={i} onClick={() => send('setAC', { fanSpeed: i })}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${(r.fanSpeed ?? 3) === i ? 'bg-cyan-500 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );

  const curtainsSection = (can || isGuest) && !r.pdMode && (
    <Section title={T('rm_curtains')}>
      {[['curtainsPosition', T('rm_curtains_pos')], ['blindsPosition', T('rm_blinds_pos')]].map(([k, l]) => (
        <div key={k} className="flex items-center justify-between py-1.5">
          <span className="text-xs text-gray-600">{l}</span>
          <div className="flex items-center gap-2 flex-1 ml-4">
            <input type="range" min="0" max="100" value={r[k] || 0}
              onChange={e => send('setCurtainsBlinds', { [k]: +e.target.value })}
              className="flex-1 accent-brand-500 h-1.5" />
            <span className="text-xs font-mono text-brand-500 w-8 text-right">{r[k] || 0}%</span>
          </div>
        </div>
      ))}
    </Section>
  );

  const presetsSection = (can || isGuest) && !r.pdMode && (
    <Section title={T('rm_presets')}>
      <div className="flex gap-2">
        {[
          { mode: 'reading', label: T('rm_reading'), Icon: BookOpen, desc: T('rm_reading_desc') },
          { mode: 'tv',      label: T('rm_tv'),      Icon: Monitor,  desc: T('rm_tv_desc') },
          { mode: 'sleep',   label: T('rm_sleep'),   Icon: Moon,     desc: T('rm_sleep_desc') },
        ].map(({ mode, label, Icon, desc }) => {
          const active = activePreset === mode;
          return (
            <button key={mode} onClick={() => handlePreset(mode)}
              className={`flex-1 py-2.5 px-1 rounded-xl border transition text-center ${
                active ? 'bg-brand-500 border-brand-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}>
              <Icon size={14} className={`mx-auto mb-0.5 ${active ? 'text-white' : 'text-gray-500'}`} />
              <div className={`text-xs font-bold ${active ? 'text-white' : 'text-gray-700'}`}>{label}</div>
              <div className={`text-[9px] mt-0.5 ${active ? 'text-white/70' : 'text-gray-400'}`}>{desc}</div>
            </button>
          );
        })}
      </div>
      {sleepFireAt && (
        <p className="text-[10px] text-purple-500 mt-2 text-center">
          <Moon size={9} className="inline mr-1" />
          {lang === 'ar' ? `يرتفع التكييف إلى 25°م الساعة ${sleepFireAt}` : `AC adjusts to 25°C at ${sleepFireAt}`}
        </p>
      )}
    </Section>
  );

  const servicesSection = (
    <Section title={T('rm_services')}>
      <div className="flex gap-2">
        {[['dndService', '🔕 DND', '#F97316'], ['murService', '🧹 MUR', '#D97706'], ['sosService', '🚨 SOS', '#DC2626']].map(([k, l, c]) => {
          const active = !!r[k];
          return (can || isGuest) ? (
            <button key={k} onClick={() => send(active ? 'resetServices' : 'setService', active ? { services: [k] } : { [k]: true })}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold text-center transition border"
              style={{ background: active ? c + '14' : '#F9FAFB', color: active ? c : '#9CA3AF', borderColor: active ? c + '33' : '#E5E7EB' }}>
              {l}{active ? ' ✓' : ''}
            </button>
          ) : (
            <div key={k} className="flex-1 py-2.5 rounded-lg text-xs font-bold text-center border"
              style={{ background: active ? c + '14' : '#F9FAFB', color: active ? c : '#9CA3AF', borderColor: active ? c + '33' : '#E5E7EB' }}>
              {l}{active ? ' ✓' : ''}
            </div>
          );
        })}
      </div>
    </Section>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={isGuest ? undefined : onClose}>
      <div className={`bg-white shadow-2xl w-full overflow-y-auto ${isGuest ? 'min-h-screen rounded-none max-h-screen' : 'rounded-2xl max-w-lg max-h-[90vh]'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 z-10 ${isGuest ? 'bg-blue-700' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            {isGuest && logoUrl && (
              <img src={logoUrl} alt="logo" className="h-9 w-9 rounded-lg object-contain bg-white/10 p-0.5 shrink-0" />
            )}
            <div>
              <h2 className={`text-xl font-bold ${isGuest ? 'text-white' : ''}`}>
                {isGuest ? `${T('rm_room')} ${r.room}` : `Room ${r.room}`}
              </h2>
              {!isGuest && (
                <div className="flex gap-1.5 mt-1">
                  <span className="badge" style={{ background: sc + '18', color: sc }}>{STATUSES[statusIdx]}</span>
                  {r.pdMode && <span className="badge bg-red-50 text-red-600">⚡ PD</span>}
                  <span className="badge bg-gray-100 text-gray-500">{r.type}</span>
                  <span className="badge bg-gray-100 text-gray-500">F{r.floor}</span>
                  {r.reservation && <span className="badge bg-blue-50 text-blue-600">👤 {r.reservation.guestName}</span>}
                </div>
              )}
              {isGuest && r.reservation && (
                <div className="text-xs text-blue-200">{r.reservation.guestName}</div>
              )}
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg transition ${isGuest ? 'hover:bg-white/10' : 'hover:bg-gray-200'}`}>
            <X size={18} className={isGuest ? 'text-white/70' : 'text-gray-400'} />
          </button>
        </div>

        <div className="p-4 space-y-4">

          {/* NOT_OCCUPIED banner */}
          {r.roomStatus === 4 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
              <div className="text-purple-700 font-bold text-sm">{T('rm_not_occupied')}</div>
            </div>
          )}

          {/* PD banner for guests */}
          {isGuest && r.pdMode && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <div className="text-red-600 font-bold text-sm mb-1">{T('rm_pd_guest_title')}</div>
              <div className="text-xs text-red-500">{T('rm_pd_guest_msg')}</div>
            </div>
          )}

          {/* Staff tools */}
          {isStaff && (
            <div className="flex gap-2">
              <button onClick={togglePD}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition border ${r.pdMode
                  ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                <Zap size={14} className="inline mr-1" />
                {r.pdMode ? T('rm_pd_active') : T('rm_power_down')}
              </button>
              {can && (
                <button onClick={handleReset}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition">
                  {T('rm_reset')}
                </button>
              )}
            </div>
          )}

          {/* Checkout button — widened condition (task 13/14) */}
          {canCheckout && (
            <button onClick={handleCheckout} disabled={checkingOut}
              className="w-full py-2.5 rounded-xl font-bold text-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
              {checkingOut ? T('rm_checking_out') : T('rm_checkout_btn')}
            </button>
          )}

          {/* ── GUEST ORDER: Door → Lights → AC → Curtains → Presets → Services ── */}
          {isGuest ? (
            <>
              {doorSection}
              {lightsSection}
              {acSection}
              {curtainsSection}
              {presetsSection}
              {servicesSection}
            </>
          ) : (
            /* ── STAFF ORDER: Sensors → Door → Presets → Lights → AC → Curtains → Services → … ── */
            <>
              {sensorSection}
              {doorSection}
              {presetsSection}
              {lightsSection}
              {acSection}
              {curtainsSection}
              {servicesSection}

              {/* Consumption — staff only */}
              <Section title={T('rm_consumption')}>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <Stat label="kWh" value={(r.elecConsumption || 0).toFixed(2)} color="text-amber-500" />
                  <Stat label="m³" value={(r.waterConsumption || 0).toFixed(3)} color="text-blue-500" />
                </div>
              </Section>

              {/* Device info */}
              {can && (
                <Section title={T('rm_device')}>
                  <div className="text-[10px] text-gray-500">
                    FW: {r.firmwareVersion || '—'} · GW: {r.gatewayVersion || '—'}
                  </div>
                  {r.deviceId && <div className="text-[7px] text-gray-300 font-mono mt-1">{r.deviceId}</div>}
                </Section>
              )}

              {/* Room status */}
              {isStaff && (
                <Section title={T('rm_set_status')}>
                  <div className="flex gap-1.5 flex-wrap">
                    {STATUSES.map((st, i) => (
                      <button key={i} onClick={() => rpc(roomId, 'setRoomStatus', { roomStatus: i })}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold border transition"
                        style={{
                          background: statusIdx === i ? SCOL[i] + '14' : '#F9FAFB',
                          color: statusIdx === i ? SCOL[i] : '#9CA3AF',
                          borderColor: statusIdx === i ? SCOL[i] + '33' : '#E5E7EB'
                        }}>
                        {st}
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {/* Room Automation */}
              {can && <RoomAutomation room={r.room} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Room Automation ──────────────────────────────────────────────────────────
const DEFAULT_STATUS_LABELS = ['Vacant', 'Occupied', 'Service', 'Maintenance', 'Not Occupied'];

function summarizeTrigger(scene) {
  const cfg = typeof scene.trigger_config === 'string'
    ? JSON.parse(scene.trigger_config) : (scene.trigger_config || {});
  if (scene.trigger_type === 'time') {
    const d = cfg.days || [];
    const dayStr = d.length === 7 ? 'Every day' : d.join(', ') || 'Every day';
    return `${dayStr} at ${cfg.time || '00:00'}`;
  }
  const eventName = {
    roomStatus: 'Room Status', pirMotionStatus: 'Motion',
    doorStatus: 'Door', checkIn: 'Check-In', checkOut: 'Check-Out'
  }[cfg.event] || cfg.event;
  let s = cfg.operator === 'change'
    ? `When ${eventName} changes`
    : `When ${eventName} ${cfg.operator === 'neq' ? '≠' : '='} ${
        cfg.event === 'roomStatus' ? (DEFAULT_STATUS_LABELS[cfg.value] ?? cfg.value) : cfg.value
      }`;
  if (cfg.fromValues?.length > 0) {
    const labels = cfg.fromValues.map(v =>
      cfg.event === 'roomStatus' ? (DEFAULT_STATUS_LABELS[v] ?? v) : v
    );
    s += ` from ${labels.join('/')}`;
  }
  return s;
}

function RoomAutomation({ room }) {
  const [scenes, setScenes]   = useState([]);
  const [running, setRunning] = useState(null);
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);

  useEffect(() => {
    api(`/api/scenes?room=${encodeURIComponent(room)}&isDefault=1`)
      .then(data => setScenes(data))
      .catch(() => {});
  }, [room]);

  const handleToggle = async (scene) => {
    const newEnabled = !scene.enabled;
    setScenes(s => s.map(x => x.id === scene.id ? { ...x, enabled: newEnabled } : x));
    try {
      await api(`/api/scenes/${scene.id}`, { method: 'PUT', body: JSON.stringify({ enabled: newEnabled }) });
    } catch {
      setScenes(s => s.map(x => x.id === scene.id ? { ...x, enabled: scene.enabled } : x));
    }
  };

  const handleRun = async (id) => {
    setRunning(id);
    try { await api(`/api/scenes/${id}/run`, { method: 'POST' }); } catch {}
    setTimeout(() => setRunning(null), 1500);
  };

  if (!scenes.length) return null;

  return (
    <Section title={T('rm_automation')}>
      <div className="space-y-2">
        {scenes.map(scene => (
          <div key={scene.id}
            className={`flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0 ${!scene.enabled ? 'opacity-50' : ''}`}>
            <button onClick={() => handleToggle(scene)}
              className={`toggle flex-shrink-0 ${scene.enabled ? 'bg-emerald-400' : 'bg-gray-200'}`}>
              <div className={`toggle-knob ${scene.enabled ? 'translate-x-5' : ''}`} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-700">{scene.name}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{summarizeTrigger(scene)}</div>
            </div>
            <button onClick={() => handleRun(scene.id)} disabled={running === scene.id}
              title="Run now"
              className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition disabled:opacity-50 flex-shrink-0">
              <Play size={14} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className={`text-base font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[8px] text-gray-400">{label}</div>
    </div>
  );
}
