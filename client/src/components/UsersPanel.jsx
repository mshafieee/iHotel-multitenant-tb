import React, { useEffect, useState, useCallback } from 'react';
import { QrCode, X, RefreshCw, Copy, Check } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { api } from '../utils/api';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', frontdesk: 'Front Desk', housekeeper: 'Housekeeper' };
const ROLE_COLORS = { owner: 'bg-purple-50 text-purple-600', admin: 'bg-blue-50 text-blue-600', frontdesk: 'bg-emerald-50 text-emerald-600', housekeeper: 'bg-amber-50 text-amber-600' };

function QrModal({ user: u, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchQr = useCallback(async () => {
    setLoading(true);
    try { setQrData(await api(`/api/users/${u.id}/qr-token`)); }
    catch {}
    setLoading(false);
  }, [u.id]);

  useEffect(() => { fetchQr(); }, [fetchQr]);

  const revokeQr = async () => {
    setRevoking(true);
    try { setQrData(await api(`/api/users/${u.id}/qr-token`, { method: 'DELETE' })); }
    catch {}
    setRevoking(false);
  };

  const copyUrl = () => {
    if (!qrData?.loginUrl) return;
    navigator.clipboard.writeText(qrData.loginUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const qrImageUrl = qrData?.loginUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData.loginUrl)}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800">QR Login — {u.full_name || u.username}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : qrData ? (
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-3">Scan to log in as <span className="font-semibold text-gray-700">@{qrData.username}</span></p>
            {qrImageUrl && (
              <img src={qrImageUrl} alt="QR Code" className="w-48 h-48 mx-auto rounded-xl border border-gray-100 mb-4" />
            )}
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 mb-4">
              <span className="text-[10px] text-gray-500 flex-1 truncate text-left">{qrData.loginUrl}</span>
              <button onClick={copyUrl} className="text-brand-500 hover:text-brand-700 flex-shrink-0">
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={revokeQr} disabled={revoking}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 mx-auto border border-red-100 hover:bg-red-50 rounded-lg px-3 py-1.5 transition">
              <RefreshCw className={`w-3.5 h-3.5 ${revoking ? 'animate-spin' : ''}`} />
              Revoke &amp; regenerate
            </button>
          </div>
        ) : (
          <p className="text-sm text-red-400 text-center py-4">Failed to load QR code.</p>
        )}
      </div>
    </div>
  );
}

