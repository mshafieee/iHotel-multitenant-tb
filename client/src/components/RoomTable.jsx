import React, { useState, useMemo } from 'react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';

// 0=VACANT 1=OCCUPIED 2=SERVICE 3=MAINTENANCE 4=NOT_OCCUPIED
const STATUSES = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const SCOL = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];
const FILTERS = [
  ['all', 'All'],
  ['vacant', '🟢 Vacant'],
  ['occupied', '🔵 Occ'],
  ['service', '🧹 Service'],
  ['not_occupied', '🟣 N/Occ'],
  ['maintenance', '🔧 Maint'],
  ['mur', '🧹 MUR'],
  ['dnd', '🔕 DND'],
  ['sos', '🚨 SOS'],
  ['pd', '⚡ PD'],
];

export default function RoomTable({ onSelectRoom, role }) {
  const rooms = useHotelStore(s => s.rooms);
  const rpc = useHotelStore(s => s.rpc);
  const checkout = useHotelStore(s => s.checkout);
  const [floor, setFloor] = useState(0);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    let arr = Object.values(rooms);
    if (floor) arr = arr.filter(r => r.floor === floor);
    const fmap = {
      occupied: r => r.roomStatus === 1,
      vacant: r => r.roomStatus === 0,
      service: r => r.roomStatus === 2,
      maintenance: r => r.roomStatus === 3,
      not_occupied: r => r.roomStatus === 4,
      mur: r => r.murService,
      dnd: r => r.dndService,
      sos: r => r.sosService,
      pd: r => r.pdMode,
    };
    if (fmap[filter]) arr = arr.filter(fmap[filter]);
    return arr.sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }));
  }, [rooms, floor, filter]);

  const handleCheckout = async (e, room) => {
    e.stopPropagation();
    if (!confirm(`Check out Room ${room}? This will set status to SERVICE.`)) return;
    try { await checkout(room); } catch {}
  };

  const canManage = role === 'owner' || role === 'admin' || role === 'frontdesk';

  return (
    <div className="card p-4">
      {/* Floor pills */}
      <div className="flex gap-1 flex-wrap mb-2">
        {Array.from({ length: 16 }, (_, i) => i).map(f => (
          <button key={f} onClick={() => setFloor(f)}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${floor === f ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
            {f ? `F${f}` : 'All'}
          </button>
        ))}
      </div>
      {/* Status filter pills */}
      <div className="flex gap-1 flex-wrap mb-3">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${filter === k ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
      </div>
      {/* Table */}
      <div className="max-h-[380px] overflow-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['Room', 'Flr', 'Type', 'Status', 'Temp', 'Door', 'Lines', 'Flags', ...(canManage ? ['Actions'] : [])].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(r => {
              const statusIdx = Math.min(r.roomStatus ?? 0, STATUSES.length - 1);
              const sc = r.sosService ? SCOL[3] : SCOL[statusIdx];
              const lines = [r.line1 && '1', r.line2 && '2', r.line3 && '3'].filter(Boolean).join(' ');
              const flags = [
                r.dndService && 'DND',
                r.murService && 'MUR',
                r.sosService && 'SOS',
                r.pdMode && 'PD',
              ].filter(Boolean);
              return (
                <tr key={r.room} onClick={() => onSelectRoom(r.room)}
                  className="hover:bg-gray-50 cursor-pointer transition">
                  <td className="px-3 py-2 font-bold font-mono">{r.room}</td>
                  <td className="px-3 py-2 text-gray-500">{r.floor}</td>
                  <td className="px-3 py-2 text-gray-500">{r.type}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc }} />
                      <span className="font-semibold" style={{ color: sc }}>{STATUSES[statusIdx]}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.temperature != null ? `${r.temperature}°` : '—'}</td>
                  <td className="px-3 py-2">{r.doorStatus ? '🚪 OPEN' : 'CLOSED'}</td>
                  <td className="px-3 py-2">
                    {lines ? <span className="text-blue-600 font-semibold">L{lines}</span> : <span className="text-gray-300">off</span>}
                  </td>
                  <td className="px-3 py-2">
                    {flags.length ? flags.map(f => (
                      <span key={f} className={`text-[9px] font-bold mr-1 ${f === 'SOS' ? 'text-red-500' : f === 'MUR' ? 'text-amber-500' : f === 'PD' ? 'text-red-600' : 'text-orange-500'}`}>{f}</span>
                    )) : <span className="text-gray-300">—</span>}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {/* Checkout — only for occupied rooms with a reservation */}
                        {r.roomStatus === 1 && r.reservation && (
                          <button onClick={e => handleCheckout(e, r.room)}
                            className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition">
                            Checkout
                          </button>
                        )}
                        {/* Status dropdown */}
                        <select value={r.roomStatus ?? 0}
                          onChange={e => rpc(r.deviceId, 'setRoomStatus', { roomStatus: +e.target.value })}
                          className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white">
                          {STATUSES.map((s, i) => <option key={i} value={i}>{s}</option>)}
                        </select>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-gray-400 text-right mt-2">{filtered.length} rooms</div>
    </div>
  );
}
