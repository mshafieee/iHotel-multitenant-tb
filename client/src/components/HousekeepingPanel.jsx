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
import useLangStore  from '../store/langStore';
import { t }         from '../i18n';
import { getAccessToken, api } from '../utils/api';
import { X, Loader2, Wrench } from 'lucide-react';

// ── Web Push subscription helper ─────────────────────────────────────────────
async function subscribeToPush(token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/vapid-key');
    if (!keyRes.ok) return null;
    const { publicKey } = await keyRes.json();
    const raw    = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
    const appKey = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    const j = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }),
    });
    return sub;
  } catch { return null; }
}

// ── Status badge helpers ────────────────────────────────────────────────────
const STATUS_STYLE = {
  pending:     'bg-amber-50  text-amber-700  border-amber-200',
  in_progress: 'bg-blue-50   text-blue-700   border-blue-200',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:   'bg-gray-100  text-gray-400   border-gray-200',
};

function StatusBadge({ status, T }) {
  const labelKey = {
    pending:     'hk_status_pending',
    in_progress: 'hk_status_inprogress',
    done:        'hk_status_done',
    cancelled:   'hk_status_cancelled',
  }[status];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-400'}`}>
      {labelKey ? T(labelKey) : status}
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
function ManagerView({ T }) {
  const {
    hkQueue, hkAssignments, hkHousekeepers, maintWorkers,
    fetchHKQueue, fetchHKAssignments, fetchHKHousekeepers, fetchMaintWorkers,
    hkAssign, hkCancel,
  } = useHotelStore();

  const [innerTab, setInnerTab]         = useState('queue');   // 'queue' | 'active' | 'tickets'
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [assignTo, setAssignTo]         = useState('');
  const [note, setNote]                 = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [flash, setFlash]               = useState(null);      // { type: 'ok'|'err', msg }
  const [maintTickets, setMaintTickets] = useState([]);
  const [assigningTicket, setAssigningTicket] = useState(null); // ticket id being assigned

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  // Load data on mount
  useEffect(() => {
    fetchHKQueue();
    fetchHKAssignments();
    fetchHKHousekeepers();
    fetchMaintWorkers();
    fetchMaintTickets();
  }, [fetchHKQueue, fetchHKAssignments, fetchHKHousekeepers, fetchMaintWorkers]);

  const fetchMaintTickets = useCallback(async () => {
    try {
      const data = await api('/api/maintenance?status=open');
      setMaintTickets(data);
    } catch {}
  }, []);

  const handleAssignTicket = async (ticketId, workerUsername) => {
    if (!workerUsername) return;
    setAssigningTicket(ticketId);
    try {
      await api(`/api/maintenance/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_to: workerUsername, status: 'in_progress' }),
      });
      showFlash('ok', 'Ticket assigned');
      fetchMaintTickets();
    } catch (e) {
      showFlash('err', e.message || 'Failed to assign');
    } finally {
      setAssigningTicket(null);
    }
  };

  const handleResolveTicket = async (ticketId) => {
    try {
      await api(`/api/maintenance/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      showFlash('ok', 'Ticket resolved');
      fetchMaintTickets();
    } catch (e) {
      showFlash('err', e.message || 'Failed');
    }
  };

  const toggleRoom = (room) => {
    setSelectedRooms(prev =>
      prev.includes(room) ? prev.filter(r => r !== room) : [...prev, room]
    );
  };

  const handleAssign = async () => {
    if (!selectedRooms.length) return showFlash('err', T('hk_select_placeholder'));
    if (!assignTo)             return showFlash('err', T('hk_select_placeholder'));
    setSubmitting(true);
    try {
      const res = await hkAssign(selectedRooms, assignTo, note);
      showFlash('ok', `${res.assigned} ${T('hk_btn_assign_rooms')}${res.skipped ? ` (${res.skipped} skipped)` : ''}`);
      setSelectedRooms([]);
      setNote('');
    } catch (e) {
      showFlash('err', e.message || 'Assignment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id, room) => {
    if (!confirm(`${T('hk_confirm_cancel')} ${room}?`)) return;
    try {
      await hkCancel(id);
      showFlash('ok', `${T('hk_col_room')} ${room} — ${T('hk_cancel')}`);
    } catch (e) {
      showFlash('err', e.message || 'Cancel failed');
    }
  };

  // Map username → display name for showing in assignment list
  const hkNameMap = Object.fromEntries(hkHousekeepers.map(h => [h.username, h.full_name || h.username]));

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
          { id: 'queue',   label: `${T('hk_tab_dirty')} (${hkQueue.length})` },
          { id: 'active',  label: `${T('hk_tab_active')}${activeCount ? ` (${activeCount})` : ''}` },
          { id: 'tickets', label: `🔧 Tickets${maintTickets.length ? ` (${maintTickets.length})` : ''}` },
        ].map(tb => (
          <button key={tb.id} onClick={() => setInnerTab(tb.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
              innerTab === tb.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ── QUEUE TAB ── */}
      {innerTab === 'queue' && (
        <div className="space-y-4">

          {/* Assignment form */}
          <div className="card p-4 border border-gray-100">
            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">
              {T('hk_assign_section')}
            </div>

            {/* Housekeeper select */}
            <div className="mb-3">
              <label className="text-[9px] text-gray-400 uppercase block mb-1">{T('hk_select_hk')}</label>
              <select className="input text-sm" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                <option value="">{T('hk_select_placeholder')}</option>
                {hkHousekeepers.map(h => (
                  <option key={h.id} value={h.username}>
                    {h.full_name || h.username}
                  </option>
                ))}
              </select>
              {!hkHousekeepers.length && (
                <p className="text-[10px] text-amber-500 mt-1">
                  {T('hk_no_hk_accounts')}
                </p>
              )}
            </div>

            {/* Note */}
            <div className="mb-3">
              <label className="text-[9px] text-gray-400 uppercase block mb-1">{T('hk_note_label')}</label>
              <input className="input text-sm" placeholder={T('hk_note_placeholder')}
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {/* Selected rooms preview */}
            {selectedRooms.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {selectedRooms.map(r => (
                  <span key={r} className="text-[11px] bg-brand-50 text-brand-600 border border-brand-200 rounded-full px-2 py-0.5 font-bold">
                    {T('hk_col_room')} {r}
                    <button onClick={() => toggleRoom(r)} className="ml-1 text-brand-300 hover:text-brand-500">×</button>
                  </span>
                ))}
              </div>
            )}

            <button onClick={handleAssign} disabled={submitting || !selectedRooms.length || !assignTo}
              className="btn btn-primary text-xs disabled:opacity-50">
              {submitting
                ? T('hk_btn_assigning')
                : `${T('hk_btn_assign')} ${selectedRooms.length || ''} ${T('hk_btn_assign_rooms')}${selectedRooms.length !== 1 ? '' : ''}`}
            </button>
          </div>

          {/* Dirty room cards — click to toggle selection */}
          {hkQueue.length === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-400">
              {T('hk_no_dirty')}
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
                    <div className="text-[10px] text-gray-400 mt-0.5">{T('hk_floor_prefix')}{r.floor} · {r.type || '—'}</div>
                    {r.guestName && (
                      <div className="text-[10px] text-amber-600 font-semibold mt-1 truncate">
                        ↩ {r.guestName}
                      </div>
                    )}
                    {selected && (
                      <div className="text-[10px] text-brand-600 font-bold mt-1">✓</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVE ASSIGNMENTS TAB — mobile-friendly cards ── */}
      {innerTab === 'active' && (
        <div>
          {hkAssignments.length === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-400">{T('hk_no_active')}</div>
          ) : (
            <div className="space-y-2">
              {hkAssignments.map(a => (
                <div key={a.id} className={`card p-3 border-l-4 ${
                  a.status === 'in_progress' ? 'border-l-blue-400' :
                  a.status === 'pending'     ? 'border-l-amber-400' :
                  a.status === 'done'        ? 'border-l-emerald-400' : 'border-l-gray-200'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold font-mono text-lg text-gray-800">{a.room}</span>
                        <StatusBadge status={a.status} T={T} />
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[11px] text-gray-400">👤</span>
                        <span className="text-xs font-semibold text-gray-700 truncate">{hkNameMap[a.assigned_to] || a.assigned_to}</span>
                      </div>
                      {a.notes && (
                        <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1 inline-block max-w-full truncate">
                          📋 {a.notes}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-1 flex flex-wrap gap-x-3">
                        <span>{T('hk_col_assigned')} {fmtTime(a.assigned_at)}</span>
                        {a.started_at && <span>{T('hk_col_started')} {fmtTime(a.started_at)}</span>}
                      </div>
                    </div>
                    {['pending', 'in_progress'].includes(a.status) && (
                      <button onClick={() => handleCancel(a.id, a.room)}
                        className="shrink-0 text-[10px] font-bold text-red-400 hover:text-red-600 border border-red-100 hover:bg-red-50 rounded px-2 py-1 transition">
                        {T('hk_cancel')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MAINTENANCE TICKETS TAB ── */}
      {innerTab === 'tickets' && (
        <div className="space-y-2">
          {maintTickets.length === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-400">No open maintenance tickets</div>
          ) : (
            maintTickets.map(ticket => {
              const PRIORITY_COLOR = { low: 'text-gray-400', medium: 'text-blue-500', high: 'text-amber-600', urgent: 'text-red-600 font-bold' };
              return (
                <div key={ticket.id} className={`card p-3 border-l-4 ${
                  ticket.status === 'in_progress' ? 'border-l-amber-400' : 'border-l-red-300'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-600 bg-gray-100 rounded px-1.5">{ticket.category}</span>
                        {ticket.room_number && (
                          <span className="text-xs font-bold text-brand-600">Rm {ticket.room_number}</span>
                        )}
                        <span className={`text-[10px] ${PRIORITY_COLOR[ticket.priority] || 'text-gray-400'}`}>
                          ● {ticket.priority}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          ticket.status === 'in_progress' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                        }`}>{ticket.status}</span>
                      </div>
                      <div className="text-xs text-gray-700 mt-1 line-clamp-2">{ticket.description}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        reported by {ticket.reported_by}
                        {ticket.assigned_to && <span className="ml-2">· assigned to <span className="font-semibold text-gray-600">{ticket.assigned_to}</span></span>}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col gap-1 items-end">
                      {/* Assign to maintenance worker */}
                      <select
                        className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white max-w-[120px]"
                        defaultValue=""
                        onChange={e => { if (e.target.value) handleAssignTicket(ticket.id, e.target.value); }}
                        disabled={assigningTicket === ticket.id}
                      >
                        <option value="">{maintWorkers.length ? 'Assign…' : 'No workers'}</option>
                        {maintWorkers.map(w => (
                          <option key={w.id} value={w.username}>{w.full_name || w.username}</option>
                        ))}
                      </select>
                      <button onClick={() => handleResolveTicket(ticket.id)}
                        className="text-[10px] font-bold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 rounded px-2 py-0.5 transition">
                        ✓ Resolve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOUSEKEEPER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function HousekeeperView({ T }) {
  const {
    hkAssignments,
    fetchHKAssignments,
    hkStart, hkComplete,
  } = useHotelStore();

  const [busy, setBusy]               = useState(null);
  const [flash, setFlash]             = useState(null);
  const [pushState, setPushState]     = useState('idle'); // 'idle'|'subscribing'|'on'|'unsupported'
  const [reportRoom, setReportRoom]   = useState(null);  // room number string when modal open
  const [myReports, setMyReports]     = useState([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  useEffect(() => { fetchHKAssignments(); }, [fetchHKAssignments]);

  // Load my maintenance reports
  const fetchMyReports = useCallback(async () => {
    try {
      const data = await api('/api/maintenance');
      setMyReports(data);
      setReportsLoaded(true);
    } catch {}
  }, []);
  useEffect(() => { fetchMyReports(); }, [fetchMyReports]);

  // Check existing push subscription on mount
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return; }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setPushState(sub ? 'on' : 'idle'))
      .catch(() => setPushState('unsupported'));
  }, []);

  const handleEnablePush = async () => {
    setPushState('subscribing');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setPushState('idle'); return; }
    const sub = await subscribeToPush(getAccessToken());
    setPushState(sub ? 'on' : 'idle');
  };

  const handleStart = async (id, room) => {
    setBusy(id);
    try {
      await hkStart(id);
      showFlash('ok', `${T('hk_col_room')} ${room} — ${T('hk_status_inprogress')}`);
    } catch (e) {
      showFlash('err', e.message || 'Failed to start');
    } finally {
      setBusy(null);
    }
  };

  const handleDone = async (id, room) => {
    if (!confirm(`${T('hk_confirm_done').replace('Room', `${T('hk_col_room')} ${room}`)}`)) return;
    setBusy(id);
    try {
      await hkComplete(id);
      showFlash('ok', `${T('hk_col_room')} ${room} — ${T('hk_status_done')} ✓`);
    } catch (e) {
      showFlash('err', e.message || 'Failed to complete');
    } finally {
      setBusy(null);
    }
  };

  const pending    = hkAssignments.filter(a => a.status === 'pending');
  const inProgress = hkAssignments.filter(a => a.status === 'in_progress');

  // Push notification banner
  const PushBanner = () => {
    if (pushState === 'unsupported') return null;
    if (pushState === 'on') return (
      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-700 font-semibold">
        🔔 Push notifications enabled
      </div>
    );
    return (
      <button onClick={handleEnablePush} disabled={pushState === 'subscribing'}
        className="w-full flex items-center justify-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-xs text-blue-700 font-semibold hover:bg-blue-100 transition disabled:opacity-60">
        {pushState === 'subscribing' ? '…' : '🔔 Enable push notifications (background alerts)'}
      </button>
    );
  };

  if (hkAssignments.length === 0) {
    return (
      <div className="space-y-3">
        <PushBanner />
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="text-sm font-semibold text-gray-600">{T('hk_empty_title')}</div>
          <div className="text-xs text-gray-400 mt-1">{T('hk_empty_sub')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      <PushBanner />

      {flash && (
        <div className={`text-xs font-semibold rounded-lg px-3 py-2 ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {flash.msg}
        </div>
      )}

      {/* In-Progress rooms first */}
      {inProgress.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{T('hk_section_cleaning')}</div>
          {inProgress.map(a => (
            <RoomTaskCard key={a.id} a={a} busy={busy} T={T}
              onDone={() => handleDone(a.id, a.room)}
              onReport={() => setReportRoom(a.room)} />
          ))}
        </div>
      )}

      {/* Pending rooms */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{T('hk_section_todo')}</div>
          {pending.map(a => (
            <RoomTaskCard key={a.id} a={a} busy={busy} T={T}
              onStart={() => handleStart(a.id, a.room)}
              onReport={() => setReportRoom(a.room)} />
          ))}
        </div>
      )}

      {/* My Reports */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{T('maint_my_reports')}</div>
          <button onClick={() => setReportRoom('')}
            className="text-xs font-semibold text-brand-500 hover:underline">
            + {T('maint_report_btn')}
          </button>
        </div>
        {reportsLoaded && myReports.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">{T('maint_no_reports')}</p>
        ) : (
          myReports.map(r => {
            const statusColors = { open: 'bg-blue-50 text-blue-600', in_progress: 'bg-amber-50 text-amber-600', resolved: 'bg-emerald-50 text-emerald-700' };
            const statusKey    = { open: 'maint_status_open', in_progress: 'maint_status_inprog', resolved: 'maint_status_resolved' };
            return (
              <div key={r.id} className="card p-3 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-700 truncate">{r.description}</span>
                    {r.room_number && <span className="text-xs text-gray-400">Rm {r.room_number}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[r.status] || 'bg-gray-100 text-gray-400'}`}>
                      {T(statusKey[r.status]) || r.status}
                    </span>
                    <span className="text-[10px] text-gray-400">{r.category}</span>
                  </div>
                  {r.notes && (
                    <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1">
                      💬 {r.notes}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Report Issue modal */}
      {reportRoom !== null && (
        <ReportIssueModal
          defaultRoom={reportRoom}
          T={T}
          onClose={() => setReportRoom(null)}
          onSubmitted={() => {
            setReportRoom(null);
            showFlash('ok', T('maint_submitted_ok'));
            fetchMyReports();
          }}
        />
      )}
    </div>
  );
}

// ── Maintenance report modal ─────────────────────────────────────────────────
const MAINT_CATEGORIES = ['AC', 'Plumbing', 'Electrical', 'Furniture', 'Cleaning', 'Other'];
const MAINT_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const MAINT_CAT_KEY    = { AC: 'maint_cat_ac', Plumbing: 'maint_cat_plumbing', Electrical: 'maint_cat_electrical', Furniture: 'maint_cat_furniture', Cleaning: 'maint_cat_cleaning', Other: 'maint_cat_other' };
const MAINT_PRI_KEY    = { low: 'maint_pri_low', medium: 'maint_pri_medium', high: 'maint_pri_high', urgent: 'maint_pri_urgent' };

function ReportIssueModal({ defaultRoom, T, onClose, onSubmitted }) {
  const [category,    setCategory]    = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [room,        setRoom]        = useState(defaultRoom || '');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!category || !description.trim()) return;
    setSubmitting(true); setError('');
    try {
      await api('/api/maintenance', {
        method: 'POST',
        body: JSON.stringify({ category, description: description.trim(), priority, room_number: room || undefined }),
      });
      onSubmitted();
    } catch (err) {
      setError(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        {/* header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800">🔧 {T('maint_modal_title')}</h3>
          <button onClick={onClose} className="btn btn-ghost p-1.5"><X size={15} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* room */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{T('maint_room')}</label>
            <input
              type="text"
              value={room}
              onChange={e => setRoom(e.target.value)}
              className="input"
              placeholder="e.g. 101"
            />
          </div>

          {/* category */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{T('maint_category')} *</label>
            <div className="flex flex-wrap gap-1.5">
              {MAINT_CATEGORIES.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => setCategory(c)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    category === c
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {T(MAINT_CAT_KEY[c])}
                </button>
              ))}
            </div>
          </div>

          {/* priority */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{T('maint_priority')}</label>
            <div className="flex gap-1.5">
              {MAINT_PRIORITIES.map(p => (
                <button
                  key={p} type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    priority === p
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {T(MAINT_PRI_KEY[p])}
                </button>
              ))}
            </div>
          </div>

          {/* description */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">{T('maint_description')} *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder={T('maint_description_ph')}
              required
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">{T('maint_cancel')}</button>
            <button
              type="submit"
              disabled={submitting || !category || !description.trim()}
              className="btn btn-primary flex-1 flex items-center justify-center gap-1"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {submitting ? T('maint_submitting') : T('maint_submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Individual room task card (housekeeper view) ────────────────────────────
function RoomTaskCard({ a, busy, onStart, onDone, onReport, T }) {
  const isInProgress = a.status === 'in_progress';
  const isBusy       = busy === a.id;

  return (
    <div className={`card p-4 border-l-4 ${isInProgress ? 'border-l-blue-500' : 'border-l-amber-400'}`}>
      <div className="flex items-center justify-between">
        <div>
          {/* Room number + floor/type */}
          <div className="flex items-center gap-2">
            <span className="text-2xl font-extrabold font-mono text-gray-800">{a.room}</span>
            {a.floor && <span className="text-xs text-gray-400">{T('hk_floor_prefix')}{a.floor}</span>}
            {a.type  && <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1">{a.type}</span>}
            <StatusBadge status={a.status} T={T} />
          </div>

          {/* Notes from manager */}
          {a.notes && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1 max-w-xs">
              📋 {a.notes}
            </div>
          )}

          {/* Timing info */}
          <div className="text-[10px] text-gray-400 mt-1 space-x-3">
            <span>{T('hk_assigned_at')} {fmtTime(a.assigned_at)}</span>
            {a.started_at && <span>{T('hk_started_at')} {fmtTime(a.started_at)}</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 ml-4 flex flex-col gap-2 items-end">
          {!isInProgress && onStart && (
            <button onClick={onStart} disabled={isBusy}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
              {isBusy ? '…' : T('hk_btn_start')}
            </button>
          )}
          {isInProgress && onDone && (
            <button onClick={onDone} disabled={isBusy}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition disabled:opacity-50">
              {isBusy ? '…' : T('hk_btn_done')}
            </button>
          )}
          {onReport && (
            <button onClick={onReport}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition">
              {T('maint_report_btn')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE WORKER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function MaintenanceWorkerView({ T }) {
  const { user } = useAuthStore();
  const [tickets, setTickets]   = useState([]);
  const [busy, setBusy]         = useState(null);
  const [flash, setFlash]       = useState(null);

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const data = await api('/api/maintenance');
      setTickets(data);
    } catch {}
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleUpdate = async (id, status) => {
    setBusy(id);
    try {
      await api(`/api/maintenance/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showFlash('ok', status === 'resolved' ? 'Ticket resolved ✓' : 'Status updated');
      fetchTickets();
    } catch (e) {
      showFlash('err', e.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const PRIORITY_COLOR = { low: 'text-gray-400', medium: 'text-blue-500', high: 'text-amber-600', urgent: 'text-red-600 font-bold' };
  const openTickets = tickets.filter(t => t.status !== 'resolved');

  return (
    <div className="space-y-3">
      {flash && (
        <div className={`text-xs font-semibold rounded-lg px-3 py-2 ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {flash.msg}
        </div>
      )}
      {openTickets.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="text-sm font-semibold text-gray-600">No open tickets</div>
          <div className="text-xs text-gray-400 mt-1">All assigned work is complete</div>
        </div>
      ) : (
        openTickets.map(ticket => (
          <div key={ticket.id} className={`card p-4 border-l-4 ${
            ticket.status === 'in_progress' ? 'border-l-amber-400' : 'border-l-blue-300'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-600 bg-gray-100 rounded px-1.5">{ticket.category}</span>
                  {ticket.room_number && (
                    <span className="text-sm font-extrabold text-brand-600 font-mono">Rm {ticket.room_number}</span>
                  )}
                  <span className={`text-[10px] ${PRIORITY_COLOR[ticket.priority] || ''}`}>● {ticket.priority}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    ticket.status === 'in_progress' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                  }`}>{ticket.status}</span>
                </div>
                <div className="text-sm text-gray-800 mt-1.5 font-medium">{ticket.description}</div>
                {ticket.notes && (
                  <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1.5">📋 {ticket.notes}</div>
                )}
              </div>
              <div className="shrink-0 flex flex-col gap-1.5 items-end">
                {ticket.status === 'open' && (
                  <button onClick={() => handleUpdate(ticket.id, 'in_progress')} disabled={busy === ticket.id}
                    className="px-3 py-1.5 rounded-xl font-bold text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition disabled:opacity-50">
                    {busy === ticket.id ? '…' : '▶ Start'}
                  </button>
                )}
                {ticket.status === 'in_progress' && (
                  <button onClick={() => handleUpdate(ticket.id, 'resolved')} disabled={busy === ticket.id}
                    className="px-3 py-1.5 rounded-xl font-bold text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition disabled:opacity-50">
                    {busy === ticket.id ? '…' : '✓ Done'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT EXPORT — selects the correct view based on role
// ─────────────────────────────────────────────────────────────────────────────
export default function HousekeepingPanel() {
  const { user } = useAuthStore();
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const isManager = ['owner', 'admin', 'frontdesk'].includes(user?.role);
  const isMaintenance = user?.role === 'maintenance';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{isMaintenance ? '🔧' : '🧹'}</span>
        <div>
          <div className="font-bold text-gray-800">{isMaintenance ? 'Maintenance Tasks' : T('hk_title')}</div>
          <div className="text-[10px] text-gray-400">
            {isManager ? T('hk_subtitle_mgr') : isMaintenance ? 'Your assigned maintenance tickets' : T('hk_subtitle_hk')}
          </div>
        </div>
      </div>

      {isManager ? <ManagerView T={T} /> : isMaintenance ? <MaintenanceWorkerView T={T} /> : <HousekeeperView T={T} />}
    </div>
  );
}
