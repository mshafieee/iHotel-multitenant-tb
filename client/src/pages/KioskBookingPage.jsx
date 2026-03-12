import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BedDouble, MapPin, Wifi, QrCode, Clock } from 'lucide-react';

/**
 * Kiosk/Outdoor Display Page — /kiosk/:slug
 *
 * Full-screen page designed for lobby/outdoor touch screens.
 * Shows hotel info, a large QR code linking to the booking page,
 * and rotates through room types with live availability.
 * Auto-refreshes every 60 seconds.
 */
export default function KioskBookingPage() {
  const { slug } = useParams();
  const [hotel, setHotel] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [availability, setAvailability] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [now, setNow] = useState(new Date());

  const bookingUrl = `${window.location.origin}/book/${slug}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(bookingUrl)}&bgcolor=ffffff&color=1e293b`;

  // Fetch hotel data
  function fetchData() {
    fetch(`/api/public/book/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        setHotel(data.hotel);
        setRoomTypes(data.roomTypes);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Check today's availability
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    fetch(`/api/public/book/${slug}/availability?checkIn=${today}&checkOut=${tomorrow}`)
      .then(r => r.json())
      .then(data => setAvailability(data.availability || {}))
      .catch(() => {});
  }

  useEffect(() => { fetchData(); }, [slug]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, [slug]);

  // Rotate room type slides every 5 seconds
  useEffect(() => {
    if (roomTypes.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlide(s => (s + 1) % roomTypes.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [roomTypes.length]);

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!hotel) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-white/30 text-lg">Hotel not found</p>
    </div>
  );

  const totalAvailable = Object.values(availability).reduce((s, v) => s + (v.available || 0), 0);
  const cheapestRate = roomTypes.reduce((min, rt) => rt.rate && (min === null || rt.rate < min) ? rt.rate : min, null);
  const currentRT = roomTypes[currentSlide] || null;
  const currentAvail = currentRT ? availability[currentRT.type] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col overflow-hidden select-none cursor-default">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-white/5">
        <div className="flex items-center gap-4">
          {hotel.logoUrl && (
            <img src={hotel.logoUrl} alt="" className="h-14 w-14 rounded-xl object-contain bg-white/10 p-1"
              onError={e => { e.target.style.display = 'none'; }} />
          )}
          <div>
            <h1 className="text-2xl font-bold text-white">{hotel.name}</h1>
            {hotel.location && (
              <p className="text-sm text-white/30 flex items-center gap-1.5">
                <MapPin size={12} />{hotel.location}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white font-mono tracking-wide">
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </div>
          <div className="text-sm text-white/25">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left Side — Hotel Info & Room Types */}
        <div className="flex-1 flex flex-col p-8 gap-6">
          {/* Availability Banner */}
          <div className="flex gap-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-6 py-4 flex-1">
              <div className="text-4xl font-bold text-emerald-400">{totalAvailable}</div>
              <div className="text-sm text-emerald-300/60 mt-1">Rooms Available Tonight</div>
              <div className="text-xs text-emerald-300/60">الغرف المتاحة الليلة</div>
            </div>
            {cheapestRate && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl px-6 py-4 flex-1">
                <div className="text-4xl font-bold text-blue-400">{cheapestRate.toLocaleString()}</div>
                <div className="text-sm text-blue-300/60 mt-1">{hotel.currency} / night · Starting from</div>
                <div className="text-xs text-blue-300/60">ابتداءً من · {hotel.currency} / ليلة</div>
              </div>
            )}
          </div>

          {/* Room Type Spotlight */}
          {currentRT && (
            <div className="flex-1 bg-white/5 border border-white/8 rounded-2xl overflow-hidden flex">
              {/* Room Image */}
              <div className="w-1/2 relative bg-gradient-to-br from-slate-700 to-slate-800">
                {currentRT.images?.length > 0 ? (
                  <img src={currentRT.images[0].url} alt={currentRT.type}
                    className="w-full h-full object-cover"
                    onError={e => { e.target.style.display = 'none'; }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <BedDouble size={64} className="text-white/10" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-slate-900/50" />
                {currentAvail && (
                  <div className={`absolute top-4 left-4 text-sm font-bold px-3 py-1.5 rounded-full ${
                    currentAvail.available > 0 ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                  }`}>
                    {currentAvail.available > 0 ? `${currentAvail.available} available` : 'Fully booked'}
                  </div>
                )}
                {/* Slide indicators */}
                {roomTypes.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {roomTypes.map((_, i) => (
                      <div key={i} className={`w-2 h-2 rounded-full transition-all ${i === currentSlide ? 'bg-white w-6' : 'bg-white/30'}`} />
                    ))}
                  </div>
                )}
              </div>
              {/* Room Info */}
              <div className="w-1/2 p-8 flex flex-col justify-center">
                <h2 className="text-3xl font-bold text-white mb-3">{currentRT.type}</h2>
                {currentRT.description && (
                  <p className="text-sm text-white/40 mb-4 leading-relaxed">{currentRT.description}</p>
                )}
                <div className="flex flex-wrap gap-4 text-sm text-white/30 mb-4">
                  {currentRT.maxGuests && (
                    <span className="flex items-center gap-1.5"><BedDouble size={14} />{currentRT.maxGuests} Guests</span>
                  )}
                  {currentRT.bedType && (
                    <span className="flex items-center gap-1.5">{currentRT.bedType} Bed</span>
                  )}
                  {currentRT.areaSqm && (
                    <span>{currentRT.areaSqm} m²</span>
                  )}
                </div>
                {currentRT.amenities?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {currentRT.amenities.map(a => (
                      <span key={a} className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-white/30 border border-white/5">{a}</span>
                    ))}
                  </div>
                )}
                {currentRT.rate && (
                  <div className="mt-auto">
                    <span className="text-4xl font-bold text-blue-400">{currentRT.rate.toLocaleString()}</span>
                    <span className="text-sm text-white/25 ml-2">{hotel.currency} / night</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hotel Amenities */}
          {hotel.amenities?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hotel.amenities.map(a => (
                <span key={a} className="px-3 py-1.5 rounded-full bg-white/5 text-xs text-white/30 border border-white/5 font-medium">{a}</span>
              ))}
            </div>
          )}
        </div>

        {/* Right Side — QR Code */}
        <div className="w-[380px] flex flex-col items-center justify-center p-8 border-l border-white/5 bg-white/[0.02]">
          <div className="text-center mb-6">
            <QrCode size={24} className="text-blue-400 mx-auto mb-2" />
            <h3 className="text-lg font-bold text-white mb-1">Book Your Room</h3>
            <p className="text-sm text-white/30">احجز غرفتك الآن</p>
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl shadow-blue-500/10 mb-6">
            <img src={qrUrl} alt="Scan to book" className="w-56 h-56" />
          </div>

          <p className="text-xs text-white/25 text-center mb-2">
            Scan with your phone camera
          </p>
          <p className="text-xs text-white/25 text-center mb-6 font-arabic">
            امسح الرمز بكاميرا هاتفك
          </p>

          <div className="bg-white/5 border border-white/5 rounded-xl px-4 py-2 text-center">
            <code className="text-[11px] text-blue-300 font-mono break-all">{bookingUrl}</code>
          </div>

          <div className="mt-6 flex items-center gap-2 text-[10px] text-white/15">
            <Wifi size={10} />
            <span>Powered by iHotel</span>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="flex items-center justify-between px-8 py-3 border-t border-white/5 bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-white/20" />
          <span className="text-xs text-white/20">
            Check-in: {hotel.checkInTime} · Check-out: {hotel.checkOutTime}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/20">Live availability · Auto-refreshes</span>
        </div>
      </div>
    </div>
  );
}
