import React, { useEffect, useState, useCallback } from 'react';
import { api, getAccessToken } from '../utils/api';

const ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];

export default function FinancePanel() {
  const [rates, setRates] = useState({});
  const [editingRates, setEditingRates] = useState(false);
  const [rateForm, setRateForm] = useState({});
  const [income, setIncome] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [r, i, s] = await Promise.all([
        api('/api/finance/rates'),
        api('/api/finance/income'),
        api('/api/finance/summary'),
      ]);
      const rateMap = {};
      r.forEach(row => { rateMap[row.room_type] = row.rate_per_night; });
      setRates(rateMap);
      setRateForm(rateMap);
      setIncome(i.rows || []);
      setSummary(s);
    } catch (e) { console.error('Finance fetch:', e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveRates = async () => {
    await api('/api/finance/rates', { method: 'PUT', body: JSON.stringify(rateForm) });
    setRates({ ...rateForm });
    setEditingRates(false);
  };

  const exportCSV = () => {
    const token = getAccessToken();
    fetch('/api/finance/income/export', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `income-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const clearLog = async () => {
    if (!confirm('Clear all income records? This cannot be undone.')) return;
    await api('/api/finance/income', { method: 'DELETE' });
    fetchAll();
  };

  if (loading) return <div className="card p-8 text-center text-gray-400">Loading finance data...</div>;

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-4 text-center">
            <div className="text-[9px] text-gray-400 uppercase tracking-widest mb-1">Total Revenue</div>
            <div className="text-2xl font-bold text-emerald-600">{summary.total?.toLocaleString() ?? 0}</div>
            <div className="text-[9px] text-gray-400">SAR</div>
          </div>
          {(summary.byPayment || []).map(p => (
            <div key={p.payment_method} className="card p-4 text-center">
              <div className="text-[9px] text-gray-400 uppercase tracking-widest mb-1">{(p.payment_method || 'Pending').toUpperCase()}</div>
              <div className="text-xl font-bold text-blue-600">{(p.amount || 0).toLocaleString()}</div>
              <div className="text-[9px] text-gray-400">{p.count} reservations</div>
            </div>
          ))}
        </div>
      )}

      {/* Revenue by room type */}
      {summary?.byType?.length > 0 && (
        <div className="card p-4">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">Revenue by Room Type</div>
          <div className="grid grid-cols-4 gap-3">
            {summary.byType.map(t => (
              <div key={t.room_type} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-[9px] text-gray-400 mb-1">{t.room_type}</div>
                <div className="font-bold text-gray-700">{(t.revenue || 0).toLocaleString()}</div>
                <div className="text-[9px] text-gray-400">{t.stays} stays · {t.nights} nights</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Night rates */}
      <div className="card p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">Night Rates (SAR)</div>
          {!editingRates
            ? <button onClick={() => setEditingRates(true)} className="btn btn-ghost text-xs">✏ Edit</button>
            : <div className="flex gap-2">
                <button onClick={saveRates} className="btn btn-primary text-xs">Save</button>
                <button onClick={() => { setEditingRates(false); setRateForm(rates); }} className="btn btn-ghost text-xs">Cancel</button>
              </div>
          }
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ROOM_TYPES.map(t => (
            <div key={t} className="text-center">
              <div className="text-[9px] text-gray-400 mb-1">{t}</div>
              {editingRates
                ? <input type="number" className="input text-center text-sm font-bold" value={rateForm[t] || ''} onChange={e => setRateForm({ ...rateForm, [t]: e.target.value })} />
                : <div className="text-lg font-bold text-brand-500">{(rates[t] || 0).toLocaleString()}</div>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Income log */}
      <div className="card p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">Checkout Income Log</div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition">⬇ Export CSV</button>
            <button onClick={clearLog} className="px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 transition">🗑 Clear</button>
          </div>
        </div>

        {!income.length
          ? <div className="text-center py-8 text-gray-300 text-sm">No income records yet</div>
          : <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] text-gray-400 uppercase border-b border-gray-100">
                    <th className="pb-2 text-left">Room</th>
                    <th className="pb-2 text-left">Guest</th>
                    <th className="pb-2 text-left">Check-In</th>
                    <th className="pb-2 text-left">Check-Out</th>
                    <th className="pb-2 text-center">Nights</th>
                    <th className="pb-2 text-center">Rate</th>
                    <th className="pb-2 text-center">Total</th>
                    <th className="pb-2 text-center">Payment</th>
                    <th className="pb-2 text-right">Elec Δ</th>
                    <th className="pb-2 text-right">Water Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {income.map(row => {
                    const elecDelta = (row.elec_at_checkout != null && row.elec_at_checkin != null)
                      ? (row.elec_at_checkout - row.elec_at_checkin).toFixed(2) : '—';
                    const waterDelta = (row.water_at_checkout != null && row.water_at_checkin != null)
                      ? (row.water_at_checkout - row.water_at_checkin).toFixed(3) : '—';
                    return (
                      <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 font-mono font-bold">{row.room}</td>
                        <td className="py-2 text-gray-600">{row.guest_name}</td>
                        <td className="py-2 text-gray-400">{row.check_in}</td>
                        <td className="py-2 text-gray-400">{row.check_out}</td>
                        <td className="py-2 text-center">{row.nights}</td>
                        <td className="py-2 text-center">{(row.rate_per_night || 0).toLocaleString()}</td>
                        <td className="py-2 text-center font-bold text-emerald-600">{(row.total_amount || 0).toLocaleString()}</td>
                        <td className="py-2 text-center">
                          <span className={`badge text-[9px] ${row.payment_method === 'cash' ? 'bg-emerald-50 text-emerald-600' : row.payment_method === 'visa' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                            {row.payment_method || 'pending'}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-500">{elecDelta} kWh</td>
                        <td className="py-2 text-right text-gray-500">{waterDelta} m³</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  );
}
