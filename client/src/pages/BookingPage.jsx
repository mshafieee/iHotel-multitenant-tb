import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Phone, Mail, Globe, Clock, Users, Bed, Maximize, ChevronLeft, ChevronRight, Check, Calendar, Star } from 'lucide-react';

export default function BookingPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [hotel, setHotel] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Booking form
  const [step, setStep] = useState(1); // 1=dates, 2=room type, 3=guest info, 4=confirm
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
  const [imgIdx, setImgIdx] = useState({}); // { roomType: currentIndex }

  useEffect(() => {
    fetch(`/api/public/book/${slug}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error))))
      .then(data => { setHotel(data.hotel); setRoomTypes(data.roomTypes); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [slug]);

  // Set default check-in to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCheckIn(tomorrow.toISOString().split('T')[0]);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    setCheckOut(dayAfter.toISOString().split('T')[0]);
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

  async function handleBook() {
    if (!selectedType || !guestName || !checkIn || !checkOut) return;
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
      setStep(4);
    } catch (e) { alert(e.message); }
    finally { setBooking(false); }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-6xl mb-4">🏨</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Booking Not Available</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  );

  const T = (en, ar) => lang === 'ar' ? ar : en;

  // Step 4: Confirmation
  if (step === 4 && result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check size={32} className="text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{T('Booking Confirmed!', 'تم تأكيد الحجز!')}</h1>
            <p className="text-sm text-gray-500 mt-1">{result.hotel.name}</p>
          </div>

          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Room', 'الغرفة')}</div>
                <div className="font-bold text-gray-800">{result.booking.room} ({result.booking.roomType})</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Guest', 'الضيف')}</div>
                <div className="font-bold text-gray-800">{result.booking.guestName}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Check-in', 'تسجيل الدخول')}</div>
                <div className="font-semibold">{result.booking.checkIn}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Check-out', 'تسجيل الخروج')}</div>
                <div className="font-semibold">{result.booking.checkOut}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Nights', 'الليالي')}</div>
                <div className="font-semibold">{result.booking.nights}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase">{T('Total', 'الإجمالي')}</div>
                <div className="font-bold text-blue-600">
                  {result.booking.totalAmount?.toLocaleString()} {result.booking.currency}
                </div>
              </div>
            </div>

            <hr className="border-gray-100" />

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-xs font-bold text-blue-800 mb-2">{T('Room Access Credentials', 'بيانات الدخول للغرفة')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-blue-500">{T('Room Code', 'رمز الغرفة')}</div>
                  <div className="text-2xl font-mono font-bold text-blue-900 tracking-wider">
                    {result.credentials.password}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-[10px] text-blue-500 mb-1">{T('Guest Portal Link', 'رابط بوابة الضيف')}</div>
                <a href={result.credentials.guestUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-700 underline break-all">{result.credentials.guestUrl}</a>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 text-center">
              {T('Save these credentials. You will need the room code to access your room controls.',
                 'احفظ هذه البيانات. ستحتاج رمز الغرفة للوصول إلى التحكم بالغرفة.')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hotel.logoUrl && <img src={hotel.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />}
            <div>
              <h1 className="text-lg font-bold text-gray-900">{hotel.name}</h1>
              {hotel.location && <p className="text-[10px] text-gray-400 flex items-center gap-1"><MapPin size={9} />{lang === 'ar' ? hotel.locationAr || hotel.location : hotel.location}</p>}
            </div>
          </div>
          <button onClick={() => setLang(l => l === 'en' ? 'ar' : 'en')}
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
            {lang === 'en' ? 'عربي' : 'EN'}
          </button>
        </div>
      </header>

      {/* Hero */}
      {hotel.heroImageUrl && step === 1 && (
        <div className="relative h-48 md:h-64 overflow-hidden">
          <img src={hotel.heroImageUrl} alt={hotel.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <p className="text-sm max-w-xl">
              {lang === 'ar' ? hotel.descriptionAr || hotel.description : hotel.description}
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Hotel Info Bar */}
        {step === 1 && (
          <div className="flex flex-wrap gap-3 mb-6 text-xs text-gray-500">
            {hotel.phone && <span className="flex items-center gap-1"><Phone size={10} />{hotel.phone}</span>}
            {hotel.email && <span className="flex items-center gap-1"><Mail size={10} />{hotel.email}</span>}
            {hotel.website && <span className="flex items-center gap-1"><Globe size={10} />{hotel.website}</span>}
            <span className="flex items-center gap-1"><Clock size={10} />{T('Check-in', 'الدخول')} {hotel.checkInTime} · {T('Check-out', 'الخروج')} {hotel.checkOutTime}</span>
          </div>
        )}

        {/* Amenities */}
        {step === 1 && hotel.amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {hotel.amenities.map(a => (
              <span key={a} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-100">
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
            { n: 3, label: T('Details', 'البيانات') }
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                step === n ? 'bg-blue-600 text-white' : step > n ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'
              }`}>{step > n ? <Check size={12} /> : n}</div>
              <span className={`text-xs font-medium ${step === n ? 'text-blue-700' : 'text-gray-400'}`}>{label}</span>
              {n < 3 && <div className={`w-8 h-0.5 ${step > n ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Dates */}
        {step === 1 && (
          <div className="card p-5">
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Calendar size={18} />
              {T('Select Dates', 'اختر التواريخ')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{T('Check-in', 'تسجيل الدخول')}</label>
                <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="input-field w-full text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{T('Check-out', 'تسجيل الخروج')}</label>
                <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                  min={checkIn || new Date().toISOString().split('T')[0]}
                  className="input-field w-full text-sm" />
              </div>
            </div>
            {nights > 0 && (
              <p className="text-sm text-gray-500 mt-3">
                {nights} {T('night(s)', nights > 1 ? 'ليالي' : 'ليلة')}
              </p>
            )}
            <button onClick={() => { if (nights > 0) setStep(2); }}
              disabled={nights <= 0}
              className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition disabled:opacity-40">
              {T('Continue', 'متابعة')}
            </button>
          </div>
        )}

        {/* Step 2: Room Type Selection */}
        {step === 2 && (
          <div>
            <button onClick={() => setStep(1)} className="text-xs text-blue-600 mb-3 flex items-center gap-1 hover:underline">
              <ChevronLeft size={12} />{T('Change dates', 'تغيير التواريخ')}
            </button>
            <h2 className="text-lg font-bold text-gray-800 mb-4">{T('Select Room Type', 'اختر نوع الغرفة')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roomTypes.map(rt => {
                const avail = availability[rt.type];
                const available = avail ? avail.available : '?';
                const total = rt.rate ? nights * rt.rate : null;
                const currentImg = imgIdx[rt.type] || 0;

                return (
                  <div key={rt.type}
                    onClick={() => { if (available > 0) setSelectedType(rt.type); }}
                    className={`card overflow-hidden cursor-pointer transition border-2 ${
                      selectedType === rt.type ? 'border-blue-500 shadow-lg shadow-blue-100' :
                      available <= 0 ? 'border-gray-200 opacity-50 cursor-not-allowed' : 'border-transparent hover:border-blue-200'
                    }`}>
                    {/* Image carousel */}
                    {rt.images.length > 0 && (
                      <div className="relative h-40 overflow-hidden">
                        <img src={rt.images[currentImg]?.url} alt={rt.type} className="w-full h-full object-cover" />
                        {rt.images.length > 1 && (
                          <>
                            <button onClick={e => { e.stopPropagation(); setImgIdx(idx => ({ ...idx, [rt.type]: (currentImg - 1 + rt.images.length) % rt.images.length })); }}
                              className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full w-6 h-6 flex items-center justify-center">
                              <ChevronLeft size={14} />
                            </button>
                            <button onClick={e => { e.stopPropagation(); setImgIdx(idx => ({ ...idx, [rt.type]: (currentImg + 1) % rt.images.length })); }}
                              className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 text-white rounded-full w-6 h-6 flex items-center justify-center">
                              <ChevronRight size={14} />
                            </button>
                          </>
                        )}
                        {available > 0 && (
                          <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {available} {T('available', 'متاح')}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-bold text-gray-900">{rt.type}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {lang === 'ar' ? rt.descriptionAr || rt.description : rt.description}
                          </p>
                        </div>
                        {rt.rate && (
                          <div className="text-right">
                            <div className="text-lg font-bold text-blue-600">{rt.rate.toLocaleString()}</div>
                            <div className="text-[10px] text-gray-400">{hotel.currency}/{T('night', 'ليلة')}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
                        {rt.maxGuests && <span className="flex items-center gap-0.5"><Users size={9} />{rt.maxGuests} {T('guests', 'ضيوف')}</span>}
                        {rt.bedType && <span className="flex items-center gap-0.5"><Bed size={9} />{rt.bedType}</span>}
                        {rt.areaSqm && <span className="flex items-center gap-0.5"><Maximize size={9} />{rt.areaSqm} m²</span>}
                      </div>
                      {rt.amenities?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {rt.amenities.map(a => (
                            <span key={a} className="px-1.5 py-0.5 rounded bg-gray-100 text-[9px] text-gray-500">{a}</span>
                          ))}
                        </div>
                      )}
                      {total && (
                        <div className="mt-3 pt-2 border-t border-gray-100 text-right">
                          <span className="text-sm font-bold text-gray-800">
                            {T('Total:', 'الإجمالي:')} {total.toLocaleString()} {hotel.currency}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-1">({nights} {T('nights', 'ليالي')})</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedType && (
              <button onClick={() => setStep(3)}
                className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition">
                {T('Continue', 'متابعة')}
              </button>
            )}
          </div>
        )}

        {/* Step 3: Guest Info */}
        {step === 3 && (
          <div className="card p-5 max-w-lg mx-auto">
            <button onClick={() => setStep(2)} className="text-xs text-blue-600 mb-3 flex items-center gap-1 hover:underline">
              <ChevronLeft size={12} />{T('Change room', 'تغيير الغرفة')}
            </button>
            <h2 className="text-lg font-bold text-gray-800 mb-1">{T('Guest Information', 'بيانات الضيف')}</h2>
            <p className="text-xs text-gray-400 mb-4">
              {selectedType} · {checkIn} → {checkOut} · {nights} {T('night(s)', 'ليالي')}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{T('Full Name *', 'الاسم الكامل *')}</label>
                <input value={guestName} onChange={e => setGuestName(e.target.value)}
                  className="input-field w-full" placeholder={T('John Smith', 'محمد أحمد')} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{T('Email', 'البريد الإلكتروني')}</label>
                <input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)}
                  className="input-field w-full" dir="ltr" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">{T('Phone', 'الهاتف')}</label>
                <input type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                  className="input-field w-full" dir="ltr" />
              </div>
            </div>

            {/* Summary */}
            {selectedType && (
              <div className="mt-4 bg-gray-50 rounded-xl p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{selectedType} × {nights} {T('nights', 'ليالي')}</span>
                  <span className="font-bold">
                    {(() => {
                      const rt = roomTypes.find(r => r.type === selectedType);
                      return rt?.rate ? (rt.rate * nights).toLocaleString() + ' ' + hotel.currency : '—';
                    })()}
                  </span>
                </div>
              </div>
            )}

            {hotel.bookingTerms && (
              <p className="text-[10px] text-gray-400 mt-3">
                {lang === 'ar' ? hotel.bookingTermsAr || hotel.bookingTerms : hotel.bookingTerms}
              </p>
            )}

            <button onClick={handleBook} disabled={!guestName || booking}
              className="mt-4 w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition disabled:opacity-40">
              {booking ? T('Booking...', 'جاري الحجز...') : T('Confirm Booking', 'تأكيد الحجز')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
