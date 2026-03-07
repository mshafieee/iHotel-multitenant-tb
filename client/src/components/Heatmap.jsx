import { useState, useMemo } from 'react';
import useHotelStore from '../store/hotelStore';

// 0=VACANT 1=OCCUPIED 2=SERVICE 3=MAINTENANCE 4=NOT_OCCUPIED
const STATUS_COLORS = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];
const STATUS_FULL   = ['Vacant', 'Occupied', 'Service', 'Maintenance', 'Not Occupied'];

const TYPE_ABBR = { STANDARD: 'STDR', DELUXE: 'DLXE', SUITE: 'SUITE', VIP: 'VIP' };

export default function Heatmap({ onSelectRoom, cols = 0 }) {
  const rooms = useHotelStore(s => s.rooms);
  const [hoveredRoom, setHoveredRoom] = useState(null);

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

  if (floors.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-gray-400">
        No rooms configured yet. Add rooms from the Platform Admin portal.
      </div>
    );
  }

  const hovered = hoveredRoom ? rooms[hoveredRoom] : null;

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-bold text-gray-700">Room Heatmap</div>
          <div className="text-[10px] text-gray-400">{totalRooms} rooms · {floors.length} floors</div>
        </div>
        {/* Legend */}
        <div className="flex gap-3 flex-wrap justify-end">
          {STATUS_FULL.map((label, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: STATUS_COLORS[i] }} />
              <span className="text-[10px] text-gray-500">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#1E293B' }} />
            <span className="text-[10px] text-gray-500">⚡ PD</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-gray-200 opacity-50" />
            <span className="text-[10px] text-gray-400">Offline</span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="space-y-2 overflow-x-auto pb-2">
        {floors.map(f => {
          const floorRooms = roomsByFloor[f] || [];
          return (
            <div key={f} className="flex items-center gap-2">
              {/* Floor label */}
              <div className="w-10 shrink-0 text-right">
                <div className="text-xs font-bold text-gray-600">F{f}</div>
                <div className="text-[9px] text-gray-300">{floorRooms.length}rm</div>
              </div>

              {/* Room cells */}
              <div
                style={cols > 0 ? { display: 'grid', gridTemplateColumns: `repeat(${cols}, 5.5rem)`, gap: '4px' } : {}}
                className={cols > 0 ? '' : 'flex gap-1 flex-wrap'}
              >
                {floorRooms.map(rn => {
                  const r = rooms[rn];
                  const status   = r ? (r.roomStatus ?? 0) : 0;
                  const isSOS    = r ? !!r.sosService : false;
                  const isMUR    = r ? !!r.murService : false;
                  const isDND    = r ? !!r.dndService : false;
                  const isPD     = r ? !!r.pdMode : false;
                  const isOnline = r ? !!r.online : false;
                  const isDoor   = r ? !!r.doorStatus : false;
                  const isPIR    = r ? !!r.pirMotionStatus : false;
                  const temp     = r?.temperature ?? null;

                  // Priority: SOS > PD > normal status
                  const bgColor = r
                    ? (isSOS ? '#DC2626' : isPD ? '#1E293B' : STATUS_COLORS[Math.min(status, 4)])
                    : '#E5E7EB';

                  const isHov = hoveredRoom === rn;

                  return (
                    <button
                      key={rn}
                      onClick={() => onSelectRoom(rn)}
                      onMouseEnter={() => setHoveredRoom(rn)}
                      onMouseLeave={() => setHoveredRoom(null)}
                      style={{
                        background: bgColor,
                        width: '5.5rem',
                        height: '4.5rem',
                        minWidth: '5.5rem',
                        opacity: isOnline ? 1 : 0.45,
                      }}
                      className={`relative flex flex-col items-center justify-center rounded-xl border-2 transition-all duration-150 select-none
                        ${isHov ? 'scale-110 z-10 shadow-xl border-white' : 'border-transparent hover:scale-105'}
                        ${isSOS || isPD ? 'animate-pulse' : ''}`}
                    >
                      {/* Room number */}
                      <span className="text-[15px] font-extrabold text-white leading-none tracking-tight drop-shadow">
                        {rn}
                      </span>

                      {/* Room type abbreviation */}
                      {r?.type && (
                        <span className="text-[7px] font-bold text-white/55 leading-none tracking-widest uppercase">
                          {TYPE_ABBR[r.type] ?? r.type}
                        </span>
                      )}

                      {/* Temperature / flag row */}
                      <div className="flex items-center gap-0.5 mt-0.5">
                        {!isPD && temp !== null && (
                          <span className="text-[11px] text-white/90 font-semibold font-mono">
                            {Math.round(temp)}°
                          </span>
                        )}
                        {isPD  && <span className="text-[12px]">⚡</span>}
                        {isSOS && <span className="text-[11px]">🚨</span>}
                        {!isSOS && !isPD && isMUR && <span className="text-[11px]">🧹</span>}
                        {!isSOS && !isPD && !isMUR && isDND && <span className="text-[11px]">🔕</span>}
                      </div>

                      {/* Door open dot — top-right */}
                      {isDoor && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-yellow-300 border border-white shadow" />
                      )}

                      {/* PIR motion dot — top-left */}
                      {isPIR && (
                        <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-cyan-300 border border-white shadow" />
                      )}

                      {/* Offline bar — bottom */}
                      {!isOnline && (
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/20 rounded-b-xl" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed detail strip — always rendered, shows info on hover */}
      <div className="mt-3 px-4 py-2 rounded-xl border border-gray-100 bg-gray-50 min-h-[2.25rem] flex flex-wrap items-center gap-4 text-xs text-gray-600">
        {hovered && hoveredRoom ? (
          <>
            <span className="font-bold text-gray-800 text-sm">Room {hoveredRoom}</span>
            <span>Floor {hovered.floor}</span>
            <span className="text-gray-400">{hovered.roomType}</span>
            <span className="font-semibold" style={{ color: STATUS_COLORS[hovered.roomStatus ?? 0] }}>
              {STATUS_FULL[hovered.roomStatus ?? 0]}
            </span>
            {hovered.temperature != null && <span>🌡 {hovered.temperature}°C</span>}
            {hovered.humidity != null && <span>💧 {hovered.humidity}%</span>}
            <span>🚪 {hovered.doorStatus ? 'Open' : 'Closed'}</span>
            {hovered.pdMode && <span className="font-bold" style={{ color: '#1E293B' }}>⚡ Power Down</span>}
            <span className={hovered.online ? 'text-emerald-500 font-semibold' : 'text-gray-400'}>
              {hovered.online ? '● Live' : '○ Offline'}
            </span>
            {hovered.reservation && (
              <span className="text-brand-500 font-semibold">👤 {hovered.reservation.guestName}</span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
