import React, { useMemo } from 'react';
import useHotelStore from '../store/hotelStore';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

const RATES = { STANDARD: 600, DELUXE: 950, SUITE: 1500, VIP: 2500 };
const STATUS_COLORS = ['#16A34A', '#2563EB', '#D97706', '#DC2626', '#8B5CF6'];
const STATUS_BG     = ['#DCFCE7', '#DBEAFE', '#FEF3C7', '#FEE2E2', '#EDE9FE'];

export default function KPIRow({ role }) {
  const rooms = useHotelStore(s => Object.values(s.rooms));
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const STATUS_LABELS = [T('status_vacant'), T('status_occupied'), T('status_service'), T('status_maintenance'), T('status_not_occupied')];

  const stats = useMemo(() => {
    const n = rooms.length || 1;
    const occ = rooms.filter(r => r.roomStatus === 1).length;
    const or = Math.round(occ / n * 100);
    const alerts  = rooms.filter(r => r.sosService).length;
    const offline = rooms.filter(r => !r.online).length;
    const avgTemp = +(rooms.reduce((s, r) => s + (r.temperature || 22), 0) / n).toFixed(1);
    const rev = rooms.filter(r => r.roomStatus === 1).reduce((s, r) => s + (RATES[r.roomType || r.type] || 0), 0);
    const mur = rooms.filter(r => r.murService).length;
    const dnd = rooms.filter(r => r.dndService).length;

    // Room status distribution
    const dist = STATUS_LABELS.map((label, i) => {
      const count = rooms.filter(r => r.roomStatus === i).length;
      return { label, count, pct: Math.round(count / n * 100), color: STATUS_COLORS[i], bg: STATUS_BG[i] };
    }).filter(d => d.count > 0);

    // Service flags sub-section
    const flags = [
      { label: 'MUR', count: mur, pct: Math.round(mur / n * 100), color: '#D97706' },
      { label: 'DND', count: dnd, pct: Math.round(dnd / n * 100), color: '#F97316' },
      { label: 'SOS', count: alerts, pct: Math.round(alerts / n * 100), color: '#DC2626' },
    ].filter(f => f.count > 0);

    return { n, occ, or, alerts, offline, avgTemp, rev, mur, dnd, dist, flags };
  }, [rooms]);

  const kpis = [
    { icon: '🏨', label: T('kpi_occupancy'), value: `${stats.or}%`, sub: `${stats.occ}/${stats.n}`, color: stats.or >= 70 ? 'text-emerald-600' : stats.or >= 40 ? 'text-amber-500' : 'text-red-500' },
    ...(role === 'owner' ? [{ icon: '💰', label: T('kpi_revenue'), value: `${stats.rev.toLocaleString()} ${T('sar')}`, color: 'text-brand-500' }] : []),
    { icon: '🚨', label: T('kpi_sos'), value: stats.alerts, color: stats.alerts > 0 ? 'text-red-500' : 'text-emerald-500' },
    { icon: '📡', label: T('kpi_offline'), value: stats.offline, color: stats.offline > 0 ? 'text-amber-500' : 'text-emerald-500' },
    { icon: '🌡', label: T('kpi_avg_temp'), value: `${stats.avgTemp}°`, color: 'text-blue-500' },
    { icon: '🧹', label: T('kpi_mur'), value: stats.mur, color: stats.mur > 0 ? 'text-amber-500' : 'text-gray-400' },
    { icon: '🔕', label: T('kpi_dnd'), value: stats.dnd, color: stats.dnd > 0 ? 'text-orange-500' : 'text-gray-400' },
  ];

  // Build conic gradient for donut chart
  let cumPct = 0;
  const segments = stats.dist.map(d => {
    const start = cumPct;
    cumPct += d.pct;
    return `${d.color} ${start}% ${cumPct}%`;
  });
  if (cumPct < 100) segments.push(`#E5E7EB ${cumPct}% 100%`);
  const conicGrad = `conic-gradient(${segments.join(', ')})`;

  return (
    <div className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
        {kpis.map((k, i) => (
          <div key={i} className="card p-3 flex items-center gap-2">
            <span className="text-lg">{k.icon}</span>
            <div>
              <div className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{k.label}</div>
              <div className={`text-base font-bold font-mono ${k.color}`}>{k.value}</div>
              {k.sub && <div className="text-[9px] text-gray-300">{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Room Status Distribution Chart */}
      <div className="card p-4">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">
          {T('kpi_dist_title')}
        </div>
        <div className="flex items-center gap-6">
          {/* Donut Chart */}
          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
            <div className="w-full h-full rounded-full" style={{ background: conicGrad }} />
            <div className="absolute inset-3 bg-white rounded-full flex flex-col items-center justify-center">
              <div className="text-lg font-bold text-gray-800">{stats.n}</div>
              <div className="text-[8px] text-gray-400 uppercase">{T('kpi_rooms_label')}</div>
            </div>
          </div>

          {/* Legend + Bars */}
          <div className="flex-1 space-y-1.5">
            {stats.dist.map(d => (
              <div key={d.label} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                <span className="text-[11px] text-gray-600 w-28 shrink-0">{d.label}</span>
                <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(d.pct, 2)}%`, background: d.color, opacity: 0.75 }} />
                </div>
                <span className="text-[11px] font-bold font-mono w-8 text-right" style={{ color: d.color }}>{d.count}</span>
                <span className="text-[9px] text-gray-400 w-8">{d.pct}%</span>
              </div>
            ))}

            {/* Service flags sub-section */}
            {stats.flags.length > 0 && (
              <div className="border-t border-gray-100 pt-1.5 mt-1.5">
                <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-1">{T('kpi_service_flags')}</div>
                {stats.flags.map(f => (
                  <div key={f.label} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: f.color }} />
                    <span className="text-[11px] text-gray-600 w-28 shrink-0">{f.label}</span>
                    <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(f.pct, 2)}%`, background: f.color, opacity: 0.75 }} />
                    </div>
                    <span className="text-[11px] font-bold font-mono w-8 text-right" style={{ color: f.color }}>{f.count}</span>
                    <span className="text-[9px] text-gray-400 w-8">{f.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
