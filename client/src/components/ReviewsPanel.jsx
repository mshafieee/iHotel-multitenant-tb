import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';

function Stars({ n, size = 'text-base' }) {
  return (
    <span className={size}>
      {[1,2,3,4,5].map(i => (
        <span key={i} className={i <= n ? 'text-yellow-400' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

export default function ReviewsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try { setData(await api('/api/reviews')); }
    catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!data) return (
    <div className="card p-6 text-center text-gray-400 text-sm">Failed to load reviews.</div>
  );

  const { reviews, total, avgStars } = data;

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="card p-5">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mb-3">Guest Reviews</div>
        {total === 0 ? (
          <p className="text-sm text-gray-400">No reviews yet. Reviews appear here after guests check out and submit feedback.</p>
        ) : (
          <div className="flex items-center gap-5">
            <div className="text-center">
              <div className="text-5xl font-black text-gray-800">{avgStars?.toFixed(1)}</div>
              <Stars n={Math.round(avgStars)} size="text-xl" />
              <div className="text-[10px] text-gray-400 mt-1">{total} review{total !== 1 ? 's' : ''}</div>
            </div>
            {/* Distribution bars */}
            <div className="flex-1 space-y-1">
              {[5,4,3,2,1].map(s => {
                const count = reviews.filter(r => r.stars === s).length;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-3">{s}</span>
                    <span className="text-yellow-400 text-[10px]">★</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="bg-yellow-400 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-4">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Review list */}
      {reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map(r => (
            <div key={r.id} className="card p-4">
              <div className="flex justify-between items-start mb-1">
                <div>
                  <span className="font-semibold text-sm text-gray-800">{r.guest_name}</span>
                  <span className="text-[10px] text-gray-400 ml-2">Room {r.room} · {r.nights} night{r.nights !== 1 ? 's' : ''}</span>
                </div>
                <Stars n={r.stars} />
              </div>
              {r.review_text && (
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">"{r.review_text}"</p>
              )}
              <div className="text-[10px] text-gray-300 mt-2">
                {r.check_in} – {r.check_out} · {new Date(r.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
