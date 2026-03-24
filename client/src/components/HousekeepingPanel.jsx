/**
 * HousekeepingPanel.jsx
 *
 * Two-in-one panel depending on the logged-in user's role:
 *
 *  MANAGER VIEW  (owner / admin / frontdesk)
 *  ─────────────────────────────────────────
 *  • "Dirty Rooms" tab  — SERVICE rooms with no active assignment.
 *    Manager selects one or more rooms, picks a housekeeper, optionally adds
 *    a note, and clicks "Assign".  The housekeeper is notified instantly.
 *  • "Active Assignments" tab — all pending / in_progress tasks with the
 *    ability to cancel any of them.
 *
 *  HOUSEKEEPER VIEW  (housekeeper role)
 *  ─────────────────────────────────────
 *  • List of rooms assigned to this housekeeper (pending / in_progress).
 *  • "Start Cleaning" button  → marks in_progress.
 *  • "Mark Done"       button  → resets room appliances and sets VACANT.
 *
 * Data flow:
 *  HTTP  — initial load + after mutations
 *  SSE   — real-time push for housekeeping_update / housekeeping_assign /
 *           housekeeping_cancel (wired up in hotelStore.js connectSSE)
 */

import React, { useEffect, useState, useCallback } from 'react';
import useHotelStore from '../store/hotelStore';
import useAuthStore  from '../store/authStore';

// ── Status badge helpers ────────────────────────────────────────────────────
const STATUS_STYLE = {
  pending:     'bg-amber-50  text-amber-700  border-amber-200',
  in_progress: 'bg-blue-50   text-blue-700   border-blue-200',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:   'bg-gray-100  text-gray-400   border-gray-200',
};
const STATUS_LABEL = {
  pending:     'Pending',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
};

