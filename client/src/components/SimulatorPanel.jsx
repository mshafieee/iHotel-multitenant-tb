import React, { useState, useEffect, useCallback } from 'react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';

// ── Constants matching server ────────────────────────────────────────────────
const AC_MODES   = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS = ['LOW', 'MED', 'HIGH', 'AUTO'];
const ROOM_STATUSES = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const STATUS_COLORS = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];

// ── Quick scenario presets ───────────────────────────────────────────────────
const PRESETS = [
  {
    label: '🚪 Guest Check-In',
    desc: 'Door open → OCCUPIED, motion detected',
    telemetry: { roomStatus: 1, doorStatus: true, pirMotionStatus: true, line1: true, acMode: 1, acTemperatureSet: 22, fanSpeed: 2 },
  },
  {
    label: '🌙 Night Mode',
    desc: 'Guest sleeping, all lights off, AC cool',
    telemetry: { pirMotionStatus: false, doorStatus: false, line1: false, line2: false, line3: false, acMode: 1, acTemperatureSet: 20, fanSpeed: 0 },
  },
  {
    label: '🟣 Not Occupied',
    desc: 'No motion 5+ min, energy-save mode',
    telemetry: { roomStatus: 4, pirMotionStatus: false, doorStatus: false, line1: false, line2: false, line3: false, acTemperatureSet: 26 },
  },
  {
    label: '🚨 SOS Alert',
    desc: 'Guest triggered emergency',
    telemetry: { sosService: true, pirMotionStatus: true },
  },
  {
    label: '🧹 MUR Request',
    desc: 'Guest requests housekeeping',
    telemetry: { murService: true },
  },
  {
    label: '🌡 High CO₂',
    desc: 'Poor air quality scenario',
    telemetry: { co2: 1600, temperature: 29, humidity: 72 },
  },
  {
    label: '🏠 Empty Room',
    desc: 'VACANT, all devices off',
    telemetry: { roomStatus: 0, pirMotionStatus: false, doorStatus: false, line1: false, line2: false, line3: false, acMode: 0, dndService: false, murService: false, sosService: false, pdMode: false },
  },
  {
    label: '🔧 Maintenance',
    desc: 'Set room to MAINTENANCE status',
    telemetry: { roomStatus: 3 },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, label, color = 'emerald' }) {
  const on = !!value;
  return (
    <button onClick={() => onChange(!on)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${on
        ? `bg-${color}-50 text-${color}-600 border-${color}-200`
        : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
      <span className={`w-2 h-2 rounded-full ${on ? `bg-${color}-500` : 'bg-gray-300'}`} />
      {label}
    </button>
  );
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-gray-500 w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        className="flex-1 accent-brand-500 h-1.5" />
      <span className="text-xs font-mono text-brand-500 w-14 text-right font-semibold">{value}{unit}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3 space-y-2">
      <div className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">{title}</div>
      {children}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────
export default function SimulatorPanel() {
  const rooms = useHotelStore(s => s.rooms);

  const [roomNum, setRoomNum] = useState('101');
  const [roomInput, setRoomInput] = useState('101');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null); // { ok, msg }
  const [tbMode, setTbMode] = useState(false); // false = Direct, true = ThingsBoard native
  const [log, setLog] = useState([]);

  // ── Sensor state ──────────────────────────────────────────────────────────
  const [temperature, setTemperature]   = useState(22);
  const [humidity, setHumidity]         = useState(45);
  const [co2, setCo2]                   = useState(600);
  const [pir, setPir]                   = useState(false);
  const [door, setDoor]                 = useState(false);
  const [elec, setElec]                 = useState(0);
  const [water, setWater]               = useState(0);

  // ── Control state ─────────────────────────────────────────────────────────
  const [roomStatus, setRoomStatus]     = useState(0);
  const [line1, setLine1]               = useState(false);
  const [line2, setLine2]               = useState(false);
  const [line3, setLine3]               = useState(false);
  const [dimmer1, setDimmer1]           = useState(0);
  const [dimmer2, setDimmer2]           = useState(0);
  const [acMode, setAcMode]             = useState(0);
  const [acTemp, setAcTemp]             = useState(22);
  const [fanSpeed, setFanSpeed]         = useState(0);
  const [curtains, setCurtains]         = useState(0);
  const [blinds, setBlinds]             = useState(0);
  const [dnd, setDnd]                   = useState(false);
  const [mur, setMur]                   = useState(false);
  const [sos, setSos]                   = useState(false);
  const [pd, setPd]                     = useState(false);

  // Load current live values when room changes
  const loadRoom = useCallback((rn) => {
    const r = rooms[rn];
    if (!r) return;
    setTemperature(r.temperature   ?? 22);
    setHumidity(r.humidity         ?? 45);
    setCo2(r.co2                   ?? 600);
    setPir(!!r.pirMotionStatus);
    setDoor(!!r.doorStatus);
    setElec(r.elecConsumption      ?? 0);
    setWater(r.waterConsumption    ?? 0);
    setRoomStatus(r.roomStatus     ?? 0);
    setLine1(!!r.line1);
    setLine2(!!r.line2);
    setLine3(!!r.line3);
    setDimmer1(r.dimmer1           ?? 0);
    setDimmer2(r.dimmer2           ?? 0);
    setAcMode(r.acMode             ?? 0);
    setAcTemp(r.acTemperatureSet   ?? 22);
    setFanSpeed(r.fanSpeed         ?? 0);
    setCurtains(r.curtainsPosition ?? 0);
    setBlinds(r.blindsPosition     ?? 0);
    setDnd(!!r.dndService);
    setMur(!!r.murService);
    setSos(!!r.sosService);
    setPd(!!r.pdMode);
  }, [rooms]);

  const applyRoom = () => {
    const rn = roomInput.trim();
    setRoomNum(rn);
    loadRoom(rn);
  };

  // Auto-load when rooms data arrives for the current room
  useEffect(() => { if (rooms[roomNum]) loadRoom(roomNum); }, [roomNum]); // eslint-disable-line

  const addLog = (ok, room, keys) => {
    const entry = { ts: Date.now(), ok, room, keys };
    setLog(prev => [entry, ...prev].slice(0, 30));
  };

  const inject = async (telemetry) => {
    setSending(true);
    setFeedback(null);
    const endpoint = tbMode ? '/api/simulator/tb-inject' : '/api/simulator/inject';
    try {
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ room: roomNum, telemetry }),
      });
      const modeLabel = res.mode === 'thingsboard' ? 'via ThingsBoard' : res.mode === 'virtual-pipeline' ? 'via pipeline (virtual)' : 'direct';
      setFeedback({ ok: true, msg: `Injected ${Object.keys(telemetry).length} key(s) into Room ${roomNum} — ${modeLabel}` });
      addLog(true, roomNum, Object.keys(telemetry));
    } catch (e) {
      setFeedback({ ok: false, msg: `${e.message}` });
      addLog(false, roomNum, Object.keys(telemetry));
    } finally { setSending(false); }
  };

  const injectAll = () => inject({
    temperature, humidity, co2,
    pirMotionStatus: pir, doorStatus: door,
    elecConsumption: elec, waterConsumption: water,
    roomStatus, line1, line2, line3, dimmer1, dimmer2,
    acMode, acTemperatureSet: acTemp, fanSpeed,
    curtainsPosition: curtains, blindsPosition: blinds,
    dndService: dnd, murService: mur, sosService: sos, pdMode: pd,
  });

  const applyPreset = (preset) => {
    // Update local state from preset
    const t = preset.telemetry;
    if ('temperature'    in t) setTemperature(t.temperature);
    if ('humidity'       in t) setHumidity(t.humidity);
    if ('co2'            in t) setCo2(t.co2);
    if ('pirMotionStatus'in t) setPir(t.pirMotionStatus);
    if ('doorStatus'     in t) setDoor(t.doorStatus);
    if ('elecConsumption'in t) setElec(t.elecConsumption);
    if ('waterConsumption'in t) setWater(t.waterConsumption);
    if ('roomStatus'     in t) setRoomStatus(t.roomStatus);
    if ('line1'          in t) setLine1(t.line1);
    if ('line2'          in t) setLine2(t.line2);
    if ('line3'          in t) setLine3(t.line3);
    if ('acMode'         in t) setAcMode(t.acMode);
    if ('acTemperatureSet'in t) setAcTemp(t.acTemperatureSet);
    if ('fanSpeed'       in t) setFanSpeed(t.fanSpeed);
    if ('curtainsPosition'in t) setCurtains(t.curtainsPosition);
    if ('blindsPosition' in t) setBlinds(t.blindsPosition);
    if ('dndService'     in t) setDnd(t.dndService);
    if ('murService'     in t) setMur(t.murService);
    if ('sosService'     in t) setSos(t.sosService);
    if ('pdMode'         in t) setPd(t.pdMode);
    // Immediately inject just the preset keys
    inject(t);
  };

  const liveRoom = rooms[roomNum];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Gateway Simulator</div>
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setTbMode(false)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition ${!tbMode ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              Direct
            </button>
            <button onClick={() => setTbMode(true)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition ${tbMode ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              ThingsBoard
            </button>
          </div>
        </div>
        {tbMode && (
          <div className="mb-3 text-[10px] text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
            <strong>ThingsBoard mode:</strong> telemetry is published to TB as a real device would.
            Data flows back via WebSocket → scene engine → SSE → UI. Requires a real mapped device.
            Virtual rooms fall back to the direct pipeline automatically.
          </div>
        )}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[9px] text-gray-400 uppercase block mb-1">Room Number</label>
            <div className="flex gap-2">
              <input className="input flex-1" value={roomInput} onChange={e => setRoomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyRoom()}
                placeholder="e.g. 301" />
              <button onClick={applyRoom} className="btn btn-primary px-4">Load</button>
            </div>
          </div>
          {liveRoom && (
            <div className="flex items-center gap-3 pb-0.5">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[liveRoom.roomStatus ?? 0] }} />
                <span className="text-xs font-semibold" style={{ color: STATUS_COLORS[liveRoom.roomStatus ?? 0] }}>
                  {ROOM_STATUSES[liveRoom.roomStatus ?? 0]}
                </span>
              </div>
              <span className="text-xs text-gray-400">{liveRoom.type} · F{liveRoom.floor}</span>
              <span className="text-xs font-mono text-blue-500">{liveRoom.temperature ?? '—'}° / {liveRoom.humidity ?? '—'}%</span>
              <button onClick={() => loadRoom(roomNum)}
                className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold border border-brand-200 rounded px-2 py-0.5">
                ↺ Sync
              </button>
            </div>
          )}
          {!liveRoom && roomNum && (
            <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 pb-1">
              ⚠ Virtual room — no physical device. SSE broadcast only (great for testing!).
            </div>
          )}
        </div>

        {feedback && (
          <div className={`mt-3 text-xs px-3 py-2 rounded-lg font-semibold ${feedback.ok ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-500 border border-red-100'}`}>
            {feedback.msg}
          </div>
        )}
      </div>

      {/* Quick Presets */}
      <div className="card p-4">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-3">Quick Scenarios</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => applyPreset(p)} disabled={sending}
              className="text-left p-2.5 rounded-xl border border-gray-100 bg-gray-50 hover:bg-brand-50 hover:border-brand-200 transition group disabled:opacity-50">
              <div className="text-xs font-semibold text-gray-700 group-hover:text-brand-600">{p.label}</div>
              <div className="text-[9px] text-gray-400 mt-0.5 leading-tight">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-3">

          {/* Sensors */}
          <Section title="🌡 Environmental Sensors">
            <Slider label="Temperature" value={temperature} min={15} max={45} step={0.5} unit="°C" onChange={setTemperature} />
            <Slider label="Humidity" value={humidity} min={10} max={99} unit="%" onChange={setHumidity} />
            <Slider label="CO₂" value={co2} min={400} max={2000} step={50} unit=" ppm" onChange={setCo2} />
            <div className="flex gap-2 pt-1 flex-wrap">
              <Toggle value={pir} onChange={setPir} label="PIR Motion" color="blue" />
              <Toggle value={door} onChange={setDoor} label="Door Open" color="amber" />
            </div>
            <button onClick={() => inject({ temperature, humidity, co2, pirMotionStatus: pir, doorStatus: door })}
              disabled={sending} className="btn btn-ghost w-full text-xs mt-1">
              Apply Sensors
            </button>
          </Section>

          {/* Consumption */}
          <Section title="⚡ Consumption Meters">
            <Slider label="Electric" value={parseFloat(elec.toFixed(2))} min={0} max={500} step={0.1} unit=" kWh" onChange={setElec} />
            <Slider label="Water" value={parseFloat(water.toFixed(3))} min={0} max={50} step={0.01} unit=" m³" onChange={setWater} />
            <div className="flex gap-2 mt-1">
              <button onClick={() => inject({ elecConsumption: elec, waterConsumption: water })}
                disabled={sending} className="btn btn-ghost flex-1 text-xs">Apply Meters</button>
              <button onClick={() => { setElec(0); setWater(0); inject({ elecConsumption: 0, waterConsumption: 0 }); }}
                disabled={sending} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition">
                Reset to 0
              </button>
            </div>
          </Section>

          {/* Room Status */}
          <Section title="🏷 Room Status">
            <div className="flex flex-wrap gap-1.5">
              {ROOM_STATUSES.map((s, i) => (
                <button key={i} onClick={() => { setRoomStatus(i); inject({ roomStatus: i }); }}
                  disabled={sending}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold border transition disabled:opacity-50"
                  style={{
                    background: roomStatus === i ? STATUS_COLORS[i] + '18' : '#F9FAFB',
                    color: roomStatus === i ? STATUS_COLORS[i] : '#9CA3AF',
                    borderColor: roomStatus === i ? STATUS_COLORS[i] + '44' : '#E5E7EB',
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </Section>

          {/* Services */}
          <Section title="🛎 Service Flags">
            <div className="flex gap-2 flex-wrap">
              <Toggle value={dnd} onChange={v => { setDnd(v); inject({ dndService: v }); }} label="🔕 DND" color="orange" />
              <Toggle value={mur} onChange={v => { setMur(v); inject({ murService: v }); }} label="🧹 MUR" color="amber" />
              <Toggle value={sos} onChange={v => { setSos(v); inject({ sosService: v }); }} label="🚨 SOS" color="red" />
              <Toggle value={pd}  onChange={v => { setPd(v);  inject({ pdMode: v }); }}    label="⚡ PD"  color="red" />
            </div>
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-3">

          {/* Lighting */}
          <Section title="💡 Lighting">
            <div className="flex gap-2 flex-wrap mb-2">
              <Toggle value={line1} onChange={setLine1} label="Line 1" />
              <Toggle value={line2} onChange={setLine2} label="Line 2" />
              <Toggle value={line3} onChange={setLine3} label="Line 3" />
            </div>
            <Slider label="Dimmer 1" value={dimmer1} min={0} max={100} unit="%" onChange={setDimmer1} />
            <Slider label="Dimmer 2" value={dimmer2} min={0} max={100} unit="%" onChange={setDimmer2} />
            <button onClick={() => inject({ line1, line2, line3, dimmer1, dimmer2 })}
              disabled={sending} className="btn btn-ghost w-full text-xs mt-1">
              Apply Lighting
            </button>
          </Section>

          {/* AC */}
          <Section title="❄ Air Conditioning">
            <div className="flex gap-1 flex-wrap">
              {AC_MODES.map((m, i) => (
                <button key={i} onClick={() => setAcMode(i)}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold transition border ${acMode === i ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                  {m}
                </button>
              ))}
            </div>
            <Slider label="Set Temp" value={acTemp} min={16} max={30} step={0.5} unit="°C" onChange={setAcTemp} />
            <div className="flex gap-1">
              {FAN_SPEEDS.map((f, i) => (
                <button key={i} onClick={() => setFanSpeed(i)}
                  className={`flex-1 py-1 rounded text-[10px] font-bold transition ${fanSpeed === i ? 'bg-cyan-500 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={() => inject({ acMode, acTemperatureSet: acTemp, fanSpeed })}
              disabled={sending} className="btn btn-ghost w-full text-xs mt-1">
              Apply AC
            </button>
          </Section>

          {/* Curtains */}
          <Section title="🪟 Curtains & Blinds">
            <Slider label="Curtains" value={curtains} min={0} max={100} unit="%" onChange={setCurtains} />
            <Slider label="Blinds" value={blinds} min={0} max={100} unit="%" onChange={setBlinds} />
            <button onClick={() => inject({ curtainsPosition: curtains, blindsPosition: blinds })}
              disabled={sending} className="btn btn-ghost w-full text-xs mt-1">
              Apply Curtains
            </button>
          </Section>

          {/* Inject All */}
          <button onClick={injectAll} disabled={sending}
            className="w-full py-3 rounded-xl font-bold text-sm bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-50 shadow-sm">
            {sending ? '⏳ Injecting...' : '🚀 Inject All Values → Room ' + roomNum}
          </button>

          {/* Activity Log */}
          {log.length > 0 && (
            <Section title="📋 Recent Injections">
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {log.map(e => (
                  <div key={e.ts} className="flex items-center gap-2 text-[9px]">
                    <span className={e.ok ? 'text-emerald-500' : 'text-red-400'}>{e.ok ? '✓' : '✗'}</span>
                    <span className="font-mono text-gray-500">{new Date(e.ts).toLocaleTimeString()}</span>
                    <span className="font-semibold text-gray-600">Rm {e.room}</span>
                    <span className="text-gray-400 truncate">{e.keys.join(', ')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
