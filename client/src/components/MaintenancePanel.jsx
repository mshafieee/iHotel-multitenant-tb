/**
 * MaintenancePanel.jsx
 *
 * Admin/manager view for all maintenance tickets.
 * Housekeepers see only their own submitted tickets.
 *
 * Features:
 *  • Filter bar — All / Open / In Progress / Resolved
 *  • Priority badge with colour coding
 *  • Ticket detail side drawer — update status, assign, add notes
 *  • Real-time SSE updates (maintenance_update event)
 *  • Arabic + English via useLangStore / t()
 */

import React, { useEffect, useState, useCallback } from 'react';
import useAuthStore from '../store/authStore';
import useLangStore from '../store/langStore';
import { api } from '../utils/api';
import {
  Wrench, AlertTriangle, CheckCircle2, Clock, ChevronRight,
  X, RefreshCw, Plus, Loader2, Filter
} from 'lucide-react';

// ── Translation strings ───────────────────────────────────────────────────────
const STRINGS = {
  en: {
    title:          'Maintenance',
    all:            'All',
    open:           'Open',
    in_progress:    'In Progress',
    resolved:       'Resolved',
    noTickets:      'No tickets found.',
    ticketDetail:   'Ticket Detail',
    category:       'Category',
    room:           'Room',
    priority:       'Priority',
    status:         'Status',
    reportedBy:     'Reported By',
    assignedTo:     'Assigned To',
    notes:          'Notes',
    description:    'Description',
    created:        'Opened',
    resolvedAt:     'Resolved',
    save:           'Save Changes',
    saving:         'Saving…',
    close:          'Close',
    markResolved:   'Mark Resolved',
    unassigned:     'Unassigned',
    categories: {
      AC: 'Air Conditioning', Plumbing: 'Plumbing', Electrical: 'Electrical',
      Furniture: 'Furniture', Cleaning: 'Cleaning', Other: 'Other',
    },
    priorities: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
    statuses:   { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' },
    refresh:    'Refresh',
    loadError:  'Failed to load tickets.',
    saveError:  'Failed to save changes.',
    openBadge:  'open',
  },
  ar: {
    title:          'الصيانة',
    all:            'الكل',
    open:           'مفتوح',
    in_progress:    'قيد التنفيذ',
    resolved:       'محلول',
    noTickets:      'لا توجد تذاكر.',
    ticketDetail:   'تفاصيل التذكرة',
    category:       'الفئة',
    room:           'الغرفة',
    priority:       'الأولوية',
    status:         'الحالة',
    reportedBy:     'بواسطة',
    assignedTo:     'مسند إلى',
    notes:          'ملاحظات',
    description:    'الوصف',
    created:        'تاريخ الفتح',
    resolvedAt:     'تاريخ الحل',
    save:           'حفظ التغييرات',
    saving:         'جارٍ الحفظ…',
    close:          'إغلاق',
    markResolved:   'تحديد كمحلول',
    unassigned:     'غير مسند',
    categories: {
      AC: 'تكييف الهواء', Plumbing: 'سباكة', Electrical: 'كهرباء',
      Furniture: 'أثاث', Cleaning: 'نظافة', Other: 'أخرى',
    },
    priorities: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' },
    statuses:   { open: 'مفتوح', in_progress: 'قيد التنفيذ', resolved: 'محلول' },
    refresh:    'تحديث',
    loadError:  'فشل تحميل التذاكر.',
    saveError:  'فشل حفظ التغييرات.',
    openBadge:  'مفتوح',
  },
};

// ── Style helpers ─────────────────────────────────────────────────────────────
const PRIORITY_STYLE = {
  low:    'bg-gray-100   text-gray-500   border-gray-200',
  medium: 'bg-amber-50   text-amber-600  border-amber-200',
  high:   'bg-orange-50  text-orange-600 border-orange-200',
  urgent: 'bg-red-50     text-red-600    border-red-200',
};
const STATUS_STYLE = {
  open:        'bg-blue-50   text-blue-700   border-blue-200',
  in_progress: 'bg-amber-50  text-amber-700  border-amber-200',
  resolved:    'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const STATUS_ICON = {
  open:        <Clock       size={13} />,
  in_progress: <RefreshCw   size={13} />,
  resolved:    <CheckCircle2 size={13} />,
};
const CATEGORY_ICON = {
  AC: '❄️', Plumbing: '🔧', Electrical: '⚡', Furniture: '🛋️', Cleaning: '🧹', Other: '🔨',
};

function fmtDate(unix) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Ticket row ────────────────────────────────────────────────────────────────
function TicketRow({ ticket, s, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition-colors group"
    >
      <span className="text-xl mt-0.5 shrink-0">{CATEGORY_ICON[ticket.category] || '🔨'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-gray-800 truncate">{ticket.description}</span>
          {ticket.room_number && (
            <span className="text-xs text-gray-400">Rm {ticket.room_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`badge border ${STATUS_STYLE[ticket.status]} gap-1`}>
            {STATUS_ICON[ticket.status]}
            {s.statuses[ticket.status]}
          </span>
          <span className={`badge border ${PRIORITY_STYLE[ticket.priority]}`}>
            {s.priorities[ticket.priority]}
          </span>
          <span className="text-xs text-gray-400">{s.categories[ticket.category] || ticket.category}</span>
          <span className="text-xs text-gray-400 ms-auto">{fmtDate(ticket.created_at)}</span>
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1 group-hover:text-gray-500 transition-colors" />
    </button>
  );
}

// ── Ticket drawer ─────────────────────────────────────────────────────────────
function TicketDrawer({ ticket, s, isManager, housekeepers, onClose, onSaved }) {
  const [status,     setStatus]     = useState(ticket.status);
  const [assignedTo, setAssignedTo] = useState(ticket.assigned_to || '');
  const [notes,      setNotes]      = useState(ticket.notes || '');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const dirty =
    status !== ticket.status ||
    assignedTo !== (ticket.assigned_to || '') ||
    notes !== (ticket.notes || '');

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body = {};
      if (status !== ticket.status)                 body.status      = status;
      if (assignedTo !== (ticket.assigned_to || '')) body.assigned_to = assignedTo || null;
      if (notes !== (ticket.notes || ''))            body.notes       = notes;
      await api(`/api/maintenance/${ticket.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setError(s.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleResolve() {
    setSaving(true); setError('');
    try {
      await api(`/api/maintenance/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
      onSaved();
    } catch { setError(s.saveError); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      {/* panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col overflow-y-auto">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{CATEGORY_ICON[ticket.category] || '🔨'}</span>
            <div>
              <p className="font-bold text-gray-800 text-sm">{s.ticketDetail}</p>
              <p className="text-xs text-gray-400">#{ticket.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost p-2">
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 px-5 py-4 space-y-4">
          {/* meta grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{s.category}</p>
              <p className="font-medium">{s.categories[ticket.category] || ticket.category}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{s.room}</p>
              <p className="font-medium">{ticket.room_number || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{s.priority}</p>
              <span className={`badge border ${PRIORITY_STYLE[ticket.priority]}`}>
                {s.priorities[ticket.priority]}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{s.reportedBy}</p>
              <p className="font-medium">{ticket.reported_by}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{s.created}</p>
              <p className="text-xs text-gray-600">{fmtDate(ticket.created_at)}</p>
            </div>
            {ticket.resolved_at && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">{s.resolvedAt}</p>
                <p className="text-xs text-gray-600">{fmtDate(ticket.resolved_at)}</p>
              </div>
            )}
          </div>

          {/* description */}
          <div>
            <p className="text-xs text-gray-400 mb-1">{s.description}</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">{ticket.description}</p>
          </div>

          {isManager && (
            <>
              {/* status */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{s.status}</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="input"
                >
                  <option value="open">{s.statuses.open}</option>
                  <option value="in_progress">{s.statuses.in_progress}</option>
                  <option value="resolved">{s.statuses.resolved}</option>
                </select>
              </div>

              {/* assigned to */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{s.assignedTo}</label>
                <select
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  className="input"
                >
                  <option value="">{s.unassigned}</option>
                  {housekeepers.map(hk => (
                    <option key={hk.username} value={hk.username}>
                      {hk.full_name || hk.username}
                    </option>
                  ))}
                </select>
              </div>

              {/* notes */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{s.notes}</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="input resize-none"
                  placeholder="Internal notes…"
                />
              </div>
            </>
          )}

          {/* notes read-only for housekeeper */}
          {!isManager && ticket.notes && (
            <div>
              <p className="text-xs text-gray-400 mb-1">{s.notes}</p>
              <p className="text-sm text-gray-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">{ticket.notes}</p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* footer */}
        {isManager && (
          <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
            {ticket.status !== 'resolved' && (
              <button
                onClick={handleResolve}
                disabled={saving}
                className="btn btn-success flex items-center gap-1"
              >
                <CheckCircle2 size={14} />
                {s.markResolved}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn btn-primary flex items-center gap-1 ms-auto"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? s.saving : s.save}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function MaintenancePanel({ onCountChange }) {
  const { user }   = useAuthStore();
  const { lang }   = useLangStore();
  const s          = STRINGS[lang] || STRINGS.en;
  const isManager  = ['owner', 'admin', 'frontdesk'].includes(user?.role);

  const [tickets,      setTickets]      = useState([]);
  const [filter,       setFilter]       = useState('all');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [selected,     setSelected]     = useState(null);
  const [housekeepers, setHousekeepers] = useState([]);

  const fetchTickets = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const data = await api(`/api/maintenance${params}`);
      setTickets(data);
      // update open-count badge in DashboardPage tab
      if (onCountChange) {
        const allData = filter !== 'all' ? await api('/api/maintenance?status=open') : data;
        onCountChange(filter !== 'all' ? allData.length : data.filter(t => t.status === 'open').length);
      }
    } catch {
      setError(s.loadError);
    } finally {
      setLoading(false);
    }
  }, [filter, s.loadError, onCountChange]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // fetch housekeepers for assignment dropdown (managers only)
  useEffect(() => {
    if (!isManager) return;
    api('/api/housekeeping/housekeepers').then(setHousekeepers).catch(() => {});
  }, [isManager]);

  // SSE real-time updates
  useEffect(() => {
    const hotelStore = window.__hotelStore;
    if (!hotelStore) return;
    // Listen via a simple custom event emitted by the SSE handler if wired
    const handler = () => fetchTickets();
    window.addEventListener('maintenance_update', handler);
    return () => window.removeEventListener('maintenance_update', handler);
  }, [fetchTickets]);

  const openCount = tickets.filter(t => t.status === 'open').length;

  const FILTERS = [
    { key: 'all',         label: s.all },
    { key: 'open',        label: s.open },
    { key: 'in_progress', label: s.in_progress },
    { key: 'resolved',    label: s.resolved },
  ];

  return (
    <div className="card overflow-visible">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Wrench size={18} className="text-brand-500" />
          <h2 className="font-bold text-gray-800">{s.title}</h2>
          {openCount > 0 && (
            <span className="badge bg-red-50 text-red-600 border border-red-200 ms-1">
              {openCount} {s.openBadge}
            </span>
          )}
        </div>
        <button onClick={fetchTickets} disabled={loading} className="btn btn-ghost p-2" title={s.refresh}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* filter tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ms-1 opacity-70">
                ({tickets.filter(t => t.status === f.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="mt-3 min-h-[200px]">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={22} className="animate-spin text-gray-300" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-500 py-10">{error}</p>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-300">
            <CheckCircle2 size={36} />
            <p className="text-sm">{s.noTickets}</p>
          </div>
        ) : (
          tickets.map(ticket => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              s={s}
              onClick={() => setSelected(ticket)}
            />
          ))
        )}
      </div>

      {/* drawer */}
      {selected && (
        <TicketDrawer
          ticket={selected}
          s={s}
          isManager={isManager}
          housekeepers={housekeepers}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); fetchTickets(); }}
        />
      )}
    </div>
  );
}