export default function UsersPanel() {
  const { user: me } = useAuthStore();
  const isOwner = me?.role === 'owner';

  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'housekeeper', fullName: '' });
  const [editPwd, setEditPwd] = useState(null); // { userId, username }
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [qrUser, setQrUser] = useState(null); // user object for QR modal
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchUsers = useCallback(async () => {
    try { setUsers(await api('/api/users')); } catch {}
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(''); setSuccess(''); }, 3000);
  };

  const createUser = async () => {
    setError('');
    if (!createForm.username || !createForm.password) return flash('Username and password required', true);
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(createForm) });
      flash('User created');
      setShowCreate(false);
      setCreateForm({ username: '', password: '', role: 'housekeeper', fullName: '' });
      fetchUsers();
    } catch (e) { flash(e.message, true); }
  };

  const toggleActive = async (u) => {
    if (u.id === me.id) return flash('Cannot deactivate your own account', true);
    try {
      await api(`/api/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) });
      fetchUsers();
    } catch (e) { flash(e.message, true); }
  };

  const savePassword = async () => {
    setError('');
    if (!pwdForm.newPassword) return flash('New password is required', true);
    if (pwdForm.newPassword !== pwdForm.confirmPassword) return flash('Passwords do not match', true);
    if (pwdForm.newPassword.length < 6) return flash('Password must be at least 6 characters', true);
    try {
      await api(`/api/users/${editPwd.userId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword })
      });
      flash('Password changed');
      setEditPwd(null);
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) { flash(e.message, true); }
  };

  return (
    <div className="space-y-4">
      {/* QR modal */}
      {qrUser && <QrModal user={qrUser} onClose={() => setQrUser(null)} />}

      {/* Change password modal */}
      {editPwd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-4">Change Password — {editPwd.username}</h3>
            {me.role !== 'owner' && (
              <div className="mb-3">
                <label className="text-[9px] text-gray-400 uppercase">Current Password</label>
                <input type="password" className="input" placeholder="Current password" value={pwdForm.currentPassword}
                  onChange={e => setPwdForm({ ...pwdForm, currentPassword: e.target.value })} />
              </div>
            )}
            <div className="mb-3">
              <label className="text-[9px] text-gray-400 uppercase">New Password</label>
              <input type="password" className="input" placeholder="Min 6 characters" value={pwdForm.newPassword}
                onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })} />
            </div>
            <div className="mb-4">
              <label className="text-[9px] text-gray-400 uppercase">Confirm New Password</label>
              <input type="password" className="input" placeholder="Repeat password" value={pwdForm.confirmPassword}
                onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })} />
            </div>
            {error && <div className="text-xs text-red-500 mb-3">{error}</div>}
            {success && <div className="text-xs text-emerald-500 mb-3">{success}</div>}
            <div className="flex gap-2">
              <button onClick={savePassword} className="btn btn-primary flex-1">Save</button>
              <button onClick={() => { setEditPwd(null); setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setError(''); }}
                className="btn btn-ghost flex-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header + create button */}
      <div className="card p-4">
        <div className="flex justify-between items-center mb-4">
          <div className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold">User Accounts</div>
          {isOwner && (
            <button onClick={() => setShowCreate(!showCreate)} className="btn btn-primary text-xs">
              {showCreate ? 'Cancel' : '+ New User'}
            </button>
          )}
        </div>

        {success && <div className="text-xs text-emerald-600 bg-emerald-50 rounded-lg p-2 mb-3">{success}</div>}
        {error && <div className="text-xs text-red-500 bg-red-50 rounded-lg p-2 mb-3">{error}</div>}

        {/* Create form */}
        {showCreate && (
          <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
            <div className="text-sm font-semibold mb-3">New User</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-gray-400 uppercase">Username</label>
                <input className="input" placeholder="e.g. desk01" value={createForm.username}
                  onChange={e => setCreateForm({ ...createForm, username: e.target.value })} />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 uppercase">Full Name</label>
                <input className="input" placeholder="Ahmed Al-Rashid" value={createForm.fullName}
                  onChange={e => setCreateForm({ ...createForm, fullName: e.target.value })} />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 uppercase">Password</label>
                <input type="password" className="input" placeholder="Min 6 chars" value={createForm.password}
                  onChange={e => setCreateForm({ ...createForm, password: e.target.value })} />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 uppercase">Role</label>
                <select className="input" value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
                  <option value="housekeeper">Housekeeper</option>
                  <option value="frontdesk">Front Desk</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <button onClick={createUser} className="btn btn-primary mt-3">Create User</button>
          </div>
        )}

        {/* User list */}
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className={`p-3 rounded-xl border ${u.active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-500 font-bold text-sm">
                    {(u.full_name || u.username)[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{u.full_name || u.username}</div>
                    <div className="text-[9px] text-gray-400">@{u.username} · {u.last_login ? `Last: ${new Date(u.last_login).toLocaleDateString()}` : 'Never logged in'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-[9px] ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-400'}`}>{ROLE_LABELS[u.role] || u.role}</span>
                  {/* QR login code — owner only, active users */}
                  {isOwner && u.active && (
                    <button onClick={() => setQrUser(u)}
                      className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold px-1.5 py-0.5 rounded border border-brand-100 hover:bg-brand-50 transition flex items-center gap-0.5">
                      <QrCode className="w-3 h-3" /> QR
                    </button>
                  )}
                  {/* Change password: owner can change anyone's, others can change their own */}
                  {(isOwner || u.id === me.id) && (
                    <button onClick={() => { setEditPwd({ userId: u.id, username: u.username }); setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }}
                      className="text-[10px] text-blue-500 hover:text-blue-700 font-semibold px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-50 transition">
                      🔑 Pwd
                    </button>
                  )}
                  {/* Deactivate/reactivate — owner only, not self */}
                  {isOwner && u.id !== me.id && (
                    <button onClick={() => toggleActive(u)}
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition ${u.active ? 'text-red-400 border-red-100 hover:bg-red-50' : 'text-emerald-500 border-emerald-100 hover:bg-emerald-50'}`}>
                      {u.active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!users.length && <div className="text-center py-8 text-gray-300 text-sm">No users found</div>}
        </div>
      </div>
    </div>
  );
}
