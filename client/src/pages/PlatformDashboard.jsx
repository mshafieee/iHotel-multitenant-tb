import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Users, BedDouble, Activity, DollarSign,
  Plus, RefreshCw, Upload, X, ChevronRight, Shield, LogOut,
  Copy, Check, Search, Wifi
} from 'lucide-react';
import usePlatformStore from '../store/platformStore';

// ── Utility ─────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SAR`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K SAR`;
  return `${Number(n).toFixed(0)} SAR`;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} className="ml-1 text-gray-400 hover:text-gray-600">
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color = 'text-brand-600' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg bg-gray-50 ${color}`}><Icon size={20} /></div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Create Hotel Modal ───────────────────────────────────────────────────────
function CreateHotelModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', slug: '', contactEmail: '', plan: 'starter', tbHost: '', tbUser: '', tbPass: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await onCreate(form);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={16} className="text-green-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-800">Hotel Created!</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Hotel Code (slug)</p>
              <p className="font-mono font-bold text-gray-800">{result.hotel.slug} <CopyButton text={result.hotel.slug} /></p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-400 uppercase mb-1">Default Staff Password</p>
              <p className="font-mono font-bold text-amber-800">{result.defaultUserPassword} <CopyButton text={result.defaultUserPassword} /></p>
              <p className="text-xs text-amber-600 mt-1">Instruct hotel staff to change this immediately.</p>
            </div>
          </div>
          <button onClick={onClose} className="mt-4 btn btn-primary w-full">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-800">Create New Hotel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hotel Name</label>
            <input className="input" value={form.name} onChange={e => update('name', e.target.value)}
              placeholder="Hilton Grand Hotel" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Hotel Code <span className="text-gray-400 normal-case font-normal">(slug — lowercase, hyphens)</span>
            </label>
            <input className="input font-mono" value={form.slug}
              onChange={e => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="hilton-grand" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Contact Email</label>
            <input className="input" type="email" value={form.contactEmail}
              onChange={e => update('contactEmail', e.target.value)} placeholder="manager@hilton.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Plan</label>
            <select className="input" value={form.plan} onChange={e => update('plan', e.target.value)}>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ThingsBoard Credentials <span className="text-gray-400 normal-case font-normal">(optional — can set later)</span></p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">TB Host URL</label>
                <input className="input text-sm font-mono" value={form.tbHost}
                  onChange={e => update('tbHost', e.target.value)} placeholder="http://thingsboard.example.com:8080" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">TB Username</label>
                  <input className="input text-sm" value={form.tbUser}
                    onChange={e => update('tbUser', e.target.value)} placeholder="admin@hotel.com" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">TB Password</label>
                  <input className="input text-sm" type="password" value={form.tbPass}
                    onChange={e => update('tbPass', e.target.value)} placeholder="••••••••" />
                </div>
              </div>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Hotel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import Rooms Modal ───────────────────────────────────────────────────────
function ImportRoomsModal({ hotel, onClose, onImport }) {
  const [csvText, setCsvText] = useState('room_number,floor,room_type\n101,1,STANDARD\n102,1,STANDARD\n201,2,DELUXE\n');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleImport = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await onImport(hotel.id, { csv: csvText });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Import Rooms — {hotel.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {result ? (
          <div className="space-y-3">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{result.inserted}</p>
              <p className="text-sm text-green-600">rooms imported</p>
              {result.errors > 0 && <p className="text-xs text-amber-600 mt-1">{result.errors} rows skipped (invalid data)</p>}
            </div>
            <button onClick={onClose} className="btn btn-primary w-full">Done</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-2">
              CSV: <span className="font-mono">room_number,floor,room_type</span> · Types: STANDARD, DELUXE, SUITE, VIP
            </p>
            <textarea className="input font-mono text-xs h-48 resize-y" value={csvText}
              onChange={e => setCsvText(e.target.value)} />
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2">{error}</div>}
            <div className="flex gap-3 mt-4">
              <button onClick={onClose} className="btn flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleImport} disabled={loading} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                <Upload size={15} />
                {loading ? 'Importing...' : 'Import Rooms'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Hotel Detail Drawer ──────────────────────────────────────────────────────
function HotelDetail({ hotelId, onClose, onImportRooms }) {
  const { fetchHotelDetail, updateHotel, fetchUsers, createUser, updateUser, discoverRooms } = usePlatformStore();
  const [hotel, setHotel] = useState(null);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'frontdesk', fullName: '' });
  const [userMsg, setUserMsg] = useState('');
  const [editTB, setEditTB] = useState(false);
  const [tbForm, setTBForm] = useState({ tbHost: '', tbUser: '', tbPass: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [h, u] = await Promise.all([fetchHotelDetail(hotelId), fetchUsers(hotelId)]);
    setHotel(h);
    setUsers(u);
    setTBForm({ tbHost: h?.tbHost || '', tbUser: h?.tbUser || '', tbPass: '' });
    setLoading(false);
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUser(hotelId, newUser);
      setUserMsg('User created.');
      setNewUser({ username: '', password: '', role: 'frontdesk', fullName: '' });
      const u = await fetchUsers(hotelId);
      setUsers(u);
    } catch (e) { setUserMsg(e.message); }
  };

  const toggleUser = async (user) => {
    await updateUser(hotelId, user.id, { active: !user.active });
    const u = await fetchUsers(hotelId);
    setUsers(u);
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoverMsg('');
    try {
      const res = await discoverRooms(hotelId);
      setDiscoverMsg(`Discovered ${res.discovered} rooms from ThingsBoard (${res.total} devices found).`);
      const h = await fetchHotelDetail(hotelId);
      setHotel(h);
    } catch (e) {
      setDiscoverMsg(`Error: ${e.message}`);
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveTB = async (e) => {
    e.preventDefault();
    await updateHotel(hotelId, tbForm);
    setEditTB(false);
    const h = await fetchHotelDetail(hotelId);
    setHotel(h);
  };

  if (loading) return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl flex items-center justify-center z-40">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-800">{hotel.name}</h2>
          <p className="text-xs text-gray-400 font-mono">{hotel.slug}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
      </div>

      <div className="flex border-b border-gray-100 px-6">
        {['overview', 'rooms', 'users'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase font-semibold">Rooms</p>
                <p className="text-3xl font-bold text-gray-800">{hotel.rooms?.length || 0}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase font-semibold">Revenue</p>
                <p className="text-2xl font-bold text-gray-800">{fmt(hotel.totalRevenue)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase font-semibold">Plan</p>
                <p className="text-lg font-bold text-gray-800 capitalize">{hotel.plan}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase font-semibold">Status</p>
                <span className={`inline-block text-sm px-2 py-0.5 rounded-full font-medium mt-1 ${hotel.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {hotel.active ? 'Active' : 'Suspended'}
                </span>
              </div>
            </div>

            {/* ThingsBoard credentials */}
            <div className="bg-blue-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-blue-400 uppercase">ThingsBoard Connection</p>
                <button onClick={() => setEditTB(v => !v)} className="text-xs text-blue-500 hover:text-blue-700 underline">
                  {editTB ? 'Cancel' : 'Edit'}
                </button>
              </div>
              {editTB ? (
                <form onSubmit={handleSaveTB} className="space-y-2 mt-2">
                  <input className="input text-sm font-mono" value={tbForm.tbHost}
                    onChange={e => setTBForm(f => ({ ...f, tbHost: e.target.value }))}
                    placeholder="http://thingsboard.example.com:8080" />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input text-sm" value={tbForm.tbUser}
                      onChange={e => setTBForm(f => ({ ...f, tbUser: e.target.value }))}
                      placeholder="admin@hotel.com" />
                    <input className="input text-sm" type="password" value={tbForm.tbPass}
                      onChange={e => setTBForm(f => ({ ...f, tbPass: e.target.value }))}
                      placeholder="New password (leave blank to keep)" />
                  </div>
                  <button type="submit" className="btn btn-primary text-sm w-full">Save TB Credentials</button>
                </form>
              ) : (
                <div className="space-y-1">
                  <div>
                    <p className="text-[10px] text-blue-300 uppercase tracking-wide">Host</p>
                    <p className="font-mono text-sm text-blue-800 break-all">{hotel.tbHost || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-blue-300 uppercase tracking-wide">Username</p>
                    <p className="font-mono text-sm text-blue-800">{hotel.tbUser || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hotel.tbConfigured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {hotel.tbConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Discover rooms from TB */}
            {hotel.tbConfigured && (
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Auto-Discover Rooms from ThingsBoard</p>
                <p className="text-xs text-gray-400 mb-3">Scan ThingsBoard for gateway-room-* devices and map them to rooms automatically.</p>
                {discoverMsg && (
                  <p className={`text-xs mb-2 ${discoverMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{discoverMsg}</p>
                )}
                <button onClick={handleDiscover} disabled={discovering}
                  className="btn btn-primary text-sm flex items-center gap-2">
                  <Wifi size={14} />
                  {discovering ? 'Discovering...' : 'Discover Rooms from TB'}
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { onClose(); onImportRooms(hotel); }}
                className="btn flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2 text-sm">
                <Upload size={14} /> Import Rooms (CSV)
              </button>
              <button onClick={() => updateHotel(hotel.id, { active: !hotel.active })}
                className={`btn flex-1 flex items-center justify-center gap-2 text-sm ${hotel.active ? 'border border-red-200 text-red-600 hover:bg-red-50' : 'border border-green-200 text-green-600 hover:bg-green-50'}`}>
                {hotel.active ? 'Suspend Hotel' : 'Reactivate Hotel'}
              </button>
            </div>
          </div>
        )}

        {/* Rooms Tab */}
        {tab === 'rooms' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">{hotel.rooms?.length || 0} rooms configured</p>
              <button onClick={() => { onClose(); onImportRooms(hotel); }}
                className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
                <Upload size={12} /> Import Rooms
              </button>
            </div>
            {hotel.rooms?.length ? (
              <div className="space-y-1">
                {hotel.rooms.map(r => (
                  <div key={r.room_number} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                    <span className="font-medium text-gray-800">Room {r.room_number}</span>
                    <span className="text-gray-400">Floor {r.floor}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">{r.room_type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.tb_device_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.tb_device_id ? 'TB linked' : 'No TB device'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                No rooms configured. Import CSV or use Discover from ThingsBoard.
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {tab === 'users' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Staff Accounts</h3>
              <div className="space-y-2">
                {users.map(u => (
                  <div key={u.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{u.username}
                        {u.full_name && <span className="text-gray-400 font-normal ml-1">— {u.full_name}</span>}
                      </p>
                      <p className="text-xs text-gray-400 capitalize">{u.role}</p>
                    </div>
                    <button onClick={() => toggleUser(u)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${u.active ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700'}`}>
                      {u.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Add Staff User</h3>
              <form onSubmit={handleCreateUser} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Username</label>
                    <input className="input text-sm" value={newUser.username}
                      onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                      placeholder="username" required />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Password</label>
                    <input className="input text-sm" type="password" value={newUser.password}
                      onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                      placeholder="min 6 chars" required minLength={6} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Role</label>
                    <select className="input text-sm" value={newUser.role}
                      onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                      <option value="frontdesk">Front Desk</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Full Name</label>
                    <input className="input text-sm" value={newUser.fullName}
                      onChange={e => setNewUser(u => ({ ...u, fullName: e.target.value }))}
                      placeholder="Optional" />
                  </div>
                </div>
                {userMsg && <p className="text-xs text-green-600">{userMsg}</p>}
                <button type="submit" className="btn btn-primary w-full text-sm">Add User</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function PlatformDashboard() {
  const navigate = useNavigate();
  const {
    admin, logout,
    hotels, metrics, hotelsLoading, metricsLoading,
    fetchHotels, fetchMetrics, createHotel, updateHotel,
    fetchHotelDetail, fetchUsers, createUser, updateUser,
    importRooms, discoverRooms
  } = usePlatformStore();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedHotelId, setSelectedHotelId] = useState(null);
  const [importTarget, setImportTarget] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchHotels(); fetchMetrics(); }, []);

  const handleLogout = () => { logout(); navigate('/platform/login'); };

  const filteredHotels = hotels.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    h.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-slate-800 rounded-lg"><Shield size={16} className="text-white" /></div>
            <div>
              <span className="font-bold text-gray-800 text-sm">iHotel Platform</span>
              <span className="text-xs text-gray-400 ml-2">Super Admin</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{admin?.fullName || admin?.username}</span>
            <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 flex items-center gap-1.5 text-sm">
              <LogOut size={15} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <MetricCard icon={Building2} label="Hotels"      value={metrics?.totalHotels ?? '—'}      color="text-brand-600" />
          <MetricCard icon={BedDouble} label="Rooms"       value={metrics?.totalRooms ?? '—'}        color="text-blue-500" />
          <MetricCard icon={Activity}  label="TB Linked"   value={metrics?.configuredRooms ?? '—'}   color="text-green-500" />
          <MetricCard icon={Users}     label="Staff"       value={metrics?.totalUsers ?? '—'}        color="text-purple-500" />
          <MetricCard icon={BedDouble} label="Active Res." value={metrics?.activeReservations ?? '—'} color="text-amber-500" />
          <MetricCard icon={DollarSign} label="Revenue"    value={fmt(metrics?.totalRevenue)}        color="text-emerald-600" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800">Hotels</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-300" />
                <input className="input text-sm py-1.5 pl-8 w-48" placeholder="Search..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button onClick={() => { fetchHotels(); fetchMetrics(); }}
                className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600" title="Refresh">
                <RefreshCw size={15} className={hotelsLoading || metricsLoading ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => setShowCreate(true)}
                className="btn btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5">
                <Plus size={14} /> New Hotel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Hotel</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Plan</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Rooms</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Staff</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase">TB</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredHotels.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      {hotelsLoading ? 'Loading...' : 'No hotels yet. Create one to get started.'}
                    </td>
                  </tr>
                )}
                {filteredHotels.map(hotel => (
                  <tr key={hotel.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-800">{hotel.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{hotel.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize font-medium">{hotel.plan}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{hotel.roomCount}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{hotel.userCount}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hotel.tbConfigured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {hotel.tbConfigured ? 'Connected' : 'No TB'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hotel.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {hotel.active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setImportTarget(hotel)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Import rooms">
                          <Upload size={14} />
                        </button>
                        <button onClick={() => setSelectedHotelId(hotel.id)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="View details">
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {metrics?.revenueByHotel?.length > 0 && (
            <div className="border-t border-gray-100 px-6 py-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Top Revenue</h3>
              <div className="flex flex-wrap gap-3">
                {metrics.revenueByHotel.map(r => (
                  <div key={r.slug} className="text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-700">{r.name}</span>
                    <span className="text-gray-400 ml-2">{fmt(r.revenue)}</span>
                    <span className="text-gray-300 ml-1">· {r.stays} stays</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateHotelModal onClose={() => { setShowCreate(false); fetchHotels(); }} onCreate={createHotel} />
      )}

      {importTarget && (
        <ImportRoomsModal hotel={importTarget} onClose={() => setImportTarget(null)} onImport={importRooms} />
      )}

      {selectedHotelId && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={() => setSelectedHotelId(null)} />
          <HotelDetail
            hotelId={selectedHotelId}
            onClose={() => setSelectedHotelId(null)}
            onImportRooms={(hotel) => { setSelectedHotelId(null); setImportTarget(hotel); }}
          />
        </>
      )}
    </div>
  );
}
