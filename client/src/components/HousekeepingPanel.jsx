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
import { getAccessToken } from '../utils/api';

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
          { id: 'queue',  label: `${T('hk_tab_dirty')} (${hkQueue.length})` },
          { id: 'active', label: `${T('hk_tab_active')}${activeCount ? ` (${activeCount})` : ''}` },
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
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{a.assigned_to}</div>
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

  const [busy, setBusy]           = useState(null);
  const [flash, setFlash]         = useState(null);
  const [pushState, setPushState] = useState('idle'); // 'idle'|'subscribing'|'on'|'unsupported'

  const showFlash = useCallback((type, msg) => {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), 3500);
  }, []);

  useEffect(() => { fetchHKAssignments(); }, [fetchHKAssignments]);

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
              onDone={() => handleDone(a.id, a.room)} />
          ))}
        </div>
      )}

      {/* Pending rooms */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{T('hk_section_todo')}</div>
          {pending.map(a => (
            <RoomTaskCard key={a.id} a={a} busy={busy} T={T}
              onStart={() => handleStart(a.id, a.room)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Individual room task card (housekeeper view) ────────────────────────────
function RoomTaskCard({ a, busy, onStart, onDone, T }) {
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

        {/* Action button */}
        <div className="shrink-0 ml-4">
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
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const isManager = ['owner', 'admin', 'frontdesk'].includes(user?.role);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🧹</span>
        <div>
          <div className="font-bold text-gray-800">{T('hk_title')}</div>
          <div className="text-[10px] text-gray-400">
            {isManager ? T('hk_subtitle_mgr') : T('hk_subtitle_hk')}
          </div>
        </div>
      </div>

      {isManager ? <ManagerView T={T} /> : <HousekeeperView T={T} />}
    </div>
  );
}
