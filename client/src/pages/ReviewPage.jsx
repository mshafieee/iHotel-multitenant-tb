import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function StarSelector({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="flex gap-1 justify-center my-4">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className={`text-5xl transition-transform active:scale-95 hover:scale-110 select-none
            ${active >= n ? 'text-yellow-400 drop-shadow-sm' : 'text-gray-200'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function ReviewPage() {
  const [params] = useSearchParams();
  const token = params.get('t');

  const [status, setStatus] = useState('loading'); // loading | ready | already | error | done
  const [booking, setBooking] = useState(null);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); return; }
    fetch(`/api/public/review/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setStatus('error'); return; }
        setBooking(data);
        setStatus(data.alreadyReviewed ? 'already' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  const handleSubmit = async () => {
    if (!stars) { setSubmitError('Please select a star rating'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`/api/public/review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, reviewText: text }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Submission failed'); return; }
      setStatus('done');
    } catch { setSubmitError('Network error, please try again'); }
    finally { setSubmitting(false); }
  };

  // ── Shared card wrapper ────────────────────────────────────────────────────
  const Card = ({ children }) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {booking?.logoUrl && (
          <img src={booking.logoUrl} alt="hotel" className="h-12 mx-auto mb-3 object-contain" />
        )}
        {children}
      </div>
    </div>
  );

  if (status === 'loading') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (status === 'error') return (
    <Card>
      <div className="text-center">
        <div className="text-5xl mb-3">😕</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Link not found</h2>
        <p className="text-sm text-gray-500">This review link is invalid or has expired.</p>
      </div>
    </Card>
  );

  if (status === 'already') return (
    <Card>
      <div className="text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Already submitted</h2>
        <p className="text-sm text-gray-500">You have already shared your feedback for this stay. Thank you!</p>
      </div>
    </Card>
  );

  if (status === 'done') return (
    <Card>
      <div className="text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Thank you!</h2>
        <p className="text-sm text-gray-500 mb-3">
          Your {stars}★ review has been recorded. We hope to see you again at {booking?.hotelName}!
        </p>
        <div className="text-3xl">{Array(stars).fill('★').join('')}</div>
      </div>
    </Card>
  );

  // ── Ready — show form ──────────────────────────────────────────────────────
  const nights = booking.nights;
  const fmt = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-800 text-center mb-1">
        How was your stay?
      </h1>
      <p className="text-sm text-gray-400 text-center mb-4">{booking.hotelName}</p>

      {/* Pre-filled guest info */}
      <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Guest</span>
          <span className="font-semibold text-gray-700">{booking.guestName}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Room</span>
          <span className="font-semibold text-gray-700">{booking.room}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Stay</span>
          <span className="font-semibold text-gray-700">{fmt(booking.checkIn)} – {fmt(booking.checkOut)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Duration</span>
          <span className="font-semibold text-gray-700">{nights} night{nights !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Star selector */}
      <p className="text-center text-sm text-gray-500 mb-1">Tap to rate your experience</p>
      <StarSelector value={stars} onChange={setStars} />
      {stars > 0 && (
        <p className="text-center text-sm font-semibold text-yellow-500 mb-3">{STAR_LABELS[stars]}</p>
      )}

      {/* Optional review text */}
      <textarea
        className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700 placeholder-gray-300"
        rows={3}
        placeholder="Share more about your experience (optional)..."
        value={text}
        onChange={e => setText(e.target.value)}
        maxLength={500}
      />
      <div className="text-right text-[10px] text-gray-300 mb-3">{text.length}/500</div>

      {submitError && <p className="text-xs text-red-500 mb-2 text-center">{submitError}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !stars}
        className={`w-full py-3 rounded-xl font-bold text-sm transition
          ${stars ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
      >
        {submitting ? 'Submitting…' : 'Submit Review'}
      </button>
    </Card>
  );
}
