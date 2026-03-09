import React, { useState } from 'react';
import useHotelStore from '../store/hotelStore';
import { api, getAccessToken } from '../utils/api';

const COLORS = { system: '#6B7280', auth: '#7C3AED', control: '#2563EB', pms: '#16A34A', guest: '#EC4899', telemetry: '#06B6D4', sensor: '#8B5CF6', service: '#D97706' };
const FILTERS = ['all', 'system', 'control', 'pms', 'telemetry', 'sensor', 'service'];

export default function LogsPanel() {
  const logs = useHotelStore(s => s.logs);
  const clearLogsLocal = useHotelStore(s => s.clearLogs);
  const [filter, setFilter] = useState('all');
  const [roomSearch, setRoomSearch] = useState('');
  const [clearing, setClearing] = useState(false);

  const filtered = logs
    .filter(e => filter === 'all' || e.cat === filter)
    .filter(e => !roomSearch.trim() || (e.room && String(e.room).includes(roomSearch.trim())));

  const exportCSV = () => {
    const token = getAccessToken();
    const link = document.createElement('a');
    fetch('/api/logs/export', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        link.href = URL.createObjectURL(blob);
        link.download = `hotel-audit-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
  };

  const clearLogs = async () => {
    if (!confirm('Clear all audit logs from the database? This cannot be undone.')) return;
    setClearing(true);
    try {
      await api('/api/logs', { method: 'DELETE' });
      clearLogsLocal();
    } catch (e) { console.error('Clear logs failed:', e.message); }
    finally { setClearing(false); }
  };

  return (
    <div className="card p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">Event Log</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-gray-400">SSE</span>
          <button onClick={exportCSV}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition">
            ⬇ Export CSV
          </button>
          <button onClick={clearLogs} disabled={clearing}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 transition disabled:opacity-50">
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </div>

      {/* Filters + room search */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-1 flex-wrap flex-1">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[10px] font-semibold capitalize transition ${
                filter === f ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
              {f}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={roomSearch}
          onChange={e => setRoomSearch(e.target.value)}
          placeholder="Search room…"
          className="input text-xs py-1 w-24"
        />
      </div>

      <div className="max-h-[500px] overflow-auto rounded-lg border border-gray-100">
        {!filtered.length && <div className="text-center py-8 text-gray-300 text-sm">No events</div>}
        {filtered.map((e, i) => {
          const ts = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
          const c = COLORS[e.cat] || '#6B7280';
          return (
            <div key={`${e.ts}-${i}`} className="flex items-start gap-2 px-3 py-2 border-b border-gray-50">
              <span className="text-[9px] text-gray-400 font-mono min-w-[55px] pt-0.5">{ts}</span>
              <div className="flex-1">
                <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase" style={{ background: c + '14', color: c }}>
                  {e.cat}
                </span>
                {e.room && (
                  <span className="ml-1.5 text-sm font-extrabold font-mono text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                    Room {e.room}
                  </span>
                )}
                <span className="text-xs font-semibold ml-1.5">{e.msg}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-gray-400 text-right mt-2">{filtered.length} events</div>
    </div>
  );
}
