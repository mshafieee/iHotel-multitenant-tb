import React, { useCallback, useState } from 'react';
import { X, Zap } from 'lucide-react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';

const AC_MODES = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS = ['LOW', 'MED', 'HIGH', 'AUTO'];
// 0=VACANT 1=OCCUPIED 2=SERVICE 3=MAINTENANCE 4=NOT_OCCUPIED
const STATUSES = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const SCOL = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];
const MODE_COLORS = ['#6B7280', '#2563EB', '#DC2626', '#06B6D4', '#16A34A'];

export default function RoomModal({ roomId, onClose, role, onLockout }) {
  const rooms = useHotelStore(s => s.rooms);
  const rpc = useHotelStore(s => s.rpc);
  const checkout = useHotelStore(s => s.checkout);
  const [checkingOut, setCheckingOut] = useState(false);
  const [doorCountdown, setDoorCountdown] = useState(0);

  const r = rooms[roomId];
  if (!r) return null;

  const can = role === 'owner' || role === 'admin';
  const isStaff = can || role === 'frontdesk';
  const isGuest = role === 'guest';
  const statusIdx = Math.min(r.roomStatus ?? 0, STATUSES.length - 1);
  const sc = SCOL[statusIdx] ?? SCOL[0];

  const send = useCallback((method, params) => {
    if (role === 'guest') {
      // Optimistic update — UI responds instantly, same as staff rpc()
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
          if (e.message === 'session_expired' && onLockout) {
            onLockout();
          } else if (e.message === 'room_pd') {
            useHotelStore.setState(s => ({
              rooms: { ...s.rooms, [roomId]: { ...s.rooms[roomId], pdMode: true } }
            }));
          }
          throw e;
        });
    }
    return rpc(roomId, method, params);
  }, [roomId, rpc, role, onLockout]);

  const adjTemp = (delta) => {
    // Snap current value to nearest 0.5 before applying delta
    // This prevents drift when telemetry delivers e.g. 22.1 (→ 22.0 + 0.5 = 22.5)
    const current = Math.round((r.acTemperatureSet ?? 22) * 2) / 2;
    const t = Math.max(16, Math.min(30, current + delta));
    send('setAC', { acTemperatureSet: t });
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
    try {
      await api(`/api/rooms/${r.room}/reset`, { method: 'POST' });
    } catch (e) { console.error('Reset failed:', e.message); }
  };

  const handleCheckout = async () => {
    if (!confirm(`Check out Room ${r.room}? This will cancel the reservation and set status to SERVICE.`)) return;
    setCheckingOut(true);
    try {
      await checkout(r.room);
      onClose();
    } catch (e) {
      console.error('Checkout failed:', e.message);
    } finally {
      setCheckingOut(false);
    }
  };

  const togglePD = () => {
    const newPD = !r.pdMode;
    if (newPD && !confirm(`Activate Power Down for Room ${r.room}? All power will be cut.`)) return;
    rpc(roomId, 'setPDMode', { pdMode: newPD });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold">Room {r.room}</h2>
            <div className="flex gap-1.5 mt-1">
              <span className="badge" style={{ background: sc + '18', color: sc }}>{STATUSES[statusIdx]}</span>
              {r.pdMode && <span className="badge bg-red-50 text-red-600">⚡ PD</span>}
              <span className="badge bg-gray-100 text-gray-500">{r.type}</span>
              <span className="badge bg-gray-100 text-gray-500">F{r.floor}</span>
              {r.reservation && (
                <span className="badge bg-blue-50 text-blue-600">👤 {r.reservation.guestName}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-200 transition">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">

          {/* NOT_OCCUPIED banner */}
          {r.roomStatus === 4 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
              <div className="text-purple-700 font-bold text-sm">🟣 Room Unoccupied</div>
            </div>
          )}

          {/* PD banner for guests when power is restricted */}
          {isGuest && r.pdMode && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <div className="text-red-600 font-bold text-sm mb-1">⚡ Room Power Restricted</div>
              <div className="text-xs text-red-500">Room controls are temporarily disabled by hotel management. Please contact reception.</div>
            </div>
          )}

          {/* Power Down toggle + Reset — staff only */}
          {isStaff && (
            <div className="flex gap-2">
              <button onClick={togglePD}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition border ${r.pdMode
                  ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                <Zap size={14} className="inline mr-1" />
                {r.pdMode ? '⚡ PD ACTIVE — Restore' : '⚡ Power Down'}
              </button>
              {can && (
                <button onClick={handleReset}
                  className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition">
                  🔄 Reset to Default
                </button>
              )}
            </div>
          )}

          {/* Checkout button — staff only, shown when room is occupied/not-occupied with a reservation */}
          {isStaff && r.reservation && (r.roomStatus === 1 || r.roomStatus === 4) && (
            <button onClick={handleCheckout} disabled={checkingOut}
              className="w-full py-2.5 rounded-xl font-bold text-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
              {checkingOut ? '⏳ Checking out...' : '🚪 Check Out Guest → SERVICE'}
            </button>
          )}

          {/* Sensors */}
          <Section title="🌡 Sensors">
            <div className={`grid gap-3 text-center ${isGuest ? 'grid-cols-3' : 'grid-cols-4'}`}>
              <Stat label="TEMP" value={r.temperature != null ? `${r.temperature}°` : '—'} color={(r.temperature || 22) > 28 ? 'text-red-500' : 'text-emerald-500'} />
              <Stat label="HUMID" value={r.humidity != null ? `${r.humidity}%` : '—'} color="text-blue-500" />
              <Stat label="CO₂" value={r.co2 ?? '—'} color={(r.co2 || 400) > 1000 ? 'text-red-500' : 'text-emerald-500'} />
              {!isGuest && <Stat label="PIR" value={r.pirMotionStatus ? 'DETECTED' : 'CLEAR'} color={r.pirMotionStatus ? 'text-blue-500' : 'text-gray-300'} />}
            </div>
          </Section>

          {/* Door */}
          <Section title="🚪 Door">
            <div className="flex gap-4 mb-3">
              <div className="flex-1 text-center">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Contact</div>
                <div className={`text-sm font-bold ${r.doorStatus ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {r.doorStatus ? 'OPENED' : 'CLOSED'}
                </div>
                {r.doorContactsBattery != null && <div className="text-[9px] text-gray-300">🔋{r.doorContactsBattery}%</div>}
              </div>
              <div className="flex-1 text-center">
                <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Lock</div>
                <div className={`text-sm font-bold ${r.doorUnlock ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {r.doorUnlock ? 'UNLOCKED' : 'LOCKED'}
                </div>
                {r.doorLockBattery != null && <div className="text-[9px] text-gray-300">🔋{r.doorLockBattery}%</div>}
              </div>
            </div>
            {(can || isGuest) && (
              <button onClick={handleDoorUnlock} disabled={doorCountdown > 0}
                className={`btn w-full transition ${doorCountdown > 0 ? 'bg-amber-50 text-amber-600 border border-amber-200 cursor-default' : 'btn-ghost'}`}>
                {doorCountdown > 0 ? `🔓 Unlocked — auto-locking in ${doorCountdown}s` : '🔓 Unlock Door'}
              </button>
            )}
          </Section>

          {/* Lines & Dimmers */}
          {(can || isGuest) && !r.pdMode && (
            <Section title="💡 Lines & Dimmers">
              {[['line1', 'Line 1 (Main)'], ['line2', 'Line 2 (Bedside)'], ['line3', 'Line 3 (Bath)']].map(([k, l]) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-gray-600">{l}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => send('setLines', { [k]: !r[k] })}
                      className={`toggle ${r[k] ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                      <div className={`toggle-knob ${r[k] ? 'translate-x-5' : ''}`} />
                    </button>
                    <span className={`text-[10px] font-semibold w-6 ${r[k] ? 'text-emerald-500' : 'text-gray-300'}`}>
                      {r[k] ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              ))}
              {['dimmer1', 'dimmer2'].map((k, i) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-gray-600">Dimmer {i + 1}</span>
                  <div className="flex items-center gap-2 flex-1 ml-4">
                    <input type="range" min="0" max="100" value={r[k] || 0}
                      onChange={e => send('setLines', { [k]: +e.target.value })}
                      className="flex-1 accent-brand-500 h-1.5" />
                    <span className="text-xs font-mono text-brand-500 w-8 text-right">{r[k] || 0}%</span>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* AC */}
          {(can || isGuest) && !r.pdMode && (
            <Section title="❄ AC">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Mode</span>
                  <div className="flex gap-1">
                    {AC_MODES.map((m, i) => (
                      <button key={i} onClick={() => send('setAC', { acMode: i })}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                          r.acMode === i ? 'text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                        style={r.acMode === i ? { background: MODE_COLORS[i] } : {}}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Temp</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => adjTemp(-0.5)} className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-lg font-bold text-gray-500 transition">−</button>
                    <span className="text-lg font-bold font-mono text-blue-500 w-12 text-center">
                      {Math.round((r.acTemperatureSet ?? 22) * 2) / 2}°
                    </span>
                    <button onClick={() => adjTemp(0.5)} className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 text-lg font-bold text-gray-500 transition">+</button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Fan</span>
                  <div className="flex gap-1">
                    {FAN_SPEEDS.map((f, i) => (
                      <button key={i} onClick={() => send('setAC', { fanSpeed: i })}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition ${
                          (r.fanSpeed ?? 3) === i ? 'bg-cyan-500 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* Curtains */}
          {(can || isGuest) && !r.pdMode && (
            <Section title="🪟 Curtains & Blinds">
              {[['curtainsPosition', 'Curtains'], ['blindsPosition', 'Blinds']].map(([k, l]) => (
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
          )}

          {/* Services — DND/MUR/SOS */}
          <Section title="🛎 Services">
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

          {/* Consumption — staff only */}
          {!isGuest && (
            <Section title="⚡ Consumption">
              <div className="grid grid-cols-2 gap-4 text-center">
                <Stat label="kWh" value={(r.elecConsumption || 0).toFixed(2)} color="text-amber-500" />
                <Stat label="m³" value={(r.waterConsumption || 0).toFixed(3)} color="text-blue-500" />
              </div>
            </Section>
          )}

          {/* Device info */}
          {can && (
            <Section title="📶 Device">
              <div className="text-[10px] text-gray-500">
                FW: {r.firmwareVersion || '—'} · GW: {r.gatewayVersion || '—'}
              </div>
              {r.deviceId && <div className="text-[7px] text-gray-300 font-mono mt-1">{r.deviceId}</div>}
            </Section>
          )}

          {/* Room status — all staff roles */}
          {isStaff && (
            <Section title="🏷 Set Status">
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
        </div>
      </div>
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
