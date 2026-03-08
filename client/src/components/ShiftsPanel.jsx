import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import useAuthStore from '../store/authStore';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

export default function ShiftsPanel() {
  const { user } = useAuthStore();
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'admin';

  const [currentShift, setCurrentShift] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [closeForm, setCloseForm] = useState({ actualCash: '', actualVisa: '', notes: '' });
  const [expandedShift, setExpandedShift] = useState(null);
  const [shiftDetail, setShiftDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forceClosing, setForceClosing] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [cur, all] = await Promise.all([
        api('/api/shifts/current'),
        (isOwner || isAdmin) ? api('/api/shifts') : Promise.resolve([]),
      ]);
      setCurrentShift(cur);
      setShifts(all || []);
    } catch (e) { console.error('Shifts fetch:', e.message); }
    finally { setLoading(false); }
  }, [isOwner, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openShift = async () => {
    try { await api('/api/shifts/open', { method: 'POST' }); fetchData(); }
    catch (e) { setError(e.message); }
  };

  const closeShift = async () => {
    if (!closeForm.actualCash && !closeForm.actualVisa) {
      setError(lang === 'ar' ? 'أدخل المبلغ الفعلي للإغلاق' : 'Enter actual cash and/or visa amounts to close shift');
      return;
    }
    try {
      await api('/api/shifts/close', { method: 'POST', body: JSON.stringify(closeForm) });
      setCurrentShift(null);
      setCloseForm({ actualCash: '', actualVisa: '', notes: '' });
      fetchData();
    } catch (e) { setError(e.message); }
  };

  const forceCloseShift = async (shiftId, username) => {
    if (!confirm(lang === 'ar' ? `إغلاق وردية @${username} قسراً؟` : `Force-close shift for @${username}?`)) return;
    setForceClosing(shiftId);
    try {
      await api(`/api/shifts/${shiftId}/force-close`, { method: 'POST' });
      fetchData();
    } catch (e) { setError(e.message); }
    finally { setForceClosing(null); }
  };

  const loadDetail = async (id) => {
    if (expandedShift === id) { setExpandedShift(null); setShiftDetail(null); return; }
    setExpandedShift(id);
    try { setShiftDetail(await api(`/api/shifts/${id}`)); } catch {}
  };

  if (loading) return <div className="card p-8 text-center text-gray-400">{T('shf_loading')}</div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
          {error} <button onClick={() => setError('')} className="ml-2 font-bold">✕</button>
        </div>
      )}

      {/* Current shift status */}
      <div className="card p-4">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">{T('shf_my_shift')}</div>

        {!currentShift ? (
          <div className="text-center py-4">
            <div className="text-sm text-gray-500 mb-3">{T('shf_no_shift')}</div>
            <button onClick={openShift} className="btn btn-primary">{T('shf_open')}</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-emerald-700 text-sm">{T('shf_shift_open')}</div>
                  <div className="text-[10px] text-emerald-500">{T('shf_started')} {new Date(currentShift.opened_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-emerald-600 font-semibold">{T('shf_expected')}</div>
                  <div className="text-sm font-bold">{T('shf_cash')} {(currentShift.expectedCash || 0).toLocaleString()} {T('sar')}</div>
                  <div className="text-sm font-bold">{T('shf_visa')} {(currentShift.expectedVisa || 0).toLocaleString()} {T('sar')}</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="text-sm font-semibold mb-3 text-gray-700">{T('shf_close_title')}</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[9px] text-gray-400 uppercase">{T('shf_actual_cash')}</label>
                  <input type="number" className="input" placeholder="0.00" value={closeForm.actualCash}
                    onChange={e => setCloseForm({ ...closeForm, actualCash: e.target.value })} />
                  <div className="text-[9px] text-gray-400 mt-1">{T('shf_expected_label')} {(currentShift.expectedCash || 0).toLocaleString()}</div>
                </div>
                <div>
                  <label className="text-[9px] text-gray-400 uppercase">{T('shf_actual_visa')}</label>
                  <input type="number" className="input" placeholder="0.00" value={closeForm.actualVisa}
                    onChange={e => setCloseForm({ ...closeForm, actualVisa: e.target.value })} />
                  <div className="text-[9px] text-gray-400 mt-1">{T('shf_expected_label')} {(currentShift.expectedVisa || 0).toLocaleString()}</div>
                </div>
              </div>
              <div className="mb-3">
                <label className="text-[9px] text-gray-400 uppercase">{T('shf_notes')}</label>
                <input className="input" placeholder={T('shf_notes_ph')} value={closeForm.notes}
                  onChange={e => setCloseForm({ ...closeForm, notes: e.target.value })} />
              </div>
              <button onClick={closeShift} className="btn btn-primary w-full">{T('shf_close')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Shift history — owner/admin only */}
      {(isOwner || isAdmin) && (
        <div className="card p-4">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">{T('shf_history')}</div>
          {!shifts.length
            ? <div className="text-center py-6 text-gray-300 text-sm">{T('shf_no_history')}</div>
            : <div className="space-y-2">
                {shifts.map(s => {
                  const diffCash = (s.actual_cash || 0) - (s.expected_cash || 0);
                  const diffVisa = (s.actual_visa || 0) - (s.expected_visa || 0);
                  const isOpen = s.status === 'open';
                  return (
                    <div key={s.id} className="border border-gray-100 rounded-xl overflow-hidden">
                      <button onClick={() => loadDetail(s.id)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition text-left">
                        <div>
                          <div className="font-semibold text-sm text-gray-800">@{s.username}</div>
                          <div className="text-[9px] text-gray-400">
                            {new Date(s.opened_at).toLocaleString()}
                            {s.closed_at && ` → ${new Date(s.closed_at).toLocaleString()}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          {isOpen ? (
                            <div className="flex items-center gap-2">
                              <span className="badge bg-emerald-50 text-emerald-600 text-[9px]">{T('shf_status_open')}</span>
                              {/* Force close button */}
                              <button
                                onClick={e => { e.stopPropagation(); forceCloseShift(s.id, s.username); }}
                                disabled={forceClosing === s.id}
                                className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition disabled:opacity-50">
                                {forceClosing === s.id ? T('shf_force_closing') : T('shf_force_close')}
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs">
                              <span className={`font-bold ${diffCash >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {T('shf_cash')} {diffCash >= 0 ? '+' : ''}{diffCash.toFixed(0)}
                              </span>
                              {' · '}
                              <span className={`font-bold ${diffVisa >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {T('shf_visa')} {diffVisa >= 0 ? '+' : ''}{diffVisa.toFixed(0)}
                              </span>
                            </div>
                          )}
                          <span className="text-gray-300 text-xs">{expandedShift === s.id ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {expandedShift === s.id && shiftDetail && (
                        <div className="border-t border-gray-100 p-3 bg-gray-50">
                          <div className="grid grid-cols-4 gap-2 mb-3 text-center text-xs">
                            {[
                              [T('shf_exp_cash'), (shiftDetail.expected_cash || 0)],
                              [T('shf_act_cash'), (shiftDetail.actual_cash || 0), (shiftDetail.actual_cash || 0) < (shiftDetail.expected_cash || 0)],
                              [T('shf_exp_visa'), (shiftDetail.expected_visa || 0)],
                              [T('shf_act_visa'), (shiftDetail.actual_visa || 0), (shiftDetail.actual_visa || 0) < (shiftDetail.expected_visa || 0)],
                            ].map(([label, val, warn]) => (
                              <div key={label} className="bg-white rounded-lg p-2 border border-gray-100">
                                <div className="text-[9px] text-gray-400">{label}</div>
                                <div className={`font-bold ${warn ? 'text-red-500' : 'text-emerald-600'}`}>{(val).toLocaleString()}</div>
                              </div>
                            ))}
                          </div>
                          {shiftDetail.notes && <div className="text-xs text-gray-500 italic mb-2">{T('note')} {shiftDetail.notes}</div>}
                          {shiftDetail.entries?.length > 0 && (
                            <div className="text-[9px] text-gray-400 mt-2">{shiftDetail.entries.length} {T('shf_checkouts')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
          }
        </div>
      )}
    </div>
  );
}
