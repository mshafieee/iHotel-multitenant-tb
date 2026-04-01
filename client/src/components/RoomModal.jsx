import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Zap, Play, BookOpen, Monitor, Moon, DoorOpen, LockKeyhole, CalendarPlus, CheckCircle, BedDouble } from 'lucide-react';
import useHotelStore from '../store/hotelStore';
import useAuthStore from '../store/authStore';
import { api } from '../utils/api';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

const AC_MODES = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS = ['LOW', 'MED', 'HIGH', 'AUTO'];
const STATUSES = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED', 'RESERVED'];
const SCOL = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6', '#0891B2'];
const effectiveStatusIdx = (r) => (r?.roomStatus === 0 && r?.reservation) ? 5 : (r?.roomStatus ?? 0);
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

// Methods that should be debounced (continuous controls like sliders, temp buttons)
const DEBOUNCED_METHODS = new Set(['setLines', 'setAC', 'setCurtainsBlinds', 'setService']);
const DEBOUNCE_MS = 500;

const DEFAULT_DEVICE_CFG = { lamps: 3, dimmers: 2, ac: 1, curtains: 1, blinds: 1 };

export default function RoomModal({ roomId, onClose, role, onLockout, logoUrl, onReserveRoom, deviceConfig: deviceConfigProp }) {
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const STATUS_LABELS = [T('status_vacant'), T('status_occupied'), T('status_service'), T('status_maintenance'), T('status_not_occupied'), T('status_reserved')];
  const rooms = useHotelStore(s => s.rooms);
  // Prop takes priority (guest portal passes it); fall back to auth store (staff dashboard)
  const authDeviceCfg = useAuthStore(s => s.user?.deviceConfig);
  const cfg = deviceConfigProp || authDeviceCfg || DEFAULT_DEVICE_CFG;
  const rpc = useHotelStore(s => s.rpc);
  const checkout = useHotelStore(s => s.checkout);
  const [checkingOut, setCheckingOut]         = useState(false);
  const [reviewUrl, setReviewUrl]             = useState(null); // shown after checkout
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [selectedPayment, setSelectedPayment]     = useState(null);
  const [thirdPartyChannel, setThirdPartyChannel] = useState('');
  const [showHKPicker, setShowHKPicker]   = useState(false);
  const [hkList, setHkList]               = useState([]);
  const [hkAssigning, setHkAssigning]     = useState(false);
  const [hkFlash, setHkFlash]             = useState(null);
  const [doorCountdown, setDoorCountdown] = useState(0);
  const [unlockSent, setUnlockSent] = useState(false);
  const [sleepFireAt, setSleepFireAt] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const applyingPresetRef  = useRef(false);
  const activePresetRef    = useRef(null);
  const prevDoorStatusRef  = useRef(undefined);

  // ── Debounce refs for command feedback system ──────────────────────────────
  // Accumulates params per method and delays server call until user stops for 500ms
  const debounceTimers = useRef({});    // { method: timeoutId }
  const pendingParams  = useRef({});    // { method: { ...mergedParams } }

  // Flush all pending debounced commands on unmount
  useEffect(() => {
    return () => {
      Object.entries(debounceTimers.current).forEach(([method, timer]) => {
        clearTimeout(timer);
        const merged = pendingParams.current[method];
        if (merged) fireRpc(method, merged);
      });
      debounceTimers.current = {};
      pendingParams.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = rooms[roomId];
  if (!r) return null;

  const can = role === 'owner' || role === 'admin';
  const isStaff = can || role === 'frontdesk';
  const isGuest = role === 'guest';
  const statusIdx = Math.min(effectiveStatusIdx(r), STATUSES.length - 1);
  const sc = SCOL[statusIdx] ?? SCOL[0];

  // Fire the actual server RPC (no debounce)
  function fireRpc(method, params) {
    if (role === 'guest') {
      return api('/api/guest/rpc', { method: 'POST', body: JSON.stringify({ method, params }) })
        .catch(e => {
          if (e.message === 'session_expired' && onLockout) onLockout();
          else if (e.message === 'room_pd') {
            useHotelStore.setState(s => ({
              rooms: { ...s.rooms, [roomId]: { ...s.rooms[roomId], pdMode: true } }
            }));
          }
        });
    }
    const room = useHotelStore.getState().rooms[roomId];
    const tbDeviceId = room?.deviceId || roomId;
    return api(`/api/devices/${tbDeviceId}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ method, params })
    }).catch(e => console.error('RPC error:', e.message));
  }

  // Apply optimistic UI update immediately (before server call)
  function applyOptimistic(method, params) {
    useHotelStore.setState(s => {
      const prev = s.rooms[roomId];
      if (!prev) return s;
      const updated = { ...prev };
      if (method === 'setLines') {
        if ('line1' in params) updated.line1 = params.line1;
        if ('line2' in params) updated.line2 = params.line2;
        if ('line3' in params) updated.line3 = params.line3;
        if ('dimmer1' in params) updated.dimmer1 = params.dimmer1;
        if ('dimmer2' in params) updated.dimmer2 = params.dimmer2;
      } else if (method === 'setAC') {
        if ('acMode' in params) updated.acMode = params.acMode;
        if ('acTemperatureSet' in params) updated.acTemperatureSet = params.acTemperatureSet;
        if ('fanSpeed' in params) updated.fanSpeed = params.fanSpeed;
      } else if (method === 'setCurtainsBlinds') {
        if ('curtainsPosition' in params) updated.curtainsPosition = params.curtainsPosition;
        if ('blindsPosition' in params) updated.blindsPosition = params.blindsPosition;
      } else if (method === 'setService') {
        Object.assign(updated, params);
        if (params.dndService === true) updated.murService = false;
        else if (params.murService === true) updated.dndService = false;
      } else if (method === 'resetServices') {
        (params.services || []).forEach(k => { updated[k] = false; });
      } else if (method === 'setRoomStatus') {
        updated.roomStatus = params.roomStatus;
      } else if (method === 'setPDMode') {
        updated.pdMode = !!params.pdMode;
        if (updated.pdMode) {
          for (let i = 1; i <= cfg.lamps; i++) updated[`line${i}`] = false;
          for (let i = 1; i <= cfg.dimmers; i++) updated[`dimmer${i}`] = 0;
          updated.acMode = 0; updated.fanSpeed = 0;
          updated.curtainsPosition = 0; updated.blindsPosition = 0;
        }
      } else if (method === 'setDoorUnlock') {
        updated.doorUnlock = true;
      } else if (method === 'setDoorLock') {
        updated.doorUnlock = false;
      }
      return { rooms: { ...s.rooms, [roomId]: updated } };
    });
  }

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

    // Always update UI immediately
    applyOptimistic(method, params);

    // Debounce continuous controls — only send to server after 500ms of inactivity
    if (DEBOUNCED_METHODS.has(method)) {
      // Merge params with any pending params for this method
      pendingParams.current[method] = { ...(pendingParams.current[method] || {}), ...params };
      // Reset timer
      if (debounceTimers.current[method]) clearTimeout(debounceTimers.current[method]);
      debounceTimers.current[method] = setTimeout(() => {
        const merged = pendingParams.current[method];
        delete pendingParams.current[method];
        delete debounceTimers.current[method];
        if (merged) fireRpc(method, merged);
      }, DEBOUNCE_MS);
      return;
    }

    // Immediate commands (door, presets, room status, PD, etc.)
    return fireRpc(method, params);
  }, [roomId, role, onLockout]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setUnlockSent(true);
    setTimeout(() => setUnlockSent(false), 2500);
    let count = 5;
    setDoorCountdown(count);
    const iv = setInterval(() => {
      count--;
      setDoorCountdown(count);
      if (count <= 0) {
        clearInterval(iv);
        send('setDoorLock', {});
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

  const handleCheckout = () => {
    const existing = r.reservation?.paymentMethod;
    if (existing && existing !== 'pending') {
      // Payment already confirmed — skip picker and check out immediately
      doCheckout(existing);
    } else {
      setSelectedPayment(null);
      setThirdPartyChannel('');
      setShowPaymentPicker(true);
    }
  };

  const doCheckout = async (paymentMethod) => {
    setShowPaymentPicker(false);
    setCheckingOut(true);
    try {
      const result = await checkout(r.room, paymentMethod,
        paymentMethod === 'thirdparty' ? thirdPartyChannel.trim() : undefined);
      if (result?.reviewUrl) setReviewUrl(result.reviewUrl);
      else onClose();
    }
    catch (e) { console.error('Checkout failed:', e.message); onClose(); }
    finally { setCheckingOut(false); }
  };

  const openHKPicker = async () => {
    setShowHKPicker(true);
    setHkFlash(null);
    if (!hkList.length) {
      try {
        const data = await api('/api/housekeeping/housekeepers');
        setHkList(data);
      } catch {}
    }
  };

  const assignToHousekeeper = async (username) => {
    setHkAssigning(true);
    try {
      const res = await api('/api/housekeeping/assign', {
        method: 'POST',
        body: JSON.stringify({ rooms: [String(r.room)], assignedTo: username }),
      });
      const skipped = res.skipped ?? 0;
      if (skipped > 0) {
        setHkFlash({ type: 'warn', msg: T('hk_already_assigned') });
      } else {
        setHkFlash({ type: 'ok', msg: `${T('hk_assigned_ok')} ${username}` });
        setTimeout(() => setShowHKPicker(false), 1200);
      }
    } catch (e) {
      setHkFlash({ type: 'err', msg: e.message || 'Assignment failed' });
    } finally {
      setHkAssigning(false);
    }
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
          ? <><LockKeyhole size={16} className="text-amber-600" /> {lang === 'ar' ? `أُرسل — يُقفل بعد ${doorCountdown}ث` : `Sent — locking in ${doorCountdown}s`}</>
          : <><DoorOpen size={isGuest ? 20 : 16} /> {T('rm_unlock_door')}</>
        }
      </button>
      {/* "Sent!" confirmation popup */}
      {unlockSent && (
        <div className="mt-2 flex items-center justify-center gap-1.5 text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg py-2 animate-pulse">
          <CheckCircle size={14} />
          <span className="text-xs font-bold">{lang === 'ar' ? 'تم الإرسال!' : 'Sent!'}</span>
        </div>
      )}
    </Section>
  );

  const lampLabel = (i) => {
    if (cfg.lampNames?.[i]) return cfg.lampNames[i];
    const staticLabels = [T('rm_line1'), T('rm_line2'), T('rm_line3')];
    return i < staticLabels.length ? staticLabels[i] : (lang === 'ar' ? `إضاءة ${i + 1}` : `Light ${i + 1}`);
  };
  const dimmerLabel = (i) => cfg.dimmerNames?.[i] || (lang === 'ar' ? `معدِّل ${i + 1}` : `Dimmer ${i + 1}`);
  const lampKeys   = Array.from({ length: cfg.lamps },   (_, i) => `line${i + 1}`);
  const dimmerKeys = Array.from({ length: cfg.dimmers },  (_, i) => `dimmer${i + 1}`);

  const lightsSection = (can || isGuest) && !r.pdMode && (cfg.lamps > 0 || cfg.dimmers > 0) && (
    <Section title={T('rm_lights')}>
      {isGuest ? (
        // ── Guest: Smart bulb cards ───────────────────────────────────────
        <div className="space-y-3">
          {cfg.lamps > 0 && (
            <div className={`grid gap-2 ${cfg.lamps <= 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {lampKeys.map((k, i) => (
                <SmartBulb
                  key={k}
                  on={!!r[k]}
                  label={lampLabel(i)}
                  onClick={() => send('setLines', { [k]: !r[k] })}
                />
              ))}
            </div>
          )}
          {cfg.dimmers > 0 && (
            <div className="space-y-2 pt-1">
              {dimmerKeys.map((k, i) => (
                <div key={k} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${r[k] > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}
                    title={dimmerLabel(i)}>
                    {i + 1}
                  </div>
                  <input type="range" min="0" max="100" value={r[k] || 0}
                    onChange={e => send('setLines', { [k]: +e.target.value })}
                    className="flex-1 accent-amber-400 h-1.5" />
                  <span className={`text-xs font-mono w-8 text-right ${r[k] > 0 ? 'text-amber-500' : 'text-gray-300'}`}>{r[k] || 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ── Staff: simple toggles ─────────────────────────────────────────
        <>
          {lampKeys.map((k, i) => (
            <div key={k} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-gray-600">{lampLabel(i)}</span>
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
          {dimmerKeys.map((k, i) => (
            <div key={k} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-gray-600">{dimmerLabel(i)}</span>
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

  const acSection = (can || isGuest) && !r.pdMode && cfg.ac > 0 && (
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

  const curtainControls = [
    cfg.curtains > 0 && ['curtainsPosition', T('rm_curtains_pos')],
    cfg.blinds   > 0 && ['blindsPosition',   T('rm_blinds_pos')],
  ].filter(Boolean);

  const curtainsSection = (can || isGuest) && !r.pdMode && curtainControls.length > 0 && (
    <Section title={T('rm_curtains')}>
      {curtainControls.map(([k, l]) => (
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

  // ExtrasWidget is rendered as a stable JSX element (not a component defined inside the closure)
  // to prevent React unmounting/remounting it on every 5s room poll.
  // See GuestExtrasWidget defined outside RoomModal below.

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

  // ── Payment method picker overlay ────────────────────────────────────────
  const PAYMENT_OPTIONS = [
    { key: 'cash',       label: T('pms_cash'),           icon: '💵', color: 'emerald' },
    { key: 'visa',       label: T('pms_visa'),           icon: '💳', color: 'blue'    },
    { key: 'online',     label: T('pm_online'),          icon: '🌐', color: 'purple'  },
    { key: 'thirdparty', label: T('pm_thirdparty'),      icon: '🤝', color: 'orange'  },
  ];
  if (showPaymentPicker) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-base font-bold text-gray-800 mb-1">{T('pm_title')}</h2>
          <p className="text-xs text-gray-400 mb-4">{T('pm_subtitle')} {r.room}</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {PAYMENT_OPTIONS.map(opt => (
              <button key={opt.key}
                onClick={() => { setSelectedPayment(opt.key); setThirdPartyChannel(''); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 font-semibold text-sm transition
                  ${selectedPayment === opt.key
                    ? `border-${opt.color}-400 bg-${opt.color}-50 text-${opt.color}-700`
                    : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200'}`}>
                <span className="text-2xl">{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>
          {selectedPayment === 'thirdparty' && (
            <div className="mb-4">
              <input
                type="text"
                autoFocus
                placeholder={T('pm_thirdparty_placeholder')}
                value={thirdPartyChannel}
                onChange={e => setThirdPartyChannel(e.target.value)}
                className="w-full border border-orange-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setShowPaymentPicker(false)}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition">
              {T('cancel')}
            </button>
            <button
              onClick={() => selectedPayment && doCheckout(selectedPayment)}
              disabled={!selectedPayment || (selectedPayment === 'thirdparty' && !thirdPartyChannel.trim())}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-amber-500 text-white hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
              {T('pm_confirm')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Review QR overlay shown right after checkout ─────────────────────────
  if (reviewUrl) {
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(reviewUrl)}&margin=8`;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h2 className="text-lg font-bold text-gray-800 mb-1">Check-out complete!</h2>
          <p className="text-sm text-gray-500 mb-4">Show this QR to the guest to rate their stay</p>
          <img src={qrSrc} alt="Review QR" className="w-48 h-48 mx-auto rounded-xl border border-gray-100 shadow-sm mb-3" />
          <p className="text-[10px] text-gray-400 break-all mb-4">{reviewUrl}</p>
          <button onClick={onClose} className="btn btn-primary w-full">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center ${isGuest ? '' : 'bg-black/40 backdrop-blur-sm p-4'}`}
      onClick={isGuest ? undefined : onClose}>
      <div className={`bg-white shadow-2xl w-full overflow-y-auto ${isGuest ? 'rounded-none h-[100dvh] max-h-[100dvh]' : 'rounded-2xl max-w-lg max-h-[90vh]'}`}
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
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <span className="badge" style={{ background: sc + '18', color: sc }}>{STATUS_LABELS[statusIdx] || STATUSES[statusIdx]}</span>
                  {r.pdMode && <span className="badge bg-red-50 text-red-600">⚡ PD</span>}
                  <span className="badge bg-gray-100 text-gray-500">{r.type}</span>
                  <span className="badge bg-gray-100 text-gray-500">F{r.floor}</span>
                  {r.reservation && <span className="badge bg-blue-50 text-blue-600">👤 {r.reservation.guestName}</span>}
                  {r.reservation?.checkOut && r.roomStatus !== 3 && (
                    <span className="badge bg-amber-50 text-amber-700">
                      {lang === 'ar' ? `تسجيل الخروج: ${r.reservation.checkOut}` : `Checkout: ${r.reservation.checkOut}`}
                    </span>
                  )}
                </div>
              )}
              {isGuest && r.reservation && (
                <div className="text-xs text-blue-200">{r.reservation.guestName}</div>
              )}
              {isGuest && r.reservation?.checkOut && r.roomStatus !== 3 && (
                <div className="text-xs text-blue-200 mt-0.5">
                  {lang === 'ar' ? `تسجيل الخروج: ${r.reservation.checkOut}` : `Checkout: ${r.reservation.checkOut}`}
                </div>
              )}
            </div>
          </div>
          {isGuest && (
            <button
              onClick={() => useLangStore.getState().setLang(lang === 'ar' ? 'en' : 'ar')}
              className="px-2.5 py-1 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25 transition border border-white/20 mr-1"
              title={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
          )}
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

          {/* Reserve Room — shown for staff when room is vacant and unreserved */}
          {isStaff && r.roomStatus === 0 && !r.reservation && onReserveRoom && (
            <button onClick={() => { onReserveRoom(r.room); onClose(); }}
              className="w-full py-2.5 rounded-xl font-bold text-sm bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition flex items-center justify-center gap-2">
              <CalendarPlus size={16} />
              {lang === 'ar' ? `حجز الغرفة ${r.room}` : `Reserve Room ${r.room}`}
            </button>
          )}

          {/* Assign to Housekeeper — shown for staff when room is in SERVICE status */}
          {isStaff && r.roomStatus === 2 && (
            <div>
              <button onClick={openHKPicker}
                className="w-full py-2.5 rounded-xl font-bold text-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition flex items-center justify-center gap-2">
                <BedDouble size={16} />
                {T('hk_room_assign_btn')}
              </button>

              {showHKPicker && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-white shadow-md overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-100">
                    <span className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">{T('hk_picker_title')}</span>
                    <button onClick={() => setShowHKPicker(false)}
                      className="text-amber-400 hover:text-amber-600 text-lg leading-none">×</button>
                  </div>

                  {hkFlash && (
                    <div className={`text-xs font-semibold px-3 py-2 ${
                      hkFlash.type === 'ok'   ? 'bg-emerald-50 text-emerald-700' :
                      hkFlash.type === 'warn' ? 'bg-amber-50 text-amber-700' :
                                                'bg-red-50 text-red-600'
                    }`}>{hkFlash.msg}</div>
                  )}

                  {hkList.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center whitespace-pre-line">
                      {T('hk_picker_empty')}
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-50">
                      {hkList.map(h => (
                        <li key={h.id}>
                          <button
                            disabled={hkAssigning}
                            onClick={() => assignToHousekeeper(h.username)}
                            className="w-full text-left px-3 py-2.5 hover:bg-amber-50 transition disabled:opacity-50 flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[11px] font-bold shrink-0">
                              {(h.full_name || h.username).charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-gray-700">{h.full_name || h.username}</div>
                              {h.full_name && <div className="text-[10px] text-gray-400">@{h.username}</div>}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
              <GuestExtrasWidget lang={lang} />
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

              {/* Consumption — current stay (since last reset) */}
              <Section title={T('rm_consumption')}>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <Stat label="kWh" value={Math.max(0, (r.elecConsumption || 0) - (r.elecMeterBaseline || 0)).toFixed(2)} color="text-amber-500" />
                  <Stat label="m³"  value={Math.max(0, (r.waterConsumption || 0) - (r.waterMeterBaseline || 0)).toFixed(3)} color="text-blue-500" />
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
                        {STATUS_LABELS[i] || st}
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

// ── Guest Extras Widget ───────────────────────────────────────────────────
// Defined outside RoomModal so React never recreates the component type between
// renders (which caused unmount → remount every 5 s poll, clearing all state).
function GuestExtrasWidget({ lang }) {
  const T = (key) => t(key, lang);
  const CAT_EMOJI = { FOOD: '🍳', TRANSPORT: '🚗', AMENITY: '🌸', SERVICE: '🛎️' };
  const CAT_LABEL = { FOOD: T('upsell_cat_food'), TRANSPORT: T('upsell_cat_transport'), AMENITY: T('upsell_cat_amenity'), SERVICE: T('upsell_cat_service') };
  const STATUS_CHIP = {
    pending:   'bg-amber-50 text-amber-700 border-amber-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    delivered: 'bg-blue-50 text-blue-700 border-blue-200',
    cancelled: 'bg-gray-100 text-gray-400 border-gray-200',
  };

  const [offers,     setOffers]     = useState([]);
  const [myExtras,   setMyExtras]   = useState([]);
  const [quantities, setQuantities] = useState({});
  const [submitting, setSubmitting] = useState(null);
  const [flash,      setFlash]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = () => {
    api('/api/upsell/offers').then(setOffers).catch(() => {});
    api('/api/upsell/my-extras').then(setMyExtras).catch(() => {});
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([
      api('/api/upsell/offers').then(setOffers),
      api('/api/upsell/my-extras').then(setMyExtras),
    ]); } catch {} finally { setRefreshing(false); }
  };

  const handleRequest = async (offer) => {
    const qty = quantities[offer.id] || 1;
    setSubmitting(offer.id);
    try {
      const extra = await api('/api/upsell/extras', {
        method: 'POST',
        body: JSON.stringify({ offerId: offer.id, quantity: qty }),
      });
      setMyExtras(prev => [extra, ...prev]);
      setFlash(T('upsell_requested_ok'));
      setTimeout(() => setFlash(null), 3000);
    } catch (e) {
      setFlash('⚠️ ' + (e.message || 'Failed'));
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setSubmitting(null);
    }
  };

  const offerName = (o) => lang === 'ar' ? (o.name_ar || o.name) : o.name;
  const unitLabel = (u) => ({ 'one-time': T('upsell_unit_once'), 'per-night': T('upsell_unit_night'), 'per-person': T('upsell_unit_person') }[u] || u);

  // Group offers by category
  const categories = [...new Set(offers.map(o => o.category))];

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{T('upsell_tab')}</div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold transition disabled:opacity-50"
        >
          {refreshing ? '…' : T('upsell_refresh')}
        </button>
      </div>

      {flash && (
        <div className="text-xs font-semibold rounded-lg px-3 py-2 mb-3 bg-emerald-50 text-emerald-700">
          {flash}
        </div>
      )}

      {/* Available offers grouped by category */}
      {offers.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">{T('upsell_no_offers')}</p>
      ) : (
        <div className="space-y-3">
          {categories.map(cat => (
            <div key={cat}>
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <span>{CAT_EMOJI[cat] || '🛎️'}</span>
                <span>{CAT_LABEL[cat] || cat}</span>
              </div>
              <div className="space-y-2">
                {offers.filter(o => o.category === cat).map(offer => {
                  const qty = quantities[offer.id] || 1;
                  const isBusy = submitting === offer.id;
                  return (
                    <div key={offer.id} className="flex items-start gap-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 leading-snug break-words">{offerName(offer)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{offer.price} SAR · {unitLabel(offer.unit)}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setQuantities(q => ({ ...q, [offer.id]: Math.max(1, (q[offer.id] || 1) - 1) }))}
                          className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-300 transition"
                        >−</button>
                        <span className="w-5 text-center text-xs font-bold text-gray-700">{qty}</span>
                        <button
                          onClick={() => setQuantities(q => ({ ...q, [offer.id]: (q[offer.id] || 1) + 1 }))}
                          className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-300 transition"
                        >+</button>
                      </div>
                      <button
                        onClick={() => handleRequest(offer)}
                        disabled={isBusy}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-500 text-white hover:opacity-90 transition disabled:opacity-50"
                      >
                        {isBusy ? '…' : T('upsell_request_btn')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My existing orders */}
      {myExtras.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{T('upsell_my_orders')}</p>
          {myExtras.map(ex => (
            <div key={ex.id} className="rounded-lg bg-gray-50 border border-gray-100 p-2 text-xs space-y-1">
              <div className="flex items-start gap-2">
                <span className="flex-1 text-gray-700 font-medium break-words leading-snug">
                  {lang === 'ar' ? (ex.offer_name_ar || ex.offer_name) : ex.offer_name}
                  {ex.quantity > 1 && <span className="text-gray-400 font-normal"> ×{ex.quantity}</span>}
                </span>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CHIP[ex.status] || 'bg-gray-100 text-gray-400'}`}>
                  {T(`upsell_status_${ex.status}`) || ex.status}
                </span>
              </div>
              {ex.staff_note && (
                <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1 break-words leading-snug">
                  💬 {ex.staff_note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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
