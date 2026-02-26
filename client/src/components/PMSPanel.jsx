import React, { useState } from 'react';
import useHotelStore from '../store/hotelStore';
import { api, getAccessToken } from '../utils/api';

// ═══ CONFIGURATION — change this to your server IP ═══
const GUEST_HOST = 'http://192.168.43.212:5173';

function QRCode({ data, size = 200 }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&margin=8&format=svg`;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={url} alt="QR Code" width={size} height={size} className="rounded-lg border border-gray-200 shadow-sm" />
      <div className="text-[8px] text-gray-400 max-w-[200px] break-all text-center">{data}</div>
    </div>
  );
}

export default function PMSPanel() {
  const { reservations, fetchReservations } = useHotelStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ room: '', guestName: '', checkIn: '', checkOut: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showQR, setShowQR] = useState(null);
  const [deletingHistory, setDeletingHistory] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const defaultCo = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  // Use room-based stable guest URL so printed QR stays the same per room
  const getGuestUrl = (room) => `${GUEST_HOST}/guest?room=${encodeURIComponent(room)}`;

  const create = async () => {
    setError('');
    try {
      const data = await api('/api/pms/reservations', {
        method: 'POST', body: JSON.stringify(form)
      });
      setResult(data);
      setShowForm(false);
      fetchReservations();
    } catch (e) { setError(e.message); }
  };

  const exportCSV = () => {
    const token = getAccessToken();
    fetch('/api/pms/export', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `hotel-pms-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
  };

  const deleteHistory = async () => {
    if (!confirm('Delete all expired/cancelled reservations from history? Active reservations will not be affected.')) return;
    setDeletingHistory(true);
    try {
      const r = await api('/api/pms/history', { method: 'DELETE' });
      alert(`Deleted ${r.deleted} records.`);
      fetchReservations();
    } catch (e) { console.error('Delete history failed:', e.message); }
    finally { setDeletingHistory(false); }
  };

  const cancel = async (id, room) => {
    if (!confirm(`Cancel reservation for Room ${room}?`)) return;
    await api(`/api/pms/reservations/${id}`, { method: 'DELETE' });
    fetchReservations();
    setShowQR(null);
    setResult(null);
  };

  return (
    <div className="card p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">Reservations</div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition">
            ⬇ Export CSV
          </button>
          <button onClick={deleteHistory} disabled={deletingHistory}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 transition disabled:opacity-50">
            {deletingHistory ? '⏳' : '🗑 Delete History'}
          </button>
          <button onClick={() => { setShowForm(true); setResult(null); setShowQR(null); setForm({ room: '', guestName: '', checkIn: today, checkOut: defaultCo }); }}
            className="btn btn-primary text-xs">+ New</button>
        </div>
      </div>

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4">
          <div className="font-bold text-emerald-600 mb-3">✓ Reservation Created</div>
          <div className="flex gap-6 items-start">
            <div className="flex-1 space-y-2">
              <div className="text-sm font-semibold">Room {result.reservation.room} · {result.reservation.guestName}</div>
              <div className="text-xs text-gray-500">{result.reservation.checkIn} → {result.reservation.checkOut}</div>
              <div className="bg-white rounded-lg p-3 border border-emerald-100">
                <div className="text-[9px] text-gray-400 uppercase mb-1">Guest Password</div>
                <div className="text-2xl font-bold font-mono text-brand-500 tracking-widest">{result.password}</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-emerald-100">
                <div className="text-[9px] text-gray-400 uppercase mb-1">Guest Name (for login)</div>
                <div className="text-sm font-bold text-gray-700">{result.reservation.guestName}</div>
                <div className="text-[9px] text-gray-400 mt-1">Guest enters this name + password above</div>
              </div>
            </div>
            <div className="shrink-0">
              <div className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold mb-2 text-center">Guest QR Code</div>
              <QRCode data={getGuestUrl(result.reservation.room)} size={160} />
              <button onClick={() => navigator.clipboard?.writeText(getGuestUrl(result.reservation.room))}
                className="w-full mt-2 text-[10px] text-brand-500 hover:text-brand-700 font-semibold">📋 Copy Link</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
          <div className="text-sm font-semibold mb-3">New Reservation</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-gray-400 uppercase">Room</label>
              <input className="input" placeholder="e.g. 301" value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 uppercase">Guest Name</label>
              <input className="input" placeholder="Full or Single Name" value={form.guestName} onChange={e => setForm({ ...form, guestName: e.target.value })} />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 uppercase">Check-In</label>
              <input className="input" type="date" value={form.checkIn} onChange={e => setForm({ ...form, checkIn: e.target.value })} />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 uppercase">Check-Out</label>
              <input className="input" type="date" value={form.checkOut} onChange={e => setForm({ ...form, checkOut: e.target.value })} />
            </div>
          </div>
          {error && <div className="text-xs text-red-500 mt-2">{error}</div>}
          <div className="flex gap-2 mt-4">
            <button onClick={create} className="btn btn-primary">Create</button>
            <button onClick={() => setShowForm(false)} className="btn btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {showQR && (() => {
        const res = reservations.find(r => r.id === showQR);
        if (!res) return null;
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <div className="font-bold text-blue-600">🔗 Guest Access — Room {res.room}</div>
              <button onClick={() => setShowQR(null)} className="text-blue-400 hover:text-blue-600 font-bold">✕</button>
            </div>
            <div className="flex gap-6 items-start">
              <div className="flex-1 space-y-2">
                <div className="text-sm">{res.guestName}</div>
                <div className="text-xs text-gray-500">{res.checkIn} → {res.checkOut}</div>
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <div className="text-[9px] text-gray-400 uppercase mb-1">Password</div>
                  <div className="text-xl font-bold font-mono text-brand-500 tracking-widest">{res.password}</div>
                </div>
              </div>
              <div className="shrink-0">
                <QRCode data={getGuestUrl(res.room)} size={160} />
                <button onClick={() => navigator.clipboard?.writeText(getGuestUrl(res.room))}
                  className="w-full mt-2 text-[10px] text-brand-500 hover:text-brand-700 font-semibold">📋 Copy Link</button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="space-y-2">
        {reservations.map(r => (
          <div key={r.id} className={`p-3 rounded-xl border-l-4 bg-gray-50 border border-gray-100 ${r.active ? 'border-l-emerald-500' : 'border-l-gray-300'}`}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="font-bold font-mono text-sm">Rm {r.room}</span>
                <span className={`badge ${r.active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                  {r.active ? 'ACTIVE' : 'EXPIRED'}
                </span>
                <span className="text-xs text-gray-500">{r.guestName}</span>
              </div>
              <div className="flex items-center gap-2">
                {r.active && (
                  <button onClick={() => setShowQR(showQR === r.id ? null : r.id)}
                    className={`text-xs font-bold px-2 py-1 rounded-lg transition ${showQR === r.id ? 'bg-blue-500 text-white' : 'text-blue-500 hover:bg-blue-50 border border-blue-200'}`}>
                    📱 QR
                  </button>
                )}
                {r.active && (
                  <button onClick={() => cancel(r.id, r.room)} className="text-red-400 hover:text-red-600 text-xs font-bold">✕</button>
                )}
              </div>
            </div>
            <div className="text-[9px] text-gray-400 font-mono mt-1">{r.checkIn} → {r.checkOut}</div>
          </div>
        ))}
        {!reservations.length && <div className="text-center py-8 text-gray-300 text-sm">No reservations</div>}
      </div>
    </div>
  );
}