function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-400'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// Format a Unix-ms timestamp as a short time string
function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function ManagerView() {
  const {
    hkQueue, hkAssignments, hkHousekeepers,
    fetchHKQueue, fetchHKAssignments, fetchHKHousekeepers,
    hkAssign, hkCancel,
  } = useHotelStore();

  const [innerTab, setInnerTab]         = useState('queue');   // 'queue' | 'active'
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [assignTo, setAssignTo]         = useState('');
  const [note, setNote]                 = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [flash, setFlash]               = useState(null);      // { type: 'ok'|'err', msg }

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  // Load data on mount
  useEffect(() => {
    fetchHKQueue();
    fetchHKAssignments();
    fetchHKHousekeepers();
  }, [fetchHKQueue, fetchHKAssignments, fetchHKHousekeepers]);

  const toggleRoom = (room) => {
    setSelectedRooms(prev =>
      prev.includes(room) ? prev.filter(r => r !== room) : [...prev, room]
    );
  };

  const handleAssign = async () => {
    if (!selectedRooms.length) return showFlash('err', 'Select at least one room');
    if (!assignTo)             return showFlash('err', 'Select a housekeeper');
    setSubmitting(true);
    try {
      const res = await hkAssign(selectedRooms, assignTo, note);
      showFlash('ok', `${res.assigned} room(s) assigned${res.skipped ? ` (${res.skipped} skipped — already assigned)` : ''}`);
      setSelectedRooms([]);
      setNote('');
    } catch (e) {
      showFlash('err', e.message || 'Assignment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id, room) => {
    if (!confirm(`Cancel assignment for Room ${room}?`)) return;
    try {
      await hkCancel(id);
      showFlash('ok', `Assignment for Room ${room} cancelled`);
    } catch (e) {
      showFlash('err', e.message || 'Cancel failed');
    }
  };

  // Pending + in_progress assignments for the "Active" tab badge
  const activeCount = hkAssignments.filter(a => ['pending', 'in_progress'].includes(a.status)).length;

  return (
    <div className="space-y-4">

      {/* Flash message */}
      {flash && (
        <div className={`text-xs font-semibold rounded-lg px-3 py-2 ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {flash.msg}
        </div>
      )}

      {/* Inner tabs */}
      <div className="flex gap-2 border-b border-gray-100 pb-0">
        {[
          { id: 'queue',  label: `Dirty Rooms (${hkQueue.length})` },
          { id: 'active', label: `Active Assignments${activeCount ? ` (${activeCount})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setInnerTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
              innerTab === t.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── QUEUE TAB ── */}
      {innerTab === 'queue' && (
        <div className="space-y-4">

          {/* Assignment form */}
          <div className="card p-4 border border-gray-100">
            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">
              Assign Rooms to Housekeeper
            </div>

            {/* Housekeeper select */}
            <div className="mb-3">
              <label className="text-[9px] text-gray-400 uppercase block mb-1">Housekeeper</label>
              <select className="input text-sm" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                <option value="">— Select housekeeper —</option>
                {hkHousekeepers.map(h => (
                  <option key={h.id} value={h.username}>
                    {h.full_name || h.username}
                  </option>
                ))}
              </select>
              {!hkHousekeepers.length && (
                <p className="text-[10px] text-amber-500 mt-1">
                  No housekeeper accounts found. Create one in the Users tab with the "Housekeeper" role.
                </p>
              )}
            </div>

            {/* Note */}
            <div className="mb-3">
              <label className="text-[9px] text-gray-400 uppercase block mb-1">Note (optional)</label>
              <input className="input text-sm" placeholder="e.g. Deep clean — VIP arrival at 15:00"
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {/* Selected rooms preview */}
            {selectedRooms.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {selectedRooms.map(r => (
                  <span key={r} className="text-[11px] bg-brand-50 text-brand-600 border border-brand-200 rounded-full px-2 py-0.5 font-bold">
                    Rm {r}
                    <button onClick={() => toggleRoom(r)} className="ml-1 text-brand-300 hover:text-brand-500">×</button>
                  </span>
                ))}
              </div>
            )}

            <button onClick={handleAssign} disabled={submitting || !selectedRooms.length || !assignTo}
              className="btn btn-primary text-xs disabled:opacity-50">
              {submitting ? 'Assigning…' : `Assign ${selectedRooms.length || ''} Room${selectedRooms.length !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Dirty room cards — click to toggle selection */}
          {hkQueue.length === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-400">
              ✅ No dirty rooms waiting — all rooms are clean
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {hkQueue.map(r => {
                const selected = selectedRooms.includes(String(r.room));
                return (
                  <button key={r.room} onClick={() => toggleRoom(String(r.room))}
                    className={`rounded-xl border-2 p-3 text-left transition-all ${
                      selected
                        ? 'border-brand-500 bg-brand-50 shadow-md'
                        : 'border-gray-200 bg-white hover:border-brand-300 hover:shadow-sm'
                    }`}>
                    <div className="font-extrabold text-lg text-gray-800 font-mono leading-none">
                      {r.room}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">F{r.floor} · {r.type || '—'}</div>
                    {r.guestName && (
                      <div className="text-[10px] text-amber-600 font-semibold mt-1 truncate">
                        ↩ {r.guestName}
                      </div>
                    )}
                    {selected && (
                      <div className="text-[10px] text-brand-600 font-bold mt-1">✓ Selected</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVE ASSIGNMENTS TAB ── */}
      {innerTab === 'active' && (
        <div className="card overflow-hidden">
          {hkAssignments.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No active assignments</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Room', 'Housekeeper', 'Status', 'Assigned', 'Started', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {hkAssignments.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-bold font-mono">{a.room}</td>
                    <td className="px-3 py-2 text-gray-600">{a.assigned_to}</td>
                    <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-2 text-[11px] text-gray-400">{fmtTime(a.assigned_at)}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-400">{fmtTime(a.started_at)}</td>
                    <td className="px-3 py-2">
                      {['pending', 'in_progress'].includes(a.status) && (
                        <button onClick={() => handleCancel(a.id, a.room)}
                          className="text-[10px] font-bold text-red-400 hover:text-red-600 border border-red-100 hover:bg-red-50 rounded px-1.5 py-0.5 transition">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOUSEKEEPER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function HousekeeperView() {
  const {
    hkAssignments,
    fetchHKAssignments,
    hkStart, hkComplete,
  } = useHotelStore();

  const [busy, setBusy]   = useState(null);  // assignment id being processed
  const [flash, setFlash] = useState(null);

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  useEffect(() => { fetchHKAssignments(); }, [fetchHKAssignments]);

  const handleStart = async (id, room) => {
    setBusy(id);
    try {
      await hkStart(id);
      showFlash('ok', `Room ${room} — cleaning started`);
    } catch (e) {
      showFlash('err', e.message || 'Failed to start');
    } finally {
      setBusy(null);
    }
  };

  const handleDone = async (id, room) => {
    if (!confirm(`Mark Room ${room} as clean?\nThis will reset lights, AC, curtains and set the room to VACANT.`)) return;
    setBusy(id);
    try {
      await hkComplete(id);
      showFlash('ok', `Room ${room} — marked clean ✓`);
    } catch (e) {
      showFlash('err', e.message || 'Failed to complete');
    } finally {
      setBusy(null);
    }
  };

  const pending     = hkAssignments.filter(a => a.status === 'pending');
  const inProgress  = hkAssignments.filter(a => a.status === 'in_progress');

  if (hkAssignments.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl mb-3">✅</div>
        <div className="text-sm font-semibold text-gray-600">No rooms assigned to you right now</div>
        <div className="text-xs text-gray-400 mt-1">Check back after the next checkout</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {flash && (
        <div className={`text-xs font-semibold rounded-lg px-3 py-2 ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {flash.msg}
        </div>
      )}

      {/* In-Progress rooms first */}
      {inProgress.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Currently Cleaning</div>
          {inProgress.map(a => (
            <RoomTaskCard key={a.id} a={a} busy={busy}
              onDone={() => handleDone(a.id, a.room)} />
          ))}
        </div>
      )}

      {/* Pending rooms */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Rooms to Clean</div>
          {pending.map(a => (
            <RoomTaskCard key={a.id} a={a} busy={busy}
              onStart={() => handleStart(a.id, a.room)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Individual room task card (housekeeper view) ────────────────────────────
function RoomTaskCard({ a, busy, onStart, onDone }) {
  const isInProgress = a.status === 'in_progress';
  const isBusy       = busy === a.id;

  return (
    <div className={`card p-4 border-l-4 ${isInProgress ? 'border-l-blue-500' : 'border-l-amber-400'}`}>
      <div className="flex items-center justify-between">
        <div>
          {/* Room number + floor/type */}
          <div className="flex items-center gap-2">
            <span className="text-2xl font-extrabold font-mono text-gray-800">{a.room}</span>
            {a.floor && <span className="text-xs text-gray-400">Floor {a.floor}</span>}
            {a.type  && <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1">{a.type}</span>}
            <StatusBadge status={a.status} />
          </div>

          {/* Notes from manager */}
          {a.notes && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1 max-w-xs">
              📋 {a.notes}
            </div>
          )}

          {/* Timing info */}
          <div className="text-[10px] text-gray-400 mt-1 space-x-3">
            <span>Assigned {fmtTime(a.assigned_at)}</span>
            {a.started_at && <span>· Started {fmtTime(a.started_at)}</span>}
          </div>
        </div>

        {/* Action button */}
        <div className="shrink-0 ml-4">
          {!isInProgress && onStart && (
            <button onClick={onStart} disabled={isBusy}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
              {isBusy ? '…' : '🧹 Start'}
            </button>
          )}
          {isInProgress && onDone && (
            <button onClick={onDone} disabled={isBusy}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition disabled:opacity-50">
              {isBusy ? '…' : '✅ Mark Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT EXPORT — selects the correct view based on role
// ─────────────────────────────────────────────────────────────────────────────
export default function HousekeepingPanel() {
  const { user } = useAuthStore();
  const isManager = ['owner', 'admin', 'frontdesk'].includes(user?.role);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🧹</span>
        <div>
          <div className="font-bold text-gray-800">Housekeeping</div>
          <div className="text-[10px] text-gray-400">
            {isManager ? 'Assign dirty rooms and track cleaning progress' : 'Your assigned rooms for today'}
          </div>
        </div>
      </div>

      {isManager ? <ManagerView /> : <HousekeeperView />}
    </div>
  );
}
