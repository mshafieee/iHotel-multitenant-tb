import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import useAuthStore from '../store/authStore';

export default function ShiftsPanel() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'admin';

  const [currentShift, setCurrentShift] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [closeForm, setCloseForm] = useState({ actualCash: '', actualVisa: '', notes: '' });
  const [expandedShift, setExpandedShift] = useState(null);
  const [shiftDetail, setShiftDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    try {
      await api('/api/shifts/open', { method: 'POST' });
      fetchData();
    } catch (e) { setError(e.message); }
  };

  const closeShift = async () => {
    if (!closeForm.actualCash && !closeForm.actualVisa) {
      setError('Enter actual cash and/or visa amounts to close shift');
      return;
    }
    try {
      await api('/api/shifts/close', { method: 'POST', body: JSON.stringify(closeForm) });
      setCurrentShift(null);
      setCloseForm({ actualCash: '', actualVisa: '', notes: '' });
      fetchData();
    } catch (e) { setError(e.message); }
  };

  const loadDetail = async (id) => {
    if (expandedShift === id) { setExpandedShift(null); setShiftDetail(null); return; }
    setExpandedShift(id);
    try { setShiftDetail(await api(`/api/shifts/${id}`)); } catch {}
  };

  if (loading) return <div className="card p-8 text-center text-gray-400">Loading shifts...</div>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
          {error} <button onClick={() => setError('')} className="ml-2 font-bold">✕</button>
        </div>
      )}

      {/* Current shift status */}
      <div className="card p-4">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">My Shift</div>

        {!currentShift ? (
          <div className="text-center py-4">
            <div className="text-sm text-gray-500 mb-3">No open shift. Start your shift to begin tracking payments.</div>
            <button onClick={openShift} className="btn btn-primary">🕐 Open Shift</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-emerald-700 text-sm">Shift Open</div>
                  <div className="text-[10px] text-emerald-500">Started: {new Date(currentShift.opened_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-emerald-600 font-semibold">Expected</div>
                  <div className="text-sm font-bold">Cash: {(currentShift.expectedCash || 0).toLocaleString()} SAR</div>
                  <div className="text-sm font-bold">Visa: {(currentShift.expectedVisa || 0).toLocaleString()} SAR</div>
                </div>
              </div>
            </div>

            {/* Close shift form */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <div className="text-sm font-semibold mb-3 text-gray-700">Close Shift — Enter Actual Amounts</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[9px] text-gray-400 uppercase">Actual Cash (SAR)</label>
                  <input type="number" className="input" placeholder="0.00" value={closeForm.actualCash}
                    onChange={e => setCloseForm({ ...closeForm, actualCash: e.target.value })} />
                  <div className="text-[9px] text-gray-400 mt-1">Expected: {(currentShift.expectedCash || 0).toLocaleString()}</div>
                </div>
                <div>
                  <label className="text-[9px] text-gray-400 uppercase">Actual Visa (SAR)</label>
                  <input type="number" className="input" placeholder="0.00" value={closeForm.actualVisa}
                    onChange={e => setCloseForm({ ...closeForm, actualVisa: e.target.value })} />
                  <div className="text-[9px] text-gray-400 mt-1">Expected: {(currentShift.expectedVisa || 0).toLocaleString()}</div>
                </div>
              </div>
              <div className="mb-3">
                <label className="text-[9px] text-gray-400 uppercase">Notes (optional)</label>
                <input className="input" placeholder="Any discrepancy notes..." value={closeForm.notes}
                  onChange={e => setCloseForm({ ...closeForm, notes: e.target.value })} />
              </div>
              <button onClick={closeShift} className="btn btn-primary w-full">🔒 Close Shift</button>
            </div>
          </div>
        )}
      </div>

      {/* Shift history — owner/admin only */}
      {(isOwner || isAdmin) && (
        <div className="card p-4">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">Shift History</div>
          {!shifts.length
            ? <div className="text-center py-6 text-gray-300 text-sm">No shifts recorded yet</div>
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
                          <div className="text-[9px] text-gray-400">{new Date(s.opened_at).toLocaleString()} {s.closed_at && `→ ${new Date(s.closed_at).toLocaleString()}`}</div>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          {isOpen
                            ? <span className="badge bg-emerald-50 text-emerald-600 text-[9px]">OPEN</span>
                            : <div className="text-xs">
                                <span className={`font-bold ${diffCash >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>Cash Δ {diffCash >= 0 ? '+' : ''}{diffCash.toFixed(0)}</span>
                                {' · '}
                                <span className={`font-bold ${diffVisa >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>Visa Δ {diffVisa >= 0 ? '+' : ''}{diffVisa.toFixed(0)}</span>
                              </div>
                          }
                          <span className="text-gray-300 text-xs">{expandedShift === s.id ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {expandedShift === s.id && shiftDetail && (
                        <div className="border-t border-gray-100 p-3 bg-gray-50">
                          <div className="grid grid-cols-4 gap-2 mb-3 text-center text-xs">
                            <div className="bg-white rounded-lg p-2 border border-gray-100">
                              <div className="text-[9px] text-gray-400">Exp. Cash</div>
                              <div className="font-bold">{(shiftDetail.expected_cash || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-white rounded-lg p-2 border border-gray-100">
                              <div className="text-[9px] text-gray-400">Act. Cash</div>
                              <div className={`font-bold ${(shiftDetail.actual_cash || 0) < (shiftDetail.expected_cash || 0) ? 'text-red-500' : 'text-emerald-600'}`}>{(shiftDetail.actual_cash || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-white rounded-lg p-2 border border-gray-100">
                              <div className="text-[9px] text-gray-400">Exp. Visa</div>
                              <div className="font-bold">{(shiftDetail.expected_visa || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-white rounded-lg p-2 border border-gray-100">
                              <div className="text-[9px] text-gray-400">Act. Visa</div>
                              <div className={`font-bold ${(shiftDetail.actual_visa || 0) < (shiftDetail.expected_visa || 0) ? 'text-red-500' : 'text-emerald-600'}`}>{(shiftDetail.actual_visa || 0).toLocaleString()}</div>
                            </div>
                          </div>
                          {shiftDetail.notes && <div className="text-xs text-gray-500 italic mb-2">Note: {shiftDetail.notes}</div>}
                          {shiftDetail.entries?.length > 0 && (
                            <div className="text-[9px] text-gray-400 mt-2">{shiftDetail.entries.length} checkout(s) during this shift</div>
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
