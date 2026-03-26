import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import useLangStore from '../store/langStore';
import { t } from '../i18n';
import { Save, Upload, Trash2, Plus, Globe, ExternalLink } from 'lucide-react';

const AMENITY_OPTIONS = [
  'WiFi', 'Pool', 'Gym', 'Spa', 'Restaurant', 'Bar', 'Room Service',
  'Parking', 'Airport Shuttle', 'Business Center', 'Laundry', 'Concierge',
  'Kids Club', 'Beach Access', 'Balcony', 'Kitchen'
];

export default function HotelInfoPanel() {
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);

  const [profile, setProfile] = useState({
    description: '', descriptionAr: '', location: '', locationAr: '',
    phone: '', email: '', website: '', amenities: [],
    checkInTime: '15:00', checkOutTime: '12:00', currency: 'SAR',
    bookingEnabled: false, bookingTerms: '', bookingTermsAr: '',
    heroImageUrl: null
  });
  const [roomTypeInfo, setRoomTypeInfo] = useState([]);
  const [images, setImages] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [hotelSlug, setHotelSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(null);

  // Upsell catalog state
  const [catalog, setCatalog] = useState([]);
  const [offerForm, setOfferForm] = useState({ name: '', name_ar: '', category: 'SERVICE', price: '', unit: 'one-time', active: true, sort_order: 0, room_types: [] });
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [catalogSaved, setCatalogSaved] = useState(false);

  // Upsell stats state
  const [upsellStats, setUpsellStats] = useState([]);
  const [expandedStat, setExpandedStat] = useState(null);   // offerId whose room breakdown is open
  const [roomStats, setRoomStats] = useState({});            // { [offerId]: rows[] }
  const [roomStatsLoading, setRoomStatsLoading] = useState(false);

  useEffect(() => { load(); loadCatalog(); loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const data = await api('/api/hotel/profile');
      if (data.profile && Object.keys(data.profile).length) {
        const p = data.profile;
        setProfile({
          description: p.description || '', descriptionAr: p.description_ar || '',
          location: p.location || '', locationAr: p.location_ar || '',
          phone: p.phone || '', email: p.email || '', website: p.website || '',
          amenities: p.amenities ? JSON.parse(p.amenities) : [],
          checkInTime: p.check_in_time || '15:00', checkOutTime: p.check_out_time || '12:00',
          currency: p.currency || 'SAR', bookingEnabled: !!p.booking_enabled,
          bookingTerms: p.booking_terms || '', bookingTermsAr: p.booking_terms_ar || '',
          heroImageUrl: p.hero_image_url || null
        });
      }
      setRoomTypeInfo(data.roomTypeInfo || []);
      setImages(data.images || []);
      if (data.slug) setHotelSlug(data.slug);

      // Fetch room types from overview
      const overview = await api('/api/hotel/overview');
      const types = new Set();
      Object.values(overview.rooms || {}).forEach(r => { if (r.type) types.add(r.type); });
      setRoomTypes([...types].sort());
    } catch (e) { console.error('Load profile:', e.message); }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      await api('/api/hotel/profile', { method: 'PUT', body: JSON.stringify(profile) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setSaving(false); }
  }

  async function saveRoomTypeInfo(type, info) {
    try {
      await api(`/api/hotel/room-type-info/${encodeURIComponent(type)}`, {
        method: 'PUT', body: JSON.stringify(info)
      });
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  async function uploadImage(roomType, file) {
    setUploading(roomType);
    try {
      const form = new FormData();
      form.append('image', file);
      const resp = await fetch(`/api/hotel/room-type-images/${encodeURIComponent(roomType)}`, {
        method: 'POST', body: form,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
      });
      const data = await resp.json();
      if (data.success) load();
    } catch (e) { alert('Upload failed: ' + e.message); }
    finally { setUploading(null); }
  }

  async function deleteImage(id) {
    if (!confirm('Delete this image?')) return;
    try {
      await api(`/api/hotel/room-type-images/${id}`, { method: 'DELETE' });
      setImages(imgs => imgs.filter(i => i.id !== id));
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  async function uploadHero(file) {
    setUploading('hero');
    try {
      const form = new FormData();
      form.append('image', file);
      const resp = await fetch('/api/hotel/hero-image', {
        method: 'POST', body: form,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
      });
      const data = await resp.json();
      if (data.success) setProfile(p => ({ ...p, heroImageUrl: data.imageUrl }));
    } catch (e) { alert('Upload failed: ' + e.message); }
    finally { setUploading(null); }
  }

  async function loadCatalog() {
    try {
      const data = await api('/api/upsell/catalog');
      setCatalog(data);
    } catch {}
  }

  async function loadStats() {
    try {
      const data = await api('/api/upsell/stats');
      setUpsellStats(data);
    } catch {}
  }

  async function toggleRoomStats(offerId) {
    if (expandedStat === offerId) { setExpandedStat(null); return; }
    setExpandedStat(offerId);
    if (roomStats[offerId]) return; // already loaded
    setRoomStatsLoading(true);
    try {
      const data = await api(`/api/upsell/stats/${offerId}/rooms`);
      setRoomStats(prev => ({ ...prev, [offerId]: data }));
    } catch {} finally { setRoomStatsLoading(false); }
  }

  async function saveOffer() {
    if (!offerForm.name || !offerForm.name_ar || !offerForm.price) return;
    try {
      if (editingOffer) {
        await api(`/api/upsell/catalog/${editingOffer}`, { method: 'PATCH', body: JSON.stringify(offerForm) });
      } else {
        await api('/api/upsell/catalog', { method: 'POST', body: JSON.stringify(offerForm) });
      }
      setShowOfferForm(false);
      setEditingOffer(null);
      setOfferForm({ name: '', name_ar: '', category: 'SERVICE', price: '', unit: 'one-time', active: true, sort_order: 0, room_types: [] });
      setCatalogSaved(true);
      setTimeout(() => setCatalogSaved(false), 2000);
      loadCatalog();
    } catch (e) { alert('Save failed: ' + e.message); }
  }

  async function deleteOffer(id) {
    if (!confirm(T('upsell_delete_confirm'))) return;
    try {
      await api(`/api/upsell/catalog/${id}`, { method: 'DELETE' });
      setCatalog(prev => prev.filter(o => o.id !== id));
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  function startEditOffer(offer) {
    setEditingOffer(offer.id);
    let parsedRoomTypes = [];
    try { parsedRoomTypes = offer.room_types ? JSON.parse(offer.room_types) : []; } catch {}
    setOfferForm({ name: offer.name, name_ar: offer.name_ar, category: offer.category, price: offer.price, unit: offer.unit, active: !!offer.active, sort_order: offer.sort_order, room_types: parsedRoomTypes });
    setShowOfferForm(true);
  }

  const bookingUrl = profile.bookingEnabled && hotelSlug
    ? `${window.location.origin}/book/${hotelSlug}`
    : null;
  const kioskUrl = profile.bookingEnabled && hotelSlug
    ? `${window.location.origin}/kiosk/${hotelSlug}`
    : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Booking Toggle */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Globe size={16} />
              {lang === 'ar' ? 'الحجز الإلكتروني' : 'Online Booking'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {lang === 'ar' ? 'تفعيل صفحة الحجز العامة للضيوف' : 'Enable public booking page for guests'}
            </p>
          </div>
          <button onClick={() => setProfile(p => ({ ...p, bookingEnabled: !p.bookingEnabled }))}
            className={`toggle ${profile.bookingEnabled ? 'bg-emerald-500' : 'bg-gray-200'}`}>
            <div className={`toggle-knob ${profile.bookingEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {profile.bookingEnabled && hotelSlug && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg p-2">
              <ExternalLink size={12} />
              <span>{lang === 'ar' ? 'رابط الحجز:' : 'Booking link:'}</span>
              <code className="bg-white px-2 py-0.5 rounded text-[10px] font-mono flex-1">{bookingUrl}</code>
              <button onClick={() => { navigator.clipboard.writeText(bookingUrl); }} className="text-emerald-600 hover:text-emerald-800 font-bold">Copy</button>
            </div>
            <div className="flex items-center gap-2 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg p-2">
              <Globe size={12} />
              <span>{lang === 'ar' ? 'شاشة الكشك:' : 'Kiosk/outdoor screen:'}</span>
              <code className="bg-white px-2 py-0.5 rounded text-[10px] font-mono flex-1">{kioskUrl}</code>
              <button onClick={() => { navigator.clipboard.writeText(kioskUrl); }} className="text-blue-600 hover:text-blue-800 font-bold">Copy</button>
            </div>
          </div>
        )}
      </div>

      {/* Hotel Info */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3">
          {lang === 'ar' ? 'معلومات الفندق' : 'Hotel Information'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={lang === 'ar' ? 'الوصف (English)' : 'Description (English)'}>
            <textarea value={profile.description} onChange={e => setProfile(p => ({ ...p, description: e.target.value }))}
              className="input-field h-20 resize-none" />
          </Field>
          <Field label={lang === 'ar' ? 'الوصف (عربي)' : 'Description (Arabic)'}>
            <textarea value={profile.descriptionAr} onChange={e => setProfile(p => ({ ...p, descriptionAr: e.target.value }))}
              className="input-field h-20 resize-none" dir="rtl" />
          </Field>
          <Field label={lang === 'ar' ? 'الموقع (English)' : 'Location (English)'}>
            <input value={profile.location} onChange={e => setProfile(p => ({ ...p, location: e.target.value }))}
              className="input-field" />
          </Field>
          <Field label={lang === 'ar' ? 'الموقع (عربي)' : 'Location (Arabic)'}>
            <input value={profile.locationAr} onChange={e => setProfile(p => ({ ...p, locationAr: e.target.value }))}
              className="input-field" dir="rtl" />
          </Field>
          <Field label={lang === 'ar' ? 'الهاتف' : 'Phone'}>
            <input value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
              className="input-field" dir="ltr" />
          </Field>
          <Field label={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}>
            <input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
              className="input-field" dir="ltr" />
          </Field>
          <Field label={lang === 'ar' ? 'الموقع الإلكتروني' : 'Website'}>
            <input value={profile.website} onChange={e => setProfile(p => ({ ...p, website: e.target.value }))}
              className="input-field" dir="ltr" />
          </Field>
          <Field label={lang === 'ar' ? 'العملة' : 'Currency'}>
            <input value={profile.currency} onChange={e => setProfile(p => ({ ...p, currency: e.target.value }))}
              className="input-field w-24" dir="ltr" />
          </Field>
          <Field label={lang === 'ar' ? 'وقت تسجيل الدخول' : 'Check-in Time'}>
            <input type="time" value={profile.checkInTime} onChange={e => setProfile(p => ({ ...p, checkInTime: e.target.value }))}
              className="input-field w-32" />
          </Field>
          <Field label={lang === 'ar' ? 'وقت تسجيل الخروج' : 'Check-out Time'}>
            <input type="time" value={profile.checkOutTime} onChange={e => setProfile(p => ({ ...p, checkOutTime: e.target.value }))}
              className="input-field w-32" />
          </Field>
        </div>

        {/* Amenities */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-600 mb-2">{lang === 'ar' ? 'المرافق' : 'Amenities'}</div>
          <div className="flex flex-wrap gap-1.5">
            {AMENITY_OPTIONS.map(a => {
              const active = profile.amenities.includes(a);
              return (
                <button key={a}
                  onClick={() => setProfile(p => ({
                    ...p, amenities: active ? p.amenities.filter(x => x !== a) : [...p.amenities, a]
                  }))}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition ${
                    active ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'
                  }`}>
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hero Image */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-600 mb-2">{lang === 'ar' ? 'صورة الغلاف' : 'Hero Image'}</div>
          <div className="flex items-center gap-3">
            {profile.heroImageUrl && (
              <img src={profile.heroImageUrl} alt="Hero" className="h-20 w-32 rounded-lg object-cover border" />
            )}
            <label className="cursor-pointer px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 hover:bg-gray-100 transition flex items-center gap-1.5">
              <Upload size={12} />
              {uploading === 'hero' ? (lang === 'ar' ? 'جاري الرفع...' : 'Uploading...') : (lang === 'ar' ? 'رفع صورة' : 'Upload')}
              <input type="file" accept="image/*" className="hidden"
                onChange={e => { if (e.target.files[0]) uploadHero(e.target.files[0]); }} />
            </label>
          </div>
        </div>

        {/* Booking Terms */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={lang === 'ar' ? 'شروط الحجز (English)' : 'Booking Terms (English)'}>
            <textarea value={profile.bookingTerms} onChange={e => setProfile(p => ({ ...p, bookingTerms: e.target.value }))}
              className="input-field h-16 resize-none text-[11px]" />
          </Field>
          <Field label={lang === 'ar' ? 'شروط الحجز (عربي)' : 'Booking Terms (Arabic)'}>
            <textarea value={profile.bookingTermsAr} onChange={e => setProfile(p => ({ ...p, bookingTermsAr: e.target.value }))}
              className="input-field h-16 resize-none text-[11px]" dir="rtl" />
          </Field>
        </div>

        <button onClick={saveProfile} disabled={saving}
          className="mt-4 px-6 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-sm hover:bg-brand-600 transition disabled:opacity-50 flex items-center gap-2">
          <Save size={14} />
          {saved ? (lang === 'ar' ? 'تم الحفظ!' : 'Saved!') : saving ? (lang === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (lang === 'ar' ? 'حفظ' : 'Save Profile')}
        </button>
      </div>

      {/* Room Types */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3">
          {lang === 'ar' ? 'أنواع الغرف' : 'Room Types'}
        </h3>
        {roomTypes.length === 0 && (
          <p className="text-xs text-gray-400">{lang === 'ar' ? 'لا توجد أنواع غرف بعد' : 'No room types found. Rooms will appear after connecting to ThingsBoard.'}</p>
        )}
        <div className="space-y-4">
          {roomTypes.map(type => {
            const info = roomTypeInfo.find(i => i.room_type === type) || {};
            const typeImages = images.filter(i => i.room_type === type);
            return (
              <RoomTypeEditor key={type} type={type} info={info} images={typeImages}
                lang={lang} uploading={uploading}
                onSave={(updated) => saveRoomTypeInfo(type, updated)}
                onUpload={(file) => uploadImage(type, file)}
                onDeleteImage={deleteImage}
              />
            );
          })}
        </div>
      </div>

      {/* Upsell Offers Catalog */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">{T('upsell_catalog_title')}</h3>
          <div className="flex items-center gap-2">
            {catalogSaved && <span className="text-xs text-emerald-600 font-semibold">{T('upsell_saved_ok')}</span>}
            <button onClick={() => { setEditingOffer(null); setOfferForm({ name: '', name_ar: '', category: 'SERVICE', price: '', unit: 'one-time', active: true, sort_order: 0, room_types: [] }); setShowOfferForm(true); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition">
              <Plus size={12} /> {T('upsell_add_offer')}
            </button>
          </div>
        </div>

        {showOfferForm && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[9px] text-gray-400 uppercase mb-1">{T('upsell_offer_name')}</div>
                <input className="input" value={offerForm.name} onChange={e => setOfferForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Breakfast in Bed" />
              </div>
              <div>
                <div className="text-[9px] text-gray-400 uppercase mb-1">{T('upsell_offer_name_ar')}</div>
                <input className="input" dir="rtl" value={offerForm.name_ar} onChange={e => setOfferForm(f => ({ ...f, name_ar: e.target.value }))} placeholder="مثال: إفطار في السرير" />
              </div>
              <div>
                <div className="text-[9px] text-gray-400 uppercase mb-1">{lang === 'ar' ? 'الفئة' : 'Category'}</div>
                <select className="input" value={offerForm.category} onChange={e => setOfferForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="FOOD">{T('upsell_cat_food')}</option>
                  <option value="TRANSPORT">{T('upsell_cat_transport')}</option>
                  <option value="AMENITY">{T('upsell_cat_amenity')}</option>
                  <option value="SERVICE">{T('upsell_cat_service')}</option>
                </select>
              </div>
              <div>
                <div className="text-[9px] text-gray-400 uppercase mb-1">{T('upsell_price')} (SAR)</div>
                <input className="input" type="number" min="0" value={offerForm.price} onChange={e => setOfferForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div>
                <div className="text-[9px] text-gray-400 uppercase mb-1">{lang === 'ar' ? 'الوحدة' : 'Unit'}</div>
                <select className="input" value={offerForm.unit} onChange={e => setOfferForm(f => ({ ...f, unit: e.target.value }))}>
                  <option value="one-time">{T('upsell_unit_once')}</option>
                  <option value="per-night">{T('upsell_unit_night')}</option>
                  <option value="per-person">{T('upsell_unit_person')}</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={offerForm.active} onChange={e => setOfferForm(f => ({ ...f, active: e.target.checked }))} />
                  {lang === 'ar' ? 'نشط' : 'Active'}
                </label>
              </div>
              {/* Room type visibility filter — spans full row */}
              <div className="col-span-2 md:col-span-3">
                <div className="text-[9px] text-gray-400 uppercase mb-1.5">{T('upsell_room_types_filter')}</div>
                <div className="flex flex-wrap gap-2">
                  {roomTypes.length === 0 ? (
                    <span className="text-[10px] text-gray-400 italic">{lang === 'ar' ? 'لا توجد أنواع غرف' : 'No room types found'}</span>
                  ) : roomTypes.map(rt => {
                    const checked = offerForm.room_types.includes(rt);
                    return (
                      <label key={rt} className={`flex items-center gap-1 px-2.5 py-1 rounded-full border cursor-pointer text-[10px] font-semibold transition ${checked ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                        <input type="checkbox" className="hidden" checked={checked}
                          onChange={() => setOfferForm(f => ({
                            ...f,
                            room_types: checked
                              ? f.room_types.filter(x => x !== rt)
                              : [...f.room_types, rt]
                          }))} />
                        {rt}
                      </label>
                    );
                  })}
                  <span className="text-[9px] text-gray-300 self-center">{lang === 'ar' ? '(فارغ = جميع الغرف)' : '(empty = all rooms)'}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={saveOffer} className="btn btn-primary text-xs">{T('upsell_confirm')}</button>
              <button onClick={() => { setShowOfferForm(false); setEditingOffer(null); }} className="btn btn-ghost text-xs">{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </div>
        )}

        {catalog.length === 0 ? (
          <div className="text-xs text-gray-400 py-4 text-center">{T('upsell_no_offers')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] text-gray-400 uppercase border-b border-gray-100">
                  <th className="pb-1 text-left">{T('upsell_offer_name')}</th>
                  <th className="pb-1 text-left">{T('upsell_offer_name_ar')}</th>
                  <th className="pb-1 text-left">{lang === 'ar' ? 'الفئة' : 'Category'}</th>
                  <th className="pb-1 text-left">{T('upsell_price')}</th>
                  <th className="pb-1 text-left">{lang === 'ar' ? 'الوحدة' : 'Unit'}</th>
                  <th className="pb-1 text-center">{lang === 'ar' ? 'نشط' : 'Active'}</th>
                  <th className="pb-1 text-left">{T('upsell_room_types_filter')}</th>
                  <th className="pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {catalog.map(offer => (
                  <tr key={offer.id} className={`border-b border-gray-50 ${!offer.active ? 'opacity-50' : ''}`}>
                    <td className="py-1.5">{offer.name}</td>
                    <td className="py-1.5" dir="rtl">{offer.name_ar}</td>
                    <td className="py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-100 text-gray-500">{offer.category}</span>
                    </td>
                    <td className="py-1.5">{offer.price} SAR</td>
                    <td className="py-1.5">{offer.unit}</td>
                    <td className="py-1.5 text-center">{offer.active ? '✓' : '—'}</td>
                    <td className="py-1.5">
                      {offer.room_types
                        ? (() => { try { return JSON.parse(offer.room_types).join(', '); } catch { return offer.room_types; } })()
                        : <span className="text-gray-300 text-[9px]">{lang === 'ar' ? 'الكل' : 'All'}</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEditOffer(offer)}
                          className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
                          {lang === 'ar' ? 'تعديل' : 'Edit'}
                        </button>
                        <button onClick={() => deleteOffer(offer.id)}
                          className="px-2 py-0.5 text-[10px] font-semibold rounded bg-red-50 text-red-400 hover:bg-red-100 transition">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upsell Services Statistics */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">
            {lang === 'ar' ? '📊 إحصائيات الخدمات' : '📊 Service Statistics'}
          </h3>
          <button onClick={loadStats} className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold transition">
            {lang === 'ar' ? '↻ تحديث' : '↻ Refresh'}
          </button>
        </div>

        {upsellStats.length === 0 ? (
          <div className="text-xs text-gray-400 py-4 text-center">
            {lang === 'ar' ? 'لا توجد بيانات حتى الآن' : 'No requests recorded yet'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] text-gray-400 uppercase border-b border-gray-100">
                  <th className="pb-1 text-left">{lang === 'ar' ? 'الخدمة' : 'Service'}</th>
                  <th className="pb-1 text-center">{lang === 'ar' ? 'الطلبات' : 'Requests'}</th>
                  <th className="pb-1 text-center">{lang === 'ar' ? 'قيد الانتظار' : 'Pending'}</th>
                  <th className="pb-1 text-center">{lang === 'ar' ? 'مؤكد' : 'Confirmed'}</th>
                  <th className="pb-1 text-center">{lang === 'ar' ? 'تم التسليم' : 'Delivered'}</th>
                  <th className="pb-1 text-right">{lang === 'ar' ? 'الإيراد' : 'Revenue'}</th>
                  <th className="pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {upsellStats.map(stat => (
                  <React.Fragment key={stat.id}>
                    <tr className={`border-b border-gray-50 hover:bg-gray-50 transition ${expandedStat === stat.id ? 'bg-amber-50' : ''}`}>
                      <td className="py-2">
                        <div className="font-semibold text-gray-800">{lang === 'ar' ? stat.name_ar : stat.name}</div>
                        <div className="text-[9px] text-gray-400">{stat.category}</div>
                      </td>
                      <td className="py-2 text-center">
                        <span className="font-bold text-gray-700">{stat.total_requests}</span>
                        {stat.total_qty > 0 && <div className="text-[9px] text-gray-400">×{stat.total_qty} {lang === 'ar' ? 'قطعة' : 'units'}</div>}
                      </td>
                      <td className="py-2 text-center">
                        {stat.pending_count > 0
                          ? <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">{stat.pending_count}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-center">
                        {stat.confirmed_count > 0
                          ? <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">{stat.confirmed_count}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-center">
                        {stat.delivered_count > 0
                          ? <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700">{stat.delivered_count}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-700">
                        {stat.total_revenue > 0 ? `${stat.total_revenue.toLocaleString()} SAR` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        {stat.total_requests > 0 && (
                          <button
                            onClick={() => toggleRoomStats(stat.id)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                              expandedStat === stat.id
                                ? 'bg-amber-500 text-white'
                                : 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200'
                            }`}
                          >
                            {expandedStat === stat.id
                              ? (lang === 'ar' ? '▲ إخفاء' : '▲ Hide')
                              : (lang === 'ar' ? '▼ تفاصيل' : '▼ Details')}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Per-room breakdown accordion */}
                    {expandedStat === stat.id && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="bg-amber-50 border-b border-amber-100 px-4 py-3">
                            <div className="text-[9px] text-amber-600 uppercase tracking-widest font-semibold mb-2">
                              {lang === 'ar' ? `توزيع الطلبات على الغرف — ${stat.name_ar}` : `Room breakdown — ${stat.name}`}
                            </div>
                            {roomStatsLoading && !roomStats[stat.id] ? (
                              <div className="text-xs text-gray-400 py-2">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</div>
                            ) : !roomStats[stat.id] || roomStats[stat.id].length === 0 ? (
                              <div className="text-xs text-gray-400 py-2">{lang === 'ar' ? 'لا توجد بيانات' : 'No room data'}</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[9px] text-amber-500 uppercase">
                                    <th className="pb-1 text-left">{lang === 'ar' ? 'الغرفة' : 'Room'}</th>
                                    <th className="pb-1 text-center">{lang === 'ar' ? 'الطلبات' : 'Requests'}</th>
                                    <th className="pb-1 text-center">{lang === 'ar' ? 'الكمية' : 'Units'}</th>
                                    <th className="pb-1 text-right">{lang === 'ar' ? 'الإيراد' : 'Revenue'}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {roomStats[stat.id].map(row => (
                                    <tr key={row.room} className="border-t border-amber-100">
                                      <td className="py-1 font-mono font-bold text-gray-700">{lang === 'ar' ? 'غرفة' : 'Rm'} {row.room}</td>
                                      <td className="py-1 text-center text-gray-600">{row.total_requests}</td>
                                      <td className="py-1 text-center text-gray-500">×{row.total_qty}</td>
                                      <td className="py-1 text-right text-gray-700 font-semibold">{row.total_revenue > 0 ? `${row.total_revenue.toLocaleString()} SAR` : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomTypeEditor({ type, info, images, lang, uploading, onSave, onUpload, onDeleteImage }) {
  const [data, setData] = useState({
    description: info.description || '',
    descriptionAr: info.description_ar || '',
    maxGuests: info.max_guests || 2,
    bedType: info.bed_type || 'King',
    areaSqm: info.area_sqm || '',
    amenities: info.amenities ? JSON.parse(info.amenities) : []
  });
  const [dirty, setDirty] = useState(false);

  const update = (key, val) => { setData(d => ({ ...d, [key]: val })); setDirty(true); };

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded">{type}</span>
        {dirty && (
          <button onClick={() => { onSave(data); setDirty(false); }}
            className="text-[10px] px-3 py-1 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-600 transition">
            <Save size={10} className="inline mr-1" />
            {lang === 'ar' ? 'حفظ' : 'Save'}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-gray-400 mb-0.5">{lang === 'ar' ? 'الوصف' : 'Description'}</div>
          <input value={data.description} onChange={e => update('description', e.target.value)} className="input-field text-[11px]" />
        </div>
        <div>
          <div className="text-gray-400 mb-0.5">{lang === 'ar' ? 'الوصف عربي' : 'Desc (AR)'}</div>
          <input value={data.descriptionAr} onChange={e => update('descriptionAr', e.target.value)} className="input-field text-[11px]" dir="rtl" />
        </div>
        <div>
          <div className="text-gray-400 mb-0.5">{lang === 'ar' ? 'نوع السرير' : 'Bed Type'}</div>
          <input value={data.bedType} onChange={e => update('bedType', e.target.value)} className="input-field text-[11px]" />
        </div>
        <div>
          <div className="text-gray-400 mb-0.5">{lang === 'ar' ? 'الضيوف' : 'Max Guests'}</div>
          <input type="number" min="1" max="10" value={data.maxGuests} onChange={e => update('maxGuests', +e.target.value)} className="input-field text-[11px] w-16" />
        </div>
        <div>
          <div className="text-gray-400 mb-0.5">{lang === 'ar' ? 'المساحة م²' : 'Area (m²)'}</div>
          <input type="number" value={data.areaSqm} onChange={e => update('areaSqm', +e.target.value || '')} className="input-field text-[11px] w-20" />
        </div>
      </div>
      {/* Images */}
      <div className="mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          {images.map(img => (
            <div key={img.id} className="relative group">
              <img src={img.image_url} alt={type} className="h-16 w-24 rounded-lg object-cover border" />
              <button onClick={() => onDeleteImage(img.id)}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <Trash2 size={8} />
              </button>
            </div>
          ))}
          <label className="h-16 w-24 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 transition">
            {uploading === type ? <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <Plus size={16} className="text-gray-400" />}
            <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0]); }} />
          </label>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
