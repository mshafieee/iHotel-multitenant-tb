import React, { useState, useMemo } from 'react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

const ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];
const SCOL = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6', '#0891B2'];
const effectiveStatusIdx = (r) => (r?.roomStatus === 0 && r?.reservation) ? 5 : (r?.roomStatus ?? 0);

export default function RoomTable({ onSelectRoom, role }) {
  const rooms = useHotelStore(s => s.rooms);
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);

  const STATUSES = [T('status_vacant'), T('status_occupied'), T('status_service'), T('status_maintenance'), T('status_not_occupied'), T('status_reserved')];
  const STATUS_KEYS = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED', 'RESERVED'];
  const FILTERS = [
    ['all', T('all')],
    ['reserved',     T('status_reserved')],
    ['vacant',       T('rt_vacant')],
    ['occupied',     T('rt_occupied')],
    ['service',      T('rt_service')],
    ['not_occupied', T('rt_not_occ')],
    ['maintenance',  T('rt_maint')],
    ['mur',          T('rt_mur')],
    ['dnd',          T('rt_dnd')],
    ['sos',          T('rt_sos')],
    ['pd',           T('rt_pd')],
  ];
  const rpc            = useHotelStore(s => s.rpc);
  const checkout       = useHotelStore(s => s.checkout);
  const updateRoomType = useHotelStore(s => s.updateRoomType);
  const [floor, setFloor] = useState(0);
  const [filter, setFilter] = useState('all');
  const [reviewUrl, setReviewUrl] = useState(null); // shown after checkout

  const floors = useMemo(() => (
    [...new Set(Object.values(rooms).map(r => r.floor).filter(Boolean))].sort((a, b) => a - b)
  ), [rooms]);

  const filtered = useMemo(() => {
    let arr = Object.values(rooms);
    if (floor) arr = arr.filter(r => r.floor === floor);
    const fmap = {
      occupied: r => r.roomStatus === 1,
      vacant: r => r.roomStatus === 0 && !r.reservation,
      reserved: r => r.roomStatus === 0 && !!r.reservation,
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
    try {
      const result = await checkout(room);
      if (result?.reviewUrl) setReviewUrl(result.reviewUrl);
    } catch {}
  };

  const canManage   = role === 'owner' || role === 'admin' || role === 'frontdesk';
  const canEditType = role === 'owner' || role === 'admin';

  return (
    <div className="card p-4">
      {/* Review QR overlay after checkout */}
      {reviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="text-4xl mb-2">✅</div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">Check-out complete!</h2>
            <p className="text-sm text-gray-500 mb-4">Show this QR to the guest to rate their stay</p>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(reviewUrl)}&margin=8`}
              alt="Review QR" className="w-48 h-48 mx-auto rounded-xl border border-gray-100 shadow-sm mb-3" />
            <p className="text-[10px] text-gray-400 break-all mb-4">{reviewUrl}</p>
            <button onClick={() => setReviewUrl(null)} className="btn btn-primary w-full">Done</button>
          </div>
        </div>
      )}
      {/* Floor pills */}
      <div className="flex gap-1 flex-wrap mb-2">
        <button onClick={() => setFloor(0)}
          className={`px-2 py-1 rounded text-[10px] font-semibold transition ${floor === 0 ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
          All
        </button>
        {floors.map(f => (
          <button key={f} onClick={() => setFloor(f)}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${floor === f ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
            F{f}
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
        <table dir="ltr" className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 640 }}>
          <colgroup>
            <col style={{ width: 60 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 74 }} />
            <col style={{ width: 54 }} />
            <col style={{ width: 80 }} />
            {canManage && <col style={{ width: 140 }} />}
          </colgroup>
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {[T('rt_room'), T('rt_floor'), T('rt_type'), T('rt_status'), T('rt_guest'), T('rt_temp'), T('rt_door'), T('rt_lines'), T('rt_flags'), ...(canManage ? [T('rt_actions')] : [])].map(h => (
                <th key={h} className="px-2 py-2.5 text-left text-[10px] text-gray-400 uppercase tracking-wider font-semibold truncate">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(r => {
              const statusIdx = Math.min(effectiveStatusIdx(r), STATUSES.length - 1);
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
                  <td className="px-2 py-2.5 font-bold font-mono">{r.room}</td>
                  <td className="px-2 py-2.5 text-gray-500">{r.floor}</td>
                  <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                    {canEditType ? (
                      <select
                        value={r.type || r.roomType || 'STANDARD'}
                        onChange={e => updateRoomType(r.room, e.target.value)}
                        className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-600 hover:border-gray-300 focus:outline-none focus:border-brand-400"
                      >
                        {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-500">{r.roomType || r.type || '—'}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sc }} />
                      <span className="font-semibold text-[11px] truncate" style={{ color: sc }}>{STATUSES[statusIdx]}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    {r.reservation?.guestName
                      ? <span className="text-[11px] text-brand-600 font-semibold truncate block">👤 {r.reservation.guestName}</span>
                      : <span className="text-gray-300 text-[11px]">—</span>}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-[11px]">{r.temperature != null ? `${r.temperature}°` : '—'}</td>
                  <td className="px-2 py-2.5 text-[11px]">{r.doorStatus ? T('rt_door_open') : T('rt_door_closed')}</td>
                  <td className="px-2 py-2.5">
                    {lines ? <span className="text-blue-600 font-semibold text-[11px]">L{lines}</span> : <span className="text-gray-300 text-[11px]">—</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    {flags.length ? flags.map(f => (
                      <span key={f} className={`text-[10px] font-bold mr-0.5 ${f === 'SOS' ? 'text-red-500' : f === 'MUR' ? 'text-amber-500' : f === 'PD' ? 'text-red-600' : 'text-orange-500'}`}>{f}</span>
                    )) : <span className="text-gray-300">—</span>}
                  </td>
                  {canManage && (
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Checkout — any active/flagged status */}
                        {(r.roomStatus === 1 || r.roomStatus === 4 || r.murService || r.sosService || r.dndService || r.pdMode) && (
                          <button onClick={e => handleCheckout(e, r.room)}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition">
                            {T('rt_checkout')}
                          </button>
                        )}
                        {/* Status dropdown */}
                        <select value={r.roomStatus ?? 0}
                          onChange={e => rpc(r.room, 'setRoomStatus', { roomStatus: +e.target.value })}
                          className="text-[10px] border border-gray-200 rounded px-0.5 py-0.5 bg-white max-w-[80px]">
                          {STATUSES.map((s, i) => <option key={i} value={i}>{STATUS_KEYS[i]}</option>)}
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
      <div className="text-[10px] text-gray-400 text-right mt-2">{filtered.length} {T('rt_count')}</div>
    </div>
  );
}
