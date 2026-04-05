import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import RoomModal from '../components/RoomModal';
import { api, clearTokens, createSSE } from '../utils/api';
import useHotelStore from '../store/hotelStore';
import useLangStore from '../store/langStore';

function LockoutScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-cyan-500 p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-6">
          <Building2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Room Access Suspended</h1>
        <p className="text-white/80 text-sm leading-relaxed mb-6">
          Dear Guest, your room access has been temporarily suspended.<br />
          Please visit the reception desk to renew your stay or arrange checkout.<br />
          We sincerely apologize for any inconvenience and are happy to assist you.
        </p>
        <div className="bg-white/10 backdrop-blur rounded-xl px-6 py-4">
          <p className="text-white/60 text-xs">📞 Reception — Dial 0 from your room phone</p>
        </div>
      </div>
    </div>
  );
}

export default function GuestPortal() {
  const [room, setRoom] = useState(null);
  const [hotelName, setHotelName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);
  const [deviceConfig, setDeviceConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lockout, setLockout] = useState(false);
  const [error, setError] = useState('');

  const rooms = useHotelStore(s => s.rooms);
  const { lang, setLang } = useLangStore();

  // Step 1 — validate session and fetch live room data
  useEffect(() => {
    let mounted = true;
    async function loadRoom() {
      try {
        const g = await api('/api/guest/room');
        if (!mounted) return;
        setRoom(g.room);
        if (g.hotelName) setHotelName(g.hotelName);
        if (g.logoUrl) setLogoUrl(g.logoUrl);
        if (g.deviceConfig) setDeviceConfig(g.deviceConfig);

        const roomData = await api('/api/guest/room/data');
        if (!mounted) return;
        if (roomData?.room) {
          useHotelStore.setState(s => ({
            rooms: { ...s.rooms, [roomData.room]: roomData }
          }));
        }
      } catch (e) {
        if (!mounted) return;
        if (e.message === 'session_expired') setLockout(true);
        else setError(e.message || 'Failed to load room');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadRoom();
    return () => { mounted = false; };
  }, []);

  // Step 2 — SSE for real-time room telemetry (same as admin/staff dashboard)
  useEffect(() => {
    if (!room) return;
    const es = createSSE();
    if (!es) return;

    const applyTelemetry = (roomNum, data) => {
      useHotelStore.setState(s => ({
        rooms: { ...s.rooms, [roomNum]: { ...s.rooms[roomNum], ...data } }
      }));
    };

    es.addEventListener('telemetry', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.room === room) applyTelemetry(d.room, d.data);
      } catch {}
    });

    // Server sends guest batch-telemetry as a plain 'telemetry' event already filtered to their room
    es.addEventListener('batch-telemetry', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.room === room) applyTelemetry(d.room, d.data);
      } catch {}
    });

    es.addEventListener('snapshot', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.rooms?.[room]) applyTelemetry(room, d.rooms[room]);
      } catch {}
    });

    es.onerror = () => {
      // SSE reconnects automatically — nothing to do
    };

    return () => es.close();
  }, [room]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading your room...</p>
      </div>
    </div>
  );

  if (lockout) return <LockoutScreen />;

  if (error) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-sm text-red-500">{error}</div>
    </div>
  );

  return (
    <div>
      {/* Hotel header */}
      <header className="bg-blue-700 text-white shadow-lg px-4 py-3 flex items-center gap-3">
        {logoUrl
          ? <img src={logoUrl} alt="logo" className="h-10 w-10 rounded-lg object-contain bg-white/10 p-0.5 shrink-0" />
          : <Building2 className="w-5 h-5 text-blue-200 shrink-0" />}
        <div>
          <div className="text-lg font-bold leading-tight">{hotelName}</div>
          <div className="text-[11px] text-blue-200">iHotel · Guest Portal</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="px-2.5 py-1 rounded-lg bg-white/15 text-white text-xs font-bold hover:bg-white/25 transition border border-white/20"
            title={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
          >
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
          <div className="text-right">
            <div className="text-xs text-blue-200">{lang === 'ar' ? 'الغرفة' : 'Room'}</div>
            <div className="text-base font-bold">{room}</div>
          </div>
        </div>
      </header>

      {room && rooms[room] ? (
        <RoomModal
          roomId={room}
          logoUrl={logoUrl}
          deviceConfig={deviceConfig}
          onClose={() => {
            clearTokens();
            localStorage.removeItem('guestRoom');
            localStorage.removeItem('guestName');
            const resToken = localStorage.getItem('guestReservationToken');
            localStorage.removeItem('guestReservationToken');
            window.location.href = resToken ? `/guest?token=${encodeURIComponent(resToken)}` : '/guest';
          }}
          onLockout={() => setLockout(true)}
          role="guest"
        />
      ) : (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-sm text-gray-400">No active reservation found</div>
        </div>
      )}
    </div>
  );
}
