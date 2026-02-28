import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import RoomModal from '../components/RoomModal';
import { api, clearTokens } from '../utils/api';
import useHotelStore from '../store/hotelStore';

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
  const [loading, setLoading] = useState(true);
  const [lockout, setLockout] = useState(false);
  const [error, setError] = useState('');

  const rooms = useHotelStore(s => s.rooms);

  // Step 1 — validate session and fetch live room data
  useEffect(() => {
    let mounted = true;
    async function loadRoom() {
      try {
        const g = await api('/api/guest/room');
        if (!mounted) return;
        setRoom(g.room);
        if (g.hotelName) setHotelName(g.hotelName);

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

  // Step 2 — 5s polling for room telemetry (avoids JWT in URL that EventSource requires)
  useEffect(() => {
    if (!room) return;
    let mounted = true;

    const poll = () => {
      if (!mounted) return;
      api('/api/guest/room/data')
        .then(roomData => {
          if (!mounted || !roomData?.room) return;
          useHotelStore.setState(s => ({
            rooms: { ...s.rooms, [roomData.room]: roomData }
          }));
        })
        .catch(e => { if (mounted && e.message === 'session_expired') setLockout(true); });
    };

    const timer = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(timer); };
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
        <Building2 className="w-5 h-5 text-blue-200 shrink-0" />
        <div>
          <div className="text-lg font-bold leading-tight">{hotelName}</div>
          <div className="text-[11px] text-blue-200">iHotel · Guest Portal</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-blue-200">Room</div>
          <div className="text-base font-bold">{room}</div>
        </div>
      </header>

      {room && rooms[room] ? (
        <RoomModal
          roomId={room}
          onClose={() => {
            clearTokens();
            localStorage.removeItem('guestRoom');
            localStorage.removeItem('guestName');
            window.location.href = `/guest?room=${encodeURIComponent(room)}`;
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
