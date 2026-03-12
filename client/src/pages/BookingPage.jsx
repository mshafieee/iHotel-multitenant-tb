import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Globe, Clock, Users, Bed, Maximize, ChevronLeft, ChevronRight, Check, Calendar, CreditCard, ShieldCheck, Lock, ArrowLeft, BedDouble } from 'lucide-react';

export default function BookingPage() {
  const { slug } = useParams();
  const [hotel, setHotel] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Booking form — 5 steps: dates → room → guest info → payment → confirmation
  const [step, setStep] = useState(1);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [availability, setAvailability] = useState({});
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [lang, setLang] = useState('en');
  const [imgIdx, setImgIdx] = useState({});

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardName, setCardName] = useState('');
  const [paying, setPaying] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/book/${slug}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error))))
      .then(data => { setHotel(data.hotel); setRoomTypes(data.roomTypes); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [slug]);

  // Default check-in = TODAY
  useEffect(() => {
    const today = new Date();
    setCheckIn(today.toISOString().split('T')[0]);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCheckOut(tomorrow.toISOString().split('T')[0]);
  }, []);

  // Check availability when dates change
  useEffect(() => {
    if (!checkIn || !checkOut || !hotel) return;
    fetch(`/api/public/book/${slug}/availability?checkIn=${checkIn}&checkOut=${checkOut}`)
      .then(r => r.json())
      .then(data => setAvailability(data.availability || {}))
      .catch(() => {});
  }, [checkIn, checkOut, slug, hotel]);

  const nights = checkIn && checkOut ? Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)) : 0;
  const selectedRate = roomTypes.find(r => r.type === selectedType);
  const totalAmount = selectedRate?.rate ? selectedRate.rate * nights : 0;

  async function handlePayAndBook() {
    if (!selectedType || !guestName || !checkIn || !checkOut) return;
    setPaying(true);
    // Simulate payment processing (1.5 sec)
    await new Promise(r => setTimeout(r, 1500));
    setPaymentDone(true);

    // Now create the actual reservation
    setBooking(true);
    try {
      const resp = await fetch(`/api/public/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomType: selectedType, guestName, guestEmail, guestPhone, checkIn, checkOut })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setResult(data);
      setStep(5);
    } catch (e) { alert(e.message); setPaymentDone(false); }
    finally { setBooking(false); setPaying(false); }
  }

  const T = (en, ar) => lang === 'ar' ? ar : en;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
          <BedDouble size={32} className="text-white/20" />
        </div>
        <h2 className="text-xl font-bold text-white/60 mb-2">Booking Not Available</h2>
        <p className="text-sm text-white/30 mb-6">{error}</p>
        <Link to="/book" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 justify-center">
          <ArrowLeft size={14} />Browse other hotels
        </Link>
      </div>
    </div>
  );

  const qrUrl = result ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(result.credentials.guestUrl)}` : '';

  // ──────────── Step 5: Confirmation ────────────
  if (step === 5 && result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-slate-900 to-slate-950">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="text-center mb-6">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-emerald-500/30">
              <Check size={36} className="text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">{T('Booking Confirmed!', 'تم تأكيد الحجز!')}</h1>
            <p className="text-sm text-white/40 mt-1">{T('Payment successful', 'تم الدفع بنجاح')} · {result.hotel.name}</p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Room', 'الغرفة')}</div>
                <div className="font-bold text-white">{result.booking.room} ({result.booking.roomType})</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Guest', 'الضيف')}</div>
                <div className="font-bold text-white">{result.booking.guestName}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Check-in', 'تسجيل الدخول')}</div>
                <div className="font-semibold text-white/80">{result.booking.checkIn}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Check-out', 'تسجيل الخروج')}</div>
                <div className="font-semibold text-white/80">{result.booking.checkOut}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Nights', 'الليالي')}</div>
                <div className="font-semibold text-white/80">{result.booking.nights}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase">{T('Total Paid', 'المبلغ المدفوع')}</div>
                <div className="font-bold text-emerald-400">
                  {result.booking.totalAmount?.toLocaleString()} {result.booking.currency}
                </div>
              </div>
            </div>

            <hr className="border-white/5" />

            {/* Credentials */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
              <div className="text-xs font-bold text-blue-300 mb-3 flex items-center gap-1.5">
                <Lock size={12} />
                {T('Room Access Credentials', 'بيانات الدخول للغرفة')}
              </div>
              <div className="text-center mb-3">
                <div className="text-[10px] text-blue-300/50 mb-1">{T('Room Code', 'رمز الغرفة')}</div>
                <div className="text-4xl font-mono font-bold text-white tracking-[0.3em]">
                  {result.credentials.password}
                </div>
              </div>
            </div>

            {/* QR Code */}
            <div className="text-center">
              <div className="text-[10px] text-white/30 mb-2">{T('Scan to access Guest Portal', 'امسح للدخول لبوابة الضيف')}</div>
              <div className="inline-block bg-white rounded-xl p-3">
                <img src={qrUrl} alt="QR Code" className="w-36 h-36" />
              </div>
            </div>

            {/* Guest Portal Link */}
            <div className="text-center">
              <a href={result.credentials.guestUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 bg-blue-600 text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-blue-700 transition">
                <Globe size={14} />
                {T('Open Guest Portal', 'فتح بوابة الضيف')}
              </a>
            </div>

            <p className="text-[10px] text-white/20 text-center">
              {T('Save your room code and QR code. You will need them to access your room controls.',
                 'احفظ رمز الغرفة ورمز QR. ستحتاجهما للتحكم بغرفتك.')}
            </p>
          </div>

          <div className="text-center mt-6">
            <Link to="/book" className="text-xs text-white/30 hover:text-white/50 transition">
              {T('Browse more hotels', 'تصفح المزيد من الفنادق')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ──────────── Main Booking Flow ────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="bg-slate-950/95 backdrop-blur-sm border-b border-white/5 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/book" className="text-white/30 hover:text-white/60 transition">
              <ArrowLeft size={16} />
            </Link>
            {hotel.logoUrl && (
              <img src={hotel.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain bg-white/10 p-0.5"
                onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div>
              <h1 className="text-sm font-bold text-white">{hotel.name}</h1>
              {hotel.location && (
                <p className="text-[10px] text-white/30 flex items-center gap-1">
                  <MapPin size={8} />{lang === 'ar' ? hotel.locationAr || hotel.location : hotel.location}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setLang(l => l === 'en' ? 'ar' : 'en')}
            className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-white/40 hover:text-white/60 hover:border-white/20 transition">
            {lang === 'en' ? 'عربي' : 'EN'}
          </button>
        </div>
      </header>

      {/* Hero Image */}
      {hotel.heroImageUrl && step === 1 && (
        <div className="relative h-48 md:h-64 overflow-hidden">
          <img src={hotel.heroImageUrl} alt={hotel.name} className="w-full h-full object-cover"
            onError={e => { e.target.parentElement.style.display = 'none'; }} />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <p className="text-sm max-w-xl text-white/70">
              {lang === 'ar' ? hotel.descriptionAr || hotel.description : hotel.description}
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Hotel Info Bar */}
        {step === 1 && (
          <div className="flex flex-wrap gap-3 mb-5 text-xs text-white/30">
            {hotel.phone && <span className="flex items-center gap-1"><Phone size={10} />{hotel.phone}</span>}
            {hotel.email && <span className="flex items-center gap-1"><Mail size={10} />{hotel.email}</span>}
            {hotel.website && <span className="flex items-center gap-1"><Globe size={10} />{hotel.website}</span>}
            <span className="flex items-center gap-1"><Clock size={10} />{T('In', 'الدخول')} {hotel.checkInTime} · {T('Out', 'الخروج')} {hotel.checkOutTime}</span>
          </div>
        )}

        {/* Amenities */}
        {step === 1 && hotel.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {hotel.amenities.map(a => (
              <span key={a} className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 text-[10px] font-semibold border border-blue-500/20">
                {a}
              </span>
            ))}
          </div>
        )}

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mb-6">
          {[
            { n: 1, label: T('Dates', 'التواريخ') },
            { n: 2, label: T('Room', 'الغرفة') },
            { n: 3, label: T('Details', 'البيانات') },
            { n: 4, label: T('Payment', 'الدفع') }
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                step === n ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' :
                step > n ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/30'
              }`}>{step > n ? <Check size={12} /> : n}</div>
              <span className={`text-xs font-medium hidden sm:block ${step === n ? 'text-blue-300' : 'text-white/25'}`}>{label}</span>
              {n < 4 && <div className={`w-6 sm:w-8 h-0.5 ${step > n ? 'bg-emerald-500' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {/* ──── Step 1: Dates ──── */}
        {step === 1 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Calendar size={18} className="text-blue-400" />
              {T('Select Dates', 'اختر التواريخ')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Check-in', 'تسجيل الدخول')}</label>
                <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Check-out', 'تسجيل الخروج')}</label>
                <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                  min={checkIn || new Date().toISOString().split('T')[0]}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40" />
              </div>
            </div>
            {nights > 0 && (
              <p className="text-sm text-white/40 mt-3">
                {nights} {T(nights === 1 ? 'night' : 'nights', nights === 1 ? 'ليلة' : 'ليالي')}
              </p>
            )}
            <button onClick={() => { if (nights > 0) setStep(2); }}
              disabled={nights <= 0}
              className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20">
              {T('Continue', 'متابعة')}
            </button>
          </div>
        )}

        {/* ──── Step 2: Room Type Selection ──── */}
        {step === 2 && (
          <div>
            <button onClick={() => setStep(1)} className="text-xs text-blue-400 mb-3 flex items-center gap-1 hover:text-blue-300 transition">
              <ChevronLeft size={12} />{T('Change dates', 'تغيير التواريخ')}
            </button>
            <h2 className="text-lg font-bold text-white mb-4">{T('Select Room Type', 'اختر نوع الغرفة')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roomTypes.map(rt => {
                const avail = availability[rt.type];
                const available = avail ? avail.available : '?';
                const total = rt.rate ? nights * rt.rate : null;
                const currentImg = imgIdx[rt.type] || 0;
                const hasImages = rt.images && rt.images.length > 0;

                return (
                  <div key={rt.type}
                    onClick={() => { if (available > 0) setSelectedType(rt.type); }}
                    className={`bg-white/5 border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 ${
                      selectedType === rt.type ? 'border-blue-500 shadow-xl shadow-blue-500/10 ring-1 ring-blue-500/30' :
                      available <= 0 ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/8 hover:border-white/20 hover:bg-white/8'
                    }`}>
                    {/* Image carousel */}
                    <div className="relative h-40 overflow-hidden bg-gradient-to-br from-slate-700 to-slate-800">
                      {hasImages ? (
                        <img src={rt.images[currentImg]?.url} alt={rt.type}
                          className="w-full h-full object-cover"
                          onError={e => {
                            e.target.src = '';
                            e.target.style.display = 'none';
                          }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BedDouble size={36} className="text-white/10" />
                        </div>
                      )}
                      {hasImages && rt.images.length > 1 && (
                        <>
                          <button onClick={e => { e.stopPropagation(); setImgIdx(idx => ({ ...idx, [rt.type]: (currentImg - 1 + rt.images.length) % rt.images.length })); }}
                            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-black/70 transition">
                            <ChevronLeft size={14} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); setImgIdx(idx => ({ ...idx, [rt.type]: (currentImg + 1) % rt.images.length })); }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-black/70 transition">
                            <ChevronRight size={14} />
                          </button>
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                            {rt.images.map((_, i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full transition ${i === currentImg ? 'bg-white' : 'bg-white/30'}`} />
                            ))}
                          </div>
                        </>
                      )}
                      {available > 0 && (
                        <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                          {available} {T('available', 'متاح')}
                        </div>
                      )}
                      {available <= 0 && available !== '?' && (
                        <div className="absolute top-2 right-2 bg-red-500/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {T('Sold out', 'نفدت')}
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-bold text-white">{rt.type}</h3>
                          <p className="text-xs text-white/30 mt-0.5">
                            {lang === 'ar' ? rt.descriptionAr || rt.description : rt.description}
                          </p>
                        </div>
                        {rt.rate && (
                          <div className="text-right">
                            <div className="text-lg font-bold text-blue-400">{rt.rate.toLocaleString()}</div>
                            <div className="text-[10px] text-white/25">{hotel.currency}/{T('night', 'ليلة')}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-3 mt-2 text-[10px] text-white/25">
                        {rt.maxGuests && <span className="flex items-center gap-0.5"><Users size={9} />{rt.maxGuests} {T('guests', 'ضيوف')}</span>}
                        {rt.bedType && <span className="flex items-center gap-0.5"><Bed size={9} />{rt.bedType}</span>}
                        {rt.areaSqm && <span className="flex items-center gap-0.5"><Maximize size={9} />{rt.areaSqm} m²</span>}
                      </div>
                      {rt.amenities?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {rt.amenities.map(a => (
                            <span key={a} className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-white/30">{a}</span>
                          ))}
                        </div>
                      )}
                      {total && (
                        <div className="mt-3 pt-2 border-t border-white/5 text-right">
                          <span className="text-sm font-bold text-white">
                            {T('Total:', 'الإجمالي:')} {total.toLocaleString()} {hotel.currency}
                          </span>
                          <span className="text-[10px] text-white/25 ml-1">({nights} {T('nights', 'ليالي')})</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedType && (
              <button onClick={() => setStep(3)}
                className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-600/20">
                {T('Continue', 'متابعة')}
              </button>
            )}
          </div>
        )}

        {/* ──── Step 3: Guest Info ──── */}
        {step === 3 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 max-w-lg mx-auto">
            <button onClick={() => setStep(2)} className="text-xs text-blue-400 mb-3 flex items-center gap-1 hover:text-blue-300">
              <ChevronLeft size={12} />{T('Change room', 'تغيير الغرفة')}
            </button>
            <h2 className="text-lg font-bold text-white mb-1">{T('Guest Information', 'بيانات الضيف')}</h2>
            <p className="text-xs text-white/25 mb-4">
              {selectedType} · {checkIn} → {checkOut} · {nights} {T('night(s)', 'ليالي')}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Full Name *', 'الاسم الكامل *')}</label>
                <input value={guestName} onChange={e => setGuestName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder={T('John Smith', 'محمد أحمد')} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Email', 'البريد الإلكتروني')}</label>
                <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40" dir="ltr" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Phone', 'الهاتف')}</label>
                <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/40" dir="ltr" />
              </div>
            </div>

            {/* Summary */}
            <div className="mt-4 bg-white/5 border border-white/5 rounded-xl p-3 text-sm">
              <div className="flex justify-between text-white/60">
                <span>{selectedType} × {nights} {T('nights', 'ليالي')}</span>
                <span className="font-bold text-white">
                  {totalAmount > 0 ? totalAmount.toLocaleString() + ' ' + hotel.currency : '—'}
                </span>
              </div>
            </div>

            {hotel.bookingTerms && (
              <p className="text-[10px] text-white/20 mt-3">
                {lang === 'ar' ? hotel.bookingTermsAr || hotel.bookingTerms : hotel.bookingTerms}
              </p>
            )}

            <button onClick={() => { if (guestName) setStep(4); }} disabled={!guestName}
              className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20">
              {T('Continue to Payment', 'المتابعة للدفع')}
            </button>
          </div>
        )}

        {/* ──── Step 4: Payment ──── */}
        {step === 4 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 max-w-lg mx-auto">
            <button onClick={() => setStep(3)} className="text-xs text-blue-400 mb-3 flex items-center gap-1 hover:text-blue-300">
              <ChevronLeft size={12} />{T('Back', 'رجوع')}
            </button>
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <CreditCard size={18} className="text-blue-400" />
              {T('Payment', 'الدفع')}
            </h2>

            {/* Order Summary */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 mb-5">
              <div className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-2">
                {T('Order Summary', 'ملخص الطلب')}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-white/50">
                  <span>{selectedType} × {nights} {T('nights', 'ليالي')}</span>
                  <span>{totalAmount > 0 ? totalAmount.toLocaleString() : '—'} {hotel.currency}</span>
                </div>
                <div className="flex justify-between text-white/30 text-xs">
                  <span>{T('Guest:', 'الضيف:')} {guestName}</span>
                  <span>{checkIn} → {checkOut}</span>
                </div>
                <div className="border-t border-white/5 pt-1.5 flex justify-between">
                  <span className="font-bold text-white">{T('Total', 'الإجمالي')}</span>
                  <span className="font-bold text-emerald-400 text-lg">
                    {totalAmount > 0 ? totalAmount.toLocaleString() : '—'} {hotel.currency}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method Tabs */}
            <div className="flex gap-2 mb-4">
              {[
                { id: 'card', label: T('Credit Card', 'بطاقة ائتمان'), icon: CreditCard },
                { id: 'applepay', label: 'Apple Pay' },
                { id: 'mada', label: 'mada' }
              ].map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setPaymentMethod(id)}
                  className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold border transition ${
                    paymentMethod === id
                      ? 'bg-blue-500/20 border-blue-500/30 text-blue-300'
                      : 'bg-white/5 border-white/5 text-white/30 hover:border-white/15'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Card Form */}
            {paymentMethod === 'card' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Card Number', 'رقم البطاقة')}</label>
                  <input value={cardNumber}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 16);
                      setCardNumber(v.replace(/(.{4})/g, '$1 ').trim());
                    }}
                    placeholder="4242 4242 4242 4242"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Cardholder Name', 'اسم حامل البطاقة')}</label>
                  <input value={cardName} onChange={e => setCardName(e.target.value)}
                    placeholder={T('JOHN SMITH', 'محمد أحمد')}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40" dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Expiry', 'الانتهاء')}</label>
                    <input value={cardExpiry}
                      onChange={e => {
                        let v = e.target.value.replace(/\D/g, '').slice(0, 4);
                        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
                        setCardExpiry(v);
                      }}
                      placeholder="MM/YY"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">CVC</label>
                    <input value={cardCvc}
                      onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="123"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === 'applepay' && (
              <div className="text-center py-8 bg-white/5 rounded-xl border border-white/5">
                <div className="text-3xl mb-2"></div>
                <p className="text-sm text-white/40">{T('Apple Pay will open automatically', 'سيتم فتح Apple Pay تلقائياً')}</p>
              </div>
            )}

            {paymentMethod === 'mada' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('mada Card Number', 'رقم بطاقة مدى')}</label>
                  <input value={cardNumber}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 16);
                      setCardNumber(v.replace(/(.{4})/g, '$1 ').trim());
                    }}
                    placeholder="4766 XXXX XXXX XXXX"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">{T('Expiry', 'الانتهاء')}</label>
                    <input value={cardExpiry}
                      onChange={e => {
                        let v = e.target.value.replace(/\D/g, '').slice(0, 4);
                        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
                        setCardExpiry(v);
                      }}
                      placeholder="MM/YY"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">CVC</label>
                    <input value={cardCvc}
                      onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="123"
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" dir="ltr" />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-4 text-[10px] text-white/20">
              <ShieldCheck size={12} className="text-emerald-400" />
              {T('Your payment information is encrypted and secure', 'بيانات الدفع مشفرة وآمنة')}
            </div>

            <button onClick={handlePayAndBook} disabled={paying || booking}
              className="mt-4 w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold text-sm hover:from-emerald-700 hover:to-emerald-600 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2">
              {paying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {paymentDone
                    ? T('Creating reservation...', 'جاري إنشاء الحجز...')
                    : T('Processing payment...', 'جاري معالجة الدفع...')}
                </>
              ) : (
                <>
                  <Lock size={14} />
                  {T(`Pay ${totalAmount > 0 ? totalAmount.toLocaleString() + ' ' + hotel.currency : ''} & Book`,
                     `ادفع ${totalAmount > 0 ? totalAmount.toLocaleString() + ' ' + hotel.currency : ''} واحجز`)}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
