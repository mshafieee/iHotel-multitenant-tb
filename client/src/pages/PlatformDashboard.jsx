import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Users, BedDouble, Activity, DollarSign,
  Plus, RefreshCw, Upload, X, ChevronRight, Shield, LogOut,
  Copy, Check, Search, Wifi, KeyRound, UserCog, ToggleLeft, ToggleRight
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

// ── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ title, requireCurrent, onSave, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) return setError('Password must be at least 6 characters');
    if (next !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      await onSave(current, next);
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Check size={18} className="text-green-600" />
            </div>
            <p className="text-sm font-semibold text-gray-700">Password changed successfully</p>
            <button onClick={onClose} className="btn btn-primary w-full mt-4">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {requireCurrent && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Current Password</label>
                <input type="password" className="input" value={current} onChange={e => setCurrent(e.target.value)} required />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">New Password</label>
              <input type="password" className="input" placeholder="Min 6 characters" value={next} onChange={e => setNext(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Confirm New Password</label>
              <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={loading} className="btn btn-primary flex-1">
                {loading ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </form>
        )}
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
  const [changePwdUser, setChangePwdUser] = useState(null); // { id, username }

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
            {changePwdUser && (
              <ChangePasswordModal
                title={`Reset password — ${changePwdUser.username}`}
                requireCurrent={false}
                onSave={async (_, newPwd) => updateUser(hotelId, changePwdUser.id, { password: newPwd })}
                onClose={() => setChangePwdUser(null)}
              />
            )}
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
                    <div className="flex items-center gap-2">
                      <button onClick={() => setChangePwdUser({ id: u.id, username: u.username })}
                        className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700" title="Change password">
                        <KeyRound size={13} />
                      </button>
                      <button onClick={() => toggleUser(u)}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${u.active ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700'}`}>
                        {u.active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
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

// ── Group Users Panel (superadmin tab) ───────────────────────────────────────
function GroupUsersPanel({ allHotels }) {
  const { fetchGroupUsers, createGroupUser, updateGroupUser, setGroupUserHotels } = usePlatformStore();
  const [groupUsers, setGroupUsers]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showCreate, setShowCreate]     = useState(false);
  const [editingId, setEditingId]       = useState(null); // group user being edited
  const [form, setForm]                 = useState({ username: '', password: '', fullName: '' });
  const [msg, setMsg]                   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchGroupUsers();
    setGroupUsers(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await createGroupUser(form);
      setForm({ username: '', password: '', fullName: '' });
      setShowCreate(false);
      setMsg('Group user created.');
      load();
    } catch (e) { setMsg(e.message); }
  };

  const toggleActive = async (gu) => {
    await updateGroupUser(gu.id, { active: !gu.active });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{groupUsers.length} group user(s)</p>
        <button onClick={() => setShowCreate(v => !v)}
          className="btn btn-primary text-sm px-3 py-1.5 flex items-center gap-1.5">
          <Plus size={14} /> New Group User
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase">Create Group User</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Username</label>
              <input className="input text-sm" value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="groupmanager" required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <input className="input text-sm" type="password" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="min 6 chars" required minLength={6} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Full Name</label>
              <input className="input text-sm" value={form.fullName}
                onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                placeholder="Optional" />
            </div>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)}
              className="btn border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
            <button type="submit" className="btn btn-primary text-sm">Create</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
      ) : groupUsers.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No group users yet.</div>
      ) : (
        <div className="space-y-2">
          {groupUsers.map(gu => (
            <div key={gu.id} className={`rounded-xl border p-4 ${gu.active ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-gray-800 text-sm">{gu.username}</p>
                    {gu.fullName && <span className="text-gray-400 text-sm">— {gu.fullName}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${gu.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                      {gu.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">
                    {gu.hotels.length === 0 ? 'No hotels assigned' : `${gu.hotels.length} hotel(s): ${gu.hotels.map(h => h.name).join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setEditingId(editingId === gu.id ? null : gu.id)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-brand-600" title="Manage hotels">
                    <UserCog size={15} />
                  </button>
                  <button onClick={() => toggleActive(gu)}
                    className={`p-1.5 rounded ${gu.active ? 'text-green-500 hover:text-red-500' : 'text-gray-400 hover:text-green-500'}`}
                    title={gu.active ? 'Deactivate' : 'Activate'}>
                    {gu.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                </div>
              </div>

              {editingId === gu.id && (
                <GroupUserHotelAssigner
                  gu={gu}
                  allHotels={allHotels}
                  onSave={async (hotelIds) => {
                    await setGroupUserHotels(gu.id, hotelIds);
                    load();
                    setEditingId(null);
                  }}
                  onClose={() => setEditingId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Hotel assignment picker for a group user
function GroupUserHotelAssigner({ gu, allHotels, onSave, onClose }) {
  const [selected, setSelected] = useState(new Set(gu.hotels.map(h => h.id)));
  const [saving, setSaving]     = useState(false);

  const toggle = (id) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave([...selected]);
    setSaving(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Assign Hotels</p>
      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto mb-3">
        {allHotels.map(h => (
          <label key={h.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors text-sm
            ${selected.has(h.id) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-100 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
            <input type="checkbox" className="sr-only" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              ${selected.has(h.id) ? 'bg-brand-500 border-brand-500' : 'border-gray-300'}`}>
              {selected.has(h.id) && <Check size={9} className="text-white" />}
            </div>
            <span className="truncate">{h.name}</span>
            <span className="text-xs text-gray-400 font-mono ml-auto shrink-0">{h.slug}</span>
          </label>
        ))}
        {allHotels.length === 0 && <p className="text-xs text-gray-400 col-span-2">No hotels available.</p>}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="btn border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary text-sm">
          {saving ? 'Saving…' : 'Save Assignment'}
        </button>
      </div>
    </div>
  );
}

// ── Group User Dashboard (shown when logged in as group_user) ────────────────
function GroupUserDashboard() {
  const navigate = useNavigate();
  const {
    admin, logout,
    groupHotels, groupHotelsLoading,
    fetchGroupHotels,
    fetchGroupHotelFinance, fetchGroupHotelUsers,
    createGroupHotelUser, updateGroupHotelUser,
    changeAdminPassword
  } = usePlatformStore();

  const [selectedHotel, setSelectedHotel] = useState(null);
  const [hotelTab, setHotelTab]           = useState('finance');
  const [finance, setFinance]             = useState(null);
  const [users, setUsers]                 = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [showAdminPwd, setShowAdminPwd]   = useState(false);
  const [newUser, setNewUser]             = useState({ username: '', password: '', role: 'frontdesk', fullName: '' });
  const [userMsg, setUserMsg]             = useState('');

  useEffect(() => { fetchGroupHotels(); }, []);

  const openHotel = useCallback(async (hotel) => {
    setSelectedHotel(hotel);
    setHotelTab('finance');
    setDrawerLoading(true);
    const [fin, usr] = await Promise.all([
      fetchGroupHotelFinance(hotel.id),
      fetchGroupHotelUsers(hotel.id)
    ]);
    setFinance(fin);
    setUsers(usr);
    setDrawerLoading(false);
  }, []);

  const switchTab = async (tab) => {
    setHotelTab(tab);
    if (!selectedHotel) return;
    setDrawerLoading(true);
    if (tab === 'finance') {
      const fin = await fetchGroupHotelFinance(selectedHotel.id);
      setFinance(fin);
    } else {
      const usr = await fetchGroupHotelUsers(selectedHotel.id);
      setUsers(usr);
    }
    setDrawerLoading(false);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setUserMsg('');
    try {
      await createGroupHotelUser(selectedHotel.id, newUser);
      setUserMsg('User created.');
      setNewUser({ username: '', password: '', role: 'frontdesk', fullName: '' });
      const usr = await fetchGroupHotelUsers(selectedHotel.id);
      setUsers(usr);
    } catch (e) { setUserMsg(e.message); }
  };

  const toggleUser = async (u) => {
    await updateGroupHotelUser(selectedHotel.id, u.id, { active: !u.active });
    const usr = await fetchGroupHotelUsers(selectedHotel.id);
    setUsers(usr);
  };

  const handleLogout = () => { logout(); navigate('/platform/login'); };

  const totalRevenue = groupHotels.reduce((s, h) => s + (h.totalRevenue || 0), 0);
  const totalRes     = groupHotels.reduce((s, h) => s + (h.activeReservations || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-indigo-700 rounded-lg"><UserCog size={16} className="text-white" /></div>
            <div>
              <span className="font-bold text-gray-800 text-sm">iHotel Platform</span>
              <span className="text-xs text-indigo-600 ml-2 font-medium">Group Manager</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{admin?.fullName || admin?.username}</span>
            <button onClick={() => setShowAdminPwd(true)} className="text-gray-400 hover:text-gray-700 flex items-center gap-1 text-sm" title="Change my password">
              <KeyRound size={15} />
            </button>
            <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 flex items-center gap-1.5 text-sm">
              <LogOut size={15} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Summary KPIs */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <MetricCard icon={Building2}  label="My Hotels"    value={groupHotels.length}  color="text-indigo-600" />
          <MetricCard icon={BedDouble}  label="Active Res."  value={totalRes}             color="text-amber-500" />
          <MetricCard icon={DollarSign} label="Total Revenue" value={fmt(totalRevenue)}   color="text-emerald-600" />
        </div>

        {/* Hotels table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800">My Hotels</h2>
            <button onClick={fetchGroupHotels}
              className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600">
              <RefreshCw size={15} className={groupHotelsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase">Hotel</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Rooms</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Staff</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Active Res.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Revenue</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {groupHotelsLoading && (
                  <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading…</td></tr>
                )}
                {!groupHotelsLoading && groupHotels.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-10 text-gray-400">No hotels assigned to your account yet.</td></tr>
                )}
                {groupHotels.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-800">{h.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{h.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.roomCount}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.userCount}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.activeReservations}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">{fmt(h.totalRevenue)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => openHotel(h)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Hotel detail drawer */}
      {selectedHotel && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={() => setSelectedHotel(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-40 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-800">{selectedHotel.name}</h2>
                <p className="text-xs text-gray-400 font-mono">{selectedHotel.slug}</p>
              </div>
              <button onClick={() => setSelectedHotel(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="flex border-b border-gray-100 px-6">
              {['finance', 'users'].map(t => (
                <button key={t} onClick={() => switchTab(t)}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors capitalize
                    ${hotelTab === t ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {t === 'finance' ? 'Finance' : 'Users'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {drawerLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : hotelTab === 'finance' && finance ? (
                <div className="space-y-5">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 rounded-xl p-4">
                      <p className="text-xs text-emerald-400 uppercase font-semibold">Total Revenue</p>
                      <p className="text-2xl font-bold text-emerald-700">{fmt(finance.summary?.totalRevenue)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Total Stays</p>
                      <p className="text-2xl font-bold text-gray-800">{finance.summary?.totalStays ?? 0}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Cash</p>
                      <p className="text-xl font-bold text-gray-800">{fmt(finance.summary?.cashRevenue)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Card / Visa</p>
                      <p className="text-xl font-bold text-gray-800">{fmt(finance.summary?.visaRevenue)}</p>
                    </div>
                  </div>
                  {/* Income log */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Income Log</p>
                    {finance.income.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No income records yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {finance.income.map(r => (
                          <div key={r.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 truncate">{r.guest_name} — Rm {r.room}</p>
                              <p className="text-xs text-gray-400">{r.check_in} → {r.check_out} · {r.nights}n · {r.room_type}</p>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <p className="font-semibold text-gray-800">{fmt(r.total_amount)}</p>
                              <p className="text-xs text-gray-400 capitalize">{r.payment_method}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : hotelTab === 'users' ? (
                <div className="space-y-6">
                  {/* Existing users */}
                  <div>
                    <p className="text-sm font-semibold text-gray-600 mb-3">Staff Accounts</p>
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
                            className={`text-xs px-2.5 py-1 rounded-full font-medium
                              ${u.active ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700' : 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700'}`}>
                            {u.active ? 'Active' : 'Inactive'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Add user */}
                  <div className="border-t border-gray-100 pt-5">
                    <p className="text-sm font-semibold text-gray-600 mb-3">Add Staff User</p>
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
              ) : null}
            </div>
          </div>
        </>
      )}

      {showAdminPwd && (
        <ChangePasswordModal
          title="Change My Password"
          requireCurrent={true}
          onSave={changeAdminPassword}
          onClose={() => setShowAdminPwd(false)}
        />
      )}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function PlatformDashboard() {
  const { admin } = usePlatformStore();

  // Route to the right dashboard based on role
  if (admin?.role === 'group_user') return <GroupUserDashboard />;
  return <SuperAdminDashboard />;
}

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const {
    admin, logout,
    hotels, metrics, hotelsLoading, metricsLoading,
    fetchHotels, fetchMetrics, createHotel, updateHotel,
    fetchHotelDetail, fetchUsers, createUser, updateUser,
    importRooms, discoverRooms, changeAdminPassword
  } = usePlatformStore();

  const [tab, setTab] = useState('hotels'); // 'hotels' | 'group-users'
  const [showCreate, setShowCreate] = useState(false);
  const [selectedHotelId, setSelectedHotelId] = useState(null);
  const [importTarget, setImportTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [showAdminPwd, setShowAdminPwd] = useState(false);

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
            <button onClick={() => setShowAdminPwd(true)} className="text-gray-400 hover:text-gray-700 flex items-center gap-1 text-sm" title="Change my password">
              <KeyRound size={15} />
            </button>
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

        {/* Tab navigation */}
        <div className="flex gap-1 mb-4">
          {[['hotels', Building2, 'Hotels'], ['group-users', UserCog, 'Group Users']].map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${tab === key ? 'bg-white shadow-sm border border-gray-200 text-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-white/60'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'group-users' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <GroupUsersPanel allHotels={hotels} />
          </div>
        )}

        {tab === 'hotels' && <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
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
        </div>}
      </main>

      {showAdminPwd && (
        <ChangePasswordModal
          title="Change My Password"
          requireCurrent={true}
          onSave={changeAdminPassword}
          onClose={() => setShowAdminPwd(false)}
        />
      )}

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
