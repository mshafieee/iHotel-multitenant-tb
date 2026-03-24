import { useState, useMemo, memo } from 'react';
import useHotelStore from '../store/hotelStore';

// 0=VACANT 1=OCCUPIED 2=SERVICE 3=MAINTENANCE 4=NOT_OCCUPIED 5=RESERVED(display only)
const STATUS_COLORS = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6', '#0891B2'];
const STATUS_FULL   = ['Vacant', 'Occupied', 'Service', 'Maintenance', 'Not Occupied', 'Reserved'];

// Returns display status index — VACANT rooms with a reservation show as RESERVED (5)
const effectiveStatus = (r) => (r?.roomStatus === 0 && r?.reservation) ? 5 : (r?.roomStatus ?? 0);
const TYPE_ABBR     = { STANDARD: 'Std', DELUXE: 'Dlx', SUITE: 'Ste', VIP: 'VIP' };
const TYPE_KEYS     = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];

// ── Circular progress arc ────────────────────────────────────────────────────
function ArcProgress({ pct, size = 52, stroke = 5 }) {
  const r   = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  const color = pct > 60 ? '#16A34A' : pct > 30 ? '#D97706' : '#DC2626';
  return (
    <svg width={size} height={size} className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle"
        style={{ fontSize: 10, fontWeight: 700, fill: color, fontFamily: 'monospace' }}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

// ── Floor summary box — receives pre-computed stats, wrapped with memo ────────
// Stats are computed once in the parent per floor; this component only
// re-renders when its specific floor's stats object changes reference.
const FloorBox = memo(function FloorBox({ floorNum, stats, isExpanded, onClick }) {

  const hasSOS = stats.sos > 0;
  const border = hasSOS ? 'border-red-400 animate-pulse' : isExpanded ? 'border-brand-400' : 'border-gray-200 hover:border-brand-300';
  const vacantTypes = TYPE_KEYS.filter(k => stats.byType[k] > 0);

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-between rounded-2xl border-2 bg-white p-3 shadow-sm transition-all duration-200 select-none
        ${border} ${isExpanded ? 'bg-brand-50 shadow-md' : 'hover:shadow-md'}
      `}
      style={{ width: 120, minHeight: 130 }}
    >
      {/* Floor label */}
      <div className="flex items-center justify-between w-full mb-1">
        <span className="text-xs font-extrabold text-gray-700">F{floorNum}</span>
        <span className="text-[9px] text-gray-400">{stats.total} rm</span>
      </div>

      {/* Arc chart — vacant % */}
      <ArcProgress pct={stats.vacantPct} size={52} stroke={5} />

      {/* Vacant count */}
      <div className="text-[10px] text-gray-500 mt-1 font-semibold">{stats.vacant} free</div>

      {/* Type breakdown of vacant rooms */}
      {vacantTypes.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-center mt-1">
          {vacantTypes.map(k => (
            <span key={k} className="text-[8px] bg-emerald-50 text-emerald-600 rounded px-1 font-bold">
              {TYPE_ABBR[k]}:{stats.byType[k]}
            </span>
          ))}
        </div>
      )}

      {/* Alert badges */}
      {(hasSOS || stats.mur > 0 || stats.pd > 0) && (
        <div className="flex gap-1 mt-1">
          {hasSOS       && <span className="text-[9px] bg-red-100 text-red-600 rounded px-1 font-bold">🚨{stats.sos}</span>}
          {stats.mur > 0 && <span className="text-[9px] bg-amber-100 text-amber-600 rounded px-1 font-bold">🧹{stats.mur}</span>}
          {stats.pd > 0  && <span className="text-[9px] bg-slate-100 text-slate-600 rounded px-1 font-bold">⚡{stats.pd}</span>}
        </div>
      )}

      {/* Expand indicator */}
      <div className={`absolute bottom-1 right-2 text-[9px] text-gray-300 ${isExpanded ? 'text-brand-400' : ''}`}>
        {isExpanded ? '▲' : '▼'}
      </div>
    </button>
  );
});

// ── Room card (individual cell) — receives single room object, wrapped with memo
// Only re-renders when THIS room's data or hover state changes.
const RoomCell = memo(function RoomCell({ rn, r, onSelectRoom, hoveredRoom, setHoveredRoom }) {
  const status   = r ? effectiveStatus(r) : 0;
  const isSOS    = r ? !!r.sosService : false;
  const isMUR    = r ? !!r.murService : false;
  const isDND    = r ? !!r.dndService : false;
  const isPD     = r ? !!r.pdMode : false;
  const isOnline = r ? !!r.online : false;
  const isDoor   = r ? !!r.doorStatus : false;
  const isPIR    = r ? !!r.pirMotionStatus : false;
  const temp     = r?.temperature ?? null;

  const bgColor = r
    ? (isSOS ? '#DC2626' : isPD ? '#1E293B' : STATUS_COLORS[Math.min(status, STATUS_COLORS.length - 1)])
    : '#E5E7EB';
  const isHov = hoveredRoom === rn;

  return (
    <button
      key={rn}
      onClick={() => onSelectRoom(rn)}
      onMouseEnter={() => setHoveredRoom(rn)}
      onMouseLeave={() => setHoveredRoom(null)}
      style={{ background: bgColor, width: '5.5rem', height: '4.5rem', minWidth: '5.5rem', opacity: isOnline ? 1 : 0.45 }}
      className={`relative flex flex-col items-center justify-center rounded-xl border-2 transition-all duration-150 select-none
        ${isHov ? 'scale-110 z-10 shadow-xl border-white' : 'border-transparent hover:scale-105'}
        ${isSOS || isPD ? 'animate-pulse' : ''}`}
    >
      <span className="text-[15px] font-extrabold text-white leading-none tracking-tight drop-shadow">{rn}</span>
      {r?.type && (
        <span className="text-[7px] font-bold text-white/55 leading-none tracking-widest uppercase">{TYPE_ABBR[r.type] ?? r.type}</span>
      )}
      <div className="flex items-center gap-0.5 mt-0.5">
        {!isPD && temp !== null && <span className="text-[11px] text-white/90 font-semibold font-mono">{Math.round(temp)}°</span>}
        {isPD  && <span className="text-[12px]">⚡</span>}
        {isSOS && <span className="text-[11px]">🚨</span>}
        {!isSOS && !isPD && isMUR && <span className="text-[11px]">🧹</span>}
        {!isSOS && !isPD && !isMUR && isDND && <span className="text-[11px]">🔕</span>}
      </div>
      {isDoor && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-yellow-300 border border-white shadow" />}
      {isPIR  && <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-cyan-300 border border-white shadow" />}
      {!isOnline && <div className="absolute bottom-0 inset-x-0 h-1 bg-black/20 rounded-b-xl" />}
    </button>
  );
});

// ── Main component ───────────────────────────────────────────────────────────
export default function Heatmap({ onSelectRoom, cols = 0 }) {
  const rooms = useHotelStore(s => s.rooms);
  const [hoveredRoom, setHoveredRoom]       = useState(null);
  const [viewMode, setViewMode]             = useState('floors'); // 'floors' | 'rooms'
  const [expandedFloor, setExpandedFloor]   = useState(null);

  const { floors, roomsByFloor, totalRooms } = useMemo(() => {
    const keys = Object.keys(rooms)
      .map(Number)
      .filter(n => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);

    if (keys.length === 0) return { floors: [], roomsByFloor: {}, totalRooms: 0 };

    const byFloor = {};
    keys.forEach(rn => {
      const floor = rooms[String(rn)]?.floor ?? Math.floor(rn / 100);
      if (!byFloor[floor]) byFloor[floor] = [];
      byFloor[floor].push(String(rn));
    });

    const floorList = Object.keys(byFloor).map(Number).sort((a, b) => b - a);
    return { floors: floorList, roomsByFloor: byFloor, totalRooms: keys.length };
  }, [rooms]);

  // Pre-compute per-floor stats so FloorBox components don't each iterate the
  // full rooms map — they receive a plain stats object and only re-render when
  // their floor's stats change (guarded by React.memo).
  const floorStats = useMemo(() => {
    const out = {};
    for (const f of Object.keys(roomsByFloor).map(Number)) {
      const floorRooms = roomsByFloor[f] || [];
      const s = { total: floorRooms.length, vacant: 0, occupied: 0, sos: 0, mur: 0, pd: 0, byType: {} };
      TYPE_KEYS.forEach(k => { s.byType[k] = 0; });
      floorRooms.forEach(rn => {
        const r = rooms[rn];
        if (!r) return;
        if (r.sosService)       s.sos++;
        if (r.murService)       s.mur++;
        if (r.pdMode)           s.pd++;
        if (r.roomStatus === 1) s.occupied++;
        if (r.roomStatus === 0) { s.vacant++; if (r.type) s.byType[r.type] = (s.byType[r.type] || 0) + 1; }
      });
      s.vacantPct = s.total > 0 ? (s.vacant / s.total) * 100 : 0;
      out[f] = s;
    }
    return out;
  }, [rooms, roomsByFloor]);

  if (floors.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-gray-400">
        No rooms configured yet. Add rooms from the Platform Admin portal.
      </div>
    );
  }

  const hovered = hoveredRoom ? rooms[hoveredRoom] : null;

  const toggleFloor = (f) => setExpandedFloor(prev => prev === f ? null : f);

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-bold text-gray-700">Room Heatmap</div>
          <div className="text-[10px] text-gray-400">{totalRooms} rooms · {floors.length} floors</div>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            <button
              onClick={() => setViewMode('floors')}
              className={`px-3 py-1.5 text-[10px] font-bold transition ${viewMode === 'floors' ? 'bg-brand-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              ⊞ Floors
            </button>
            <button
              onClick={() => setViewMode('rooms')}
              className={`px-3 py-1.5 text-[10px] font-bold transition ${viewMode === 'rooms' ? 'bg-brand-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              ⊟ Rooms
            </button>
          </div>
          {/* Legend — rooms mode */}
          {viewMode === 'rooms' && (
            <div className="hidden sm:flex gap-2 flex-wrap justify-end">
              {STATUS_FULL.map((label, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS[i] }} />
                  <span className="text-[10px] text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── FLOORS VIEW ── */}
      {viewMode === 'floors' && (
        <div className="space-y-3">
          {/* Floor boxes grid */}
          <div className="flex gap-3 flex-wrap">
            {floors.map(f => (
              <FloorBox
                key={f}
                floorNum={f}
                stats={floorStats[f] || { total: 0, vacant: 0, sos: 0, mur: 0, pd: 0, byType: {}, vacantPct: 0 }}
                isExpanded={expandedFloor === f}
                onClick={() => toggleFloor(f)}
              />
            ))}
          </div>

          {/* Expanded floor rooms */}
          {expandedFloor !== null && roomsByFloor[expandedFloor] && (
            <div className="border border-brand-100 rounded-2xl p-3 bg-brand-50/30">
              <div className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-2">
                Floor {expandedFloor} — {roomsByFloor[expandedFloor].length} rooms
              </div>
              <div
                style={cols > 0 ? { display: 'grid', gridTemplateColumns: `repeat(${cols}, 5.5rem)`, gap: '6px' } : {}}
                className={cols > 0 ? '' : 'flex gap-1.5 flex-wrap'}
              >
                {roomsByFloor[expandedFloor].map(rn => (
                  <RoomCell
                    key={rn}
                    rn={rn}
                    r={rooms[rn]}
                    onSelectRoom={onSelectRoom}
                    hoveredRoom={hoveredRoom}
                    setHoveredRoom={setHoveredRoom}
                  />
                ))}
              </div>
              {/* Hover detail */}
              {hovered && hoveredRoom && roomsByFloor[expandedFloor].includes(hoveredRoom) && (
                <div className="mt-3 px-3 py-2 rounded-xl border border-gray-100 bg-white flex flex-wrap items-center gap-3 text-xs text-gray-600">
                  <span className="font-bold text-gray-800">Room {hoveredRoom}</span>
                  <span className="text-gray-400">{hovered.roomType}</span>
                  <span className="font-semibold" style={{ color: STATUS_COLORS[effectiveStatus(hovered)] }}>
                    {STATUS_FULL[effectiveStatus(hovered)]}
                  </span>
                  {hovered.temperature != null && <span>🌡 {hovered.temperature}°C</span>}
                  {hovered.humidity    != null && <span>💧 {hovered.humidity}%</span>}
                  <span>🚪 {hovered.doorStatus ? 'Open' : 'Closed'}</span>
                  {hovered.pdMode && <span className="font-bold text-slate-700">⚡ PD</span>}
                  <span className={hovered.online ? 'text-emerald-500 font-semibold' : 'text-gray-400'}>
                    {hovered.online ? '● Live' : '○ Offline'}
                  </span>
                  {hovered.reservation && (
                    <span className="text-brand-500 font-semibold">👤 {hovered.reservation.guestName}</span>
                  )}
                  {hovered.reservation?.checkOut && hovered.roomStatus !== 3 && (
                    <span className="text-amber-600 font-semibold">↩ {hovered.reservation.checkOut}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ROOMS VIEW (legacy all-rooms heatmap) ── */}
      {viewMode === 'rooms' && (
        <div className="space-y-2 overflow-x-auto pb-2">
          {floors.map(f => {
            const floorRooms = roomsByFloor[f] || [];
            return (
              <div key={f} className="flex items-start gap-2">
                <div className="w-10 shrink-0 text-right pt-3">
                  <div className="text-xs font-bold text-gray-600">F{f}</div>
                  <div className="text-[9px] text-gray-300">{floorRooms.length}rm</div>
                </div>
                <div
                  style={cols > 0 ? { display: 'grid', gridTemplateColumns: `repeat(${cols}, 5.5rem)`, gap: '4px' } : {}}
                  className={cols > 0 ? '' : 'flex gap-1 flex-wrap'}
                >
                  {floorRooms.map(rn => (
                    <RoomCell
                      key={rn}
                      rn={rn}
                      r={rooms[rn]}
                      onSelectRoom={onSelectRoom}
                      hoveredRoom={hoveredRoom}
                      setHoveredRoom={setHoveredRoom}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {/* Hover detail */}
          <div className="mt-2 px-4 py-2 rounded-xl border border-gray-100 bg-gray-50 min-h-[2.25rem] flex flex-wrap items-center gap-4 text-xs text-gray-600">
            {hovered && hoveredRoom ? (
              <>
                <span className="font-bold text-gray-800 text-sm">Room {hoveredRoom}</span>
                <span>Floor {hovered.floor}</span>
                <span className="text-gray-400">{hovered.roomType}</span>
                <span className="font-semibold" style={{ color: STATUS_COLORS[hovered.roomStatus ?? 0] }}>
                  {STATUS_FULL[hovered.roomStatus ?? 0]}
                </span>
                {hovered.temperature != null && <span>🌡 {hovered.temperature}°C</span>}
                {hovered.humidity    != null && <span>💧 {hovered.humidity}%</span>}
                <span>🚪 {hovered.doorStatus ? 'Open' : 'Closed'}</span>
                {hovered.pdMode && <span className="font-bold text-slate-700">⚡ PD</span>}
                <span className={hovered.online ? 'text-emerald-500 font-semibold' : 'text-gray-400'}>
                  {hovered.online ? '● Live' : '○ Offline'}
                </span>
                {hovered.reservation && (
                  <span className="text-brand-500 font-semibold">👤 {hovered.reservation.guestName}</span>
                )}
                {hovered.reservation?.checkOut && hovered.roomStatus !== 3 && (
                  <span className="text-amber-600 font-semibold">↩ {hovered.reservation.checkOut}</span>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
