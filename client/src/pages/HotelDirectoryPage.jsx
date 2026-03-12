import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Star, ChevronRight, BedDouble, Wifi, Dumbbell, Search } from 'lucide-react';

const AMENITY_ICONS = { WiFi: Wifi, Gym: Dumbbell };

export default function HotelDirectoryPage() {
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState('en');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/public/hotels')
      .then(r => r.json())
      .then(data => { setHotels(data.hotels || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const T = (en, ar) => lang === 'ar' ? ar : en;
  const isRTL = lang === 'ar';

  const filtered = hotels.filter(h => {
    if (!search) return true;
    const q = search.toLowerCase();
    return h.name.toLowerCase().includes(q) ||
      (h.location || '').toLowerCase().includes(q) ||
      (h.description || '').toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="p-1.5 bg-white/10 rounded-lg"><BedDouble size={15} className="text-white" /></div>
            <span className="font-bold text-white tracking-tight text-sm">iHotel</span>
            <span className="hidden sm:inline text-[9px] font-semibold text-white/25 uppercase tracking-widest bg-white/8 px-2 py-0.5 rounded-full">
              {T('Book Now', 'احجز الآن')}
            </span>
          </Link>
          <button onClick={() => setLang(l => l === 'en' ? 'ar' : 'en')}
            className="text-white/40 hover:text-white/75 text-sm font-medium transition border border-white/10 px-3 py-1 rounded-lg hover:border-white/25">
            {lang === 'en' ? 'عربي' : 'EN'}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute -top-60 -left-60 w-[700px] h-[700px] bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-10 relative z-10">
          <div className="text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-300 font-medium">{T('Live Availability', 'التوافر المباشر')}</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-4">
              {T('Find Your Perfect', 'اعثر على')}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-indigo-300 to-purple-300">
                {T('Hotel Stay', 'إقامتك المثالية')}
              </span>
            </h1>
            <p className="text-white/40 text-base mb-8 max-w-md mx-auto">
              {T('Browse our partner hotels and book your room instantly. Smart rooms, real-time controls, and seamless check-in.',
                 'تصفّح فنادقنا الشريكة واحجز غرفتك فوراً. غرف ذكية وتحكم فوري وتسجيل دخول سلس.')}
            </p>

            {/* Search */}
            <div className="relative max-w-md mx-auto">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={T('Search hotels, cities...', 'ابحث عن فنادق، مدن...')}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 transition"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Hotels Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-50">🏨</div>
            <h2 className="text-xl font-bold text-white/60 mb-2">
              {hotels.length === 0
                ? T('No Hotels Available Yet', 'لا توجد فنادق متاحة حالياً')
                : T('No Matching Hotels', 'لا توجد فنادق مطابقة')}
            </h2>
            <p className="text-sm text-white/30">
              {hotels.length === 0
                ? T('Hotels will appear here once they enable online booking.', 'ستظهر الفنادق هنا عند تفعيل الحجز الإلكتروني.')
                : T('Try a different search term.', 'جرّب مصطلح بحث مختلف.')}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-white/25 uppercase tracking-widest font-semibold mb-6">
              {filtered.length} {T('hotels available', 'فنادق متاحة')}
            </p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(hotel => (
                <HotelCard key={hotel.slug} hotel={hotel} lang={lang} T={T} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-white/10 rounded"><BedDouble size={12} className="text-white" /></div>
            <span className="font-bold text-white text-sm">iHotel</span>
            <span className="text-white/20 text-xs">· {T('Smart Hotel Booking', 'حجز الفنادق الذكية')}</span>
          </div>
          <Link to="/" className="text-white/25 text-xs hover:text-white/50 transition">
            {T('Back to iHotel', 'العودة لـ iHotel')}
          </Link>
        </div>
      </footer>
    </div>
  );
}

function HotelCard({ hotel, lang, T }) {
  const hasHero = hotel.heroImageUrl;
  const desc = lang === 'ar' ? hotel.descriptionAr || hotel.description : hotel.description;
  const loc = lang === 'ar' ? hotel.locationAr || hotel.location : hotel.location;

  return (
    <Link to={`/book/${hotel.slug}`}
      className="group bg-white/5 border border-white/8 rounded-2xl overflow-hidden hover:border-blue-500/30 hover:bg-white/8 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5 flex flex-col">

      {/* Hero Image */}
      <div className="relative h-44 overflow-hidden bg-gradient-to-br from-slate-700 to-slate-800">
        {hasHero ? (
          <img src={hotel.heroImageUrl} alt={hotel.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BedDouble size={48} className="text-white/10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {hotel.startingFrom && (
          <div className="absolute top-3 right-3 bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg">
            {T('From', 'من')} {hotel.startingFrom.toLocaleString()} {hotel.currency}/{T('night', 'ليلة')}
          </div>
        )}
        {hotel.logoUrl && (
          <div className="absolute bottom-3 left-3">
            <img src={hotel.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain bg-white/90 p-1 shadow"
              onError={e => { e.target.style.display = 'none'; }} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-lg font-bold text-white group-hover:text-blue-300 transition mb-1">{hotel.name}</h3>
        {loc && (
          <p className="text-xs text-white/40 flex items-center gap-1 mb-2">
            <MapPin size={10} className="shrink-0" />{loc}
          </p>
        )}
        {desc && (
          <p className="text-xs text-white/30 line-clamp-2 mb-3 flex-1">{desc}</p>
        )}

        {/* Amenities */}
        {hotel.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {hotel.amenities.slice(0, 5).map(a => (
              <span key={a} className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-white/40 border border-white/5">{a}</span>
            ))}
            {hotel.amenities.length > 5 && (
              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-white/30">+{hotel.amenities.length - 5}</span>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
          <div className="text-xs text-white/30">
            {hotel.roomTypeCount > 0 && <span>{hotel.roomTypeCount} {T('room types', 'أنواع غرف')}</span>}
          </div>
          <span className="text-xs font-semibold text-blue-400 flex items-center gap-1 group-hover:gap-2 transition-all">
            {T('Book Now', 'احجز الآن')}
            <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
}
