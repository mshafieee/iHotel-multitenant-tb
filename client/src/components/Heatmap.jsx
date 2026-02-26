import React, { useState } from 'react';
import useHotelStore from '../store/hotelStore';

const STATUS_COLORS = ['#16A34A', '#2563EB', '#06B6D4', '#D97706', '#EC4899', '#F97316', '#DC2626'];
const STATUS_LABELS = ['VAC', 'OCC', 'CLN', 'MNT', 'MKP', 'DND', 'SOS'];
const STATUS_ICONS  = ['🟢', '🔵', '🧹', '🔧', '💄', '🔕', '🚨'];
const ROOM_TYPES_SHORT = { 0: 'STD', 1: 'DLX', 2: 'STE', 3: 'VIP' };
const FLOOR_TYPE = { 1:1, 2:0, 3:0, 4:1, 5:2, 6:0, 7:1, 8:0, 9:2, 10:0, 11:1, 12:0, 13:2, 14:3, 15:3 };

export default function Heatmap({ onSelectRoom }) {
  const rooms = useHotelStore(s => s.rooms);
  const [hoveredRoom, setHoveredRoom] = useState(null);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">
          Room Status — 15 Floors × 20 Rooms
        </div>
        {/* Legend */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_LABELS.map((l, i) => {
            if (l === 'CLN' || l === 'MKP') return null;
            return (
              <div key={i} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS[i] }} />
                <span className="text-[8px] text-gray-400 font-semibold">{l}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1 overflow-x-auto pb-2">
        {Array.from({ length: 15 }, (_, fi) => 15 - fi).map(f => {
          const floorType = ROOM_TYPES_SHORT[FLOOR_TYPE[f]] || 'STD';
          return (
            <div key={f} className="flex items-center gap-1">
              {/* Floor label */}
              <div className="w-14 text-right pr-2 shrink-0">
                <div className="text-[10px] font-bold text-gray-500">F{f}</div>
                <div className="text-[7px] text-gray-300">{floorType}</div>
              </div>

              {/* Room cells */}
              <div className="flex gap-0.5 flex-1">
                {Array.from({ length: 20 }, (_, ri) => ri + 1).map(i => {
                  const rn = String(f * 100 + i);
                  const r = rooms[rn];
                  const status = r?.roomStatus ?? 0;
                  const color = r ? (r.sosService ? STATUS_COLORS[6] : STATUS_COLORS[status]) : '#E5E7EB';
                  const isOnline = r?.online;
                  const isHovered = hoveredRoom === rn;
                  const hasFlag = r?.dndService || r?.murService || r?.sosService;

                  return (
                    <button
                      key={i}
                      onClick={() => onSelectRoom(rn)}
                      onMouseEnter={() => setHoveredRoom(rn)}
                      onMouseLeave={() => setHoveredRoom(null)}
                      className={`relative flex flex-col items-center justify-center rounded-md transition-all duration-150 
                        ${isHovered ? 'scale-110 z-10 shadow-lg ring-2 ring-white' : 'hover:scale-105'}
                        ${r?.sosService ? 'animate-pulse' : ''}
                        ${!isOnline ? 'opacity-30' : ''}`}
                      style={{
                        background: color,
                        width: '3.2rem',
                        height: '2.4rem',
                        minWidth: '3.2rem',
                      }}
                      title={r ? `Room ${rn} · ${STATUS_LABELS[status]} · ${r.temperature ?? '—'}° · ${r.type}` : `Room ${rn}`}
                    >
                      {/* Room number */}
                      <span className="text-[9px] font-bold text-white leading-none">
                        {rn}
                      </span>

                      {/* Status + temp row */}
                      <div className="flex items-center gap-0.5 mt-0.5">
                        {r?.temperature != null && (
                          <span className="text-[7px] text-white/80 font-mono">
                            {Math.round(r.temperature)}°
                          </span>
                        )}
                        {hasFlag && (
                          <span className="text-[7px]">
                            {r.sosService ? '🚨' : r.murService ? '🧹' : '🔕'}
                          </span>
                        )}
                      </div>

                      {/* Door open indicator */}
                      {r?.doorStatus && (
                        <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-yellow-300 rounded-full border border-white" />
                      )}

                      {/* Motion indicator */}
                      {r?.pirMotionStatus && (
                        <div className="absolute top-0 left-0 w-1.5 h-1.5 bg-cyan-300 rounded-full border border-white" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover detail strip */}
      {hoveredRoom && rooms[hoveredRoom] && (
        <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg flex items-center gap-4 text-xs text-gray-600 transition-all">
          <span className="font-bold font-mono text-gray-800">Room {hoveredRoom}</span>
          <span>Floor {rooms[hoveredRoom].floor}</span>
          <span>{rooms[hoveredRoom].type}</span>
          <span style={{ color: STATUS_COLORS[rooms[hoveredRoom].roomStatus ?? 0] }} className="font-bold">
            {STATUS_LABELS[rooms[hoveredRoom].roomStatus ?? 0]}
          </span>
          <span>🌡 {rooms[hoveredRoom].temperature ?? '—'}°</span>
          <span>💧 {rooms[hoveredRoom].humidity ?? '—'}%</span>
          <span>🚪 {rooms[hoveredRoom].doorStatus ? 'OPEN' : 'Closed'}</span>
          {rooms[hoveredRoom].reservation && (
            <span className="text-brand-500 font-semibold">👤 {rooms[hoveredRoom].reservation.guestName}</span>
          )}
        </div>
      )}
    </div>
  );
}
