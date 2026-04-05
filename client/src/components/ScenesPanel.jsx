import React, { useEffect, useState } from 'react';
import { Zap, Plus, Play, Edit2, Trash2, Clock, Radio, X, Upload, Globe, Download } from 'lucide-react';
import useHotelStore from '../store/hotelStore';
import { api } from '../utils/api';

// ── Constants ────────────────────────────────────────────────────────────────
const DAYS       = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const EVENT_KEYS = [
  { value: 'roomStatus',      label: 'Room Status',      valueType: 'roomStatus' },
  { value: 'pirMotionStatus', label: 'Motion Sensor',    valueType: 'binary', options: [[0,'No Motion'],[1,'Motion Detected']] },
  { value: 'doorStatus',      label: 'Door Status',      valueType: 'binary', options: [[0,'Closed'],[1,'Open']] },
  { value: 'checkIn',         label: 'Guest Check-In',   valueType: 'trigger' },
  { value: 'checkOut',        label: 'Guest Check-Out',  valueType: 'trigger' },
];

const OPERATORS = [
  { value: 'eq',     label: '= equals' },
  { value: 'neq',    label: '≠ not equals' },
  { value: 'change', label: 'changes (any value)' },
];

const ACTION_TYPES = [
  { value: 'setLines',          label: 'Lights' },
  { value: 'setAC',             label: 'AC / Climate' },
  { value: 'setCurtainsBlinds', label: 'Curtains & Blinds' },
  { value: 'setDoorUnlock',     label: 'Unlock Door' },
  { value: 'setDoorLock',       label: 'Lock Door' },
  { value: 'setService',        label: 'Service Flag' },
  { value: 'setRoomStatus',     label: 'Room Status' },
];

const ROOM_STATUS_LABELS = ['Vacant', 'Occupied', 'Service', 'Maintenance', 'Not Occupied'];
const AC_MODE_LABELS     = ['Off', 'Cool', 'Heat', 'Fan', 'Dry'];
const FAN_SPEED_LABELS   = ['Auto', 'Low', 'Medium', 'High'];

function defaultParams(type) {
  switch (type) {
    case 'setLines':          return { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 };
    case 'setAC':             return { acMode: 1, acTemperatureSet: 22, fanSpeed: 0 };
    case 'setCurtainsBlinds': return { curtainsPosition: 0, blindsPosition: 0 };
    case 'setService':        return { dndService: false, murService: false, sosService: false };
    case 'setRoomStatus':     return { roomStatus: 0 };
    default:                  return {};
  }
}

function parseCfg(val) {
  if (!val) return {};
  return typeof val === 'string' ? JSON.parse(val) : val;
}

function parseArr(val) {
  if (!val) return [];
  return typeof val === 'string' ? JSON.parse(val) : val;
}

function triggerSummary(scene) {
  const cfg = parseCfg(scene.trigger_config);
  if (scene.trigger_type === 'time') {
    const d = cfg.days || [];
    const dayStr =
      d.length === 7 ? 'Every day' :
      d.length === 5 && !d.includes('sat') && !d.includes('sun') ? 'Weekdays' :
      d.length === 2 && d.includes('sat') && d.includes('sun') ? 'Weekends' :
      d.map(x => x[0].toUpperCase() + x.slice(1)).join(', ') || 'Every day';
    return `${dayStr} at ${cfg.time || '00:00'}`;
  }
  const ek = EVENT_KEYS.find(e => e.value === cfg.event)?.label || cfg.event;
  let summary;
  if (cfg.operator === 'change') summary = `When ${ek} changes`;
  else summary = `When ${ek} ${cfg.operator === 'neq' ? '≠' : '='} ${cfg.value}`;
  if (cfg.fromValues?.length > 0) summary += ` (from ${cfg.fromValues.join('/')})`;
  return summary;
}

// ── Action params editor ─────────────────────────────────────────────────────
function ActionParams({ type, params, onChange }) {
  if (type === 'setLines') return (
    <div className="space-y-2">
      <div className="flex gap-4">
        {['line1','line2','line3'].map((k,i) => (
          <label key={k} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={!!params[k]}
              onChange={e => onChange({ ...params, [k]: e.target.checked })}
              className="w-3.5 h-3.5 accent-brand-500" />
            Line {i + 1}
          </label>
        ))}
      </div>
      {['dimmer1','dimmer2'].map((k,i) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-16">Dimmer {i+1}</span>
          <input type="range" min={0} max={100} step={5} value={params[k] ?? 0}
            onChange={e => onChange({ ...params, [k]: Number(e.target.value) })}
            className="flex-1 h-1 accent-brand-500" />
          <span className="text-[11px] text-gray-500 w-8 text-right">{params[k] ?? 0}%</span>
        </div>
      ))}
    </div>
  );

  if (type === 'setAC') return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[11px] text-gray-500 block mb-1">Mode</label>
          <select value={params.acMode ?? 1}
            onChange={e => onChange({ ...params, acMode: Number(e.target.value) })}
            className="input text-xs py-1">
            {AC_MODE_LABELS.map((l,i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-gray-500 block mb-1">Fan Speed</label>
          <select value={params.fanSpeed ?? 0}
            onChange={e => onChange({ ...params, fanSpeed: Number(e.target.value) })}
            className="input text-xs py-1">
            {FAN_SPEED_LABELS.map((l,i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500 w-20">Temperature</span>
        <input type="range" min={16} max={32} step={0.5}
          value={params.acTemperatureSet ?? 22}
          onChange={e => onChange({ ...params, acTemperatureSet: Number(e.target.value) })}
          className="flex-1 h-1 accent-brand-500" />
        <span className="text-[11px] text-gray-500 w-12 text-right">{params.acTemperatureSet ?? 22}°C</span>
      </div>
    </div>
  );

  if (type === 'setCurtainsBlinds') return (
    <div className="space-y-2">
      {[['curtainsPosition','Curtains'], ['blindsPosition','Blinds']].map(([k,label]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-16">{label}</span>
          <input type="range" min={0} max={100} step={5} value={params[k] ?? 0}
            onChange={e => onChange({ ...params, [k]: Number(e.target.value) })}
            className="flex-1 h-1 accent-brand-500" />
          <span className="text-[11px] text-gray-500 w-8 text-right">{params[k] ?? 0}%</span>
        </div>
      ))}
    </div>
  );

  if (type === 'setService') return (
    <div className="flex gap-4">
      {[['dndService','DND'],['murService','MUR'],['sosService','SOS']].map(([k,label]) => (
        <label key={k} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={!!params[k]}
            onChange={e => onChange({ ...params, [k]: e.target.checked })}
            className="w-3.5 h-3.5 accent-brand-500" />
          {label}
        </label>
      ))}
    </div>
  );

  if (type === 'setRoomStatus') return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-1">Status</label>
      <select value={params.roomStatus ?? 0}
        onChange={e => onChange({ ...params, roomStatus: Number(e.target.value) })}
        className="input text-xs py-1">
        {ROOM_STATUS_LABELS.map((l,i) => <option key={i} value={i}>{i} — {l}</option>)}
      </select>
    </div>
  );

  return <p className="text-xs text-gray-400 italic">No parameters needed.</p>;
}

// ── Scene Builder Modal ──────────────────────────────────────────────────────
function SceneBuilderModal({ scene, rooms, onSave, onClose }) {
  const isEdit = !!scene?.id;
  const [name, setName]               = useState(scene?.name || '');
  const [roomNum, setRoomNum]         = useState(scene?.room_number || Object.keys(rooms).sort()[0] || '');
  const [applyToAll, setApplyToAll]   = useState(!!scene?.is_shared);
  const [triggerType, setTriggerType] = useState(scene?.trigger_type || 'time');
  const [timeCfg, setTimeCfg]         = useState(() => {
    const c = parseCfg(scene?.trigger_config);
    return { time: c.time || '08:00', days: c.days || [...DAYS] };
  });
  const [eventCfg, setEventCfg] = useState(() => {
    const c = parseCfg(scene?.trigger_config);
    return { event: c.event || 'roomStatus', operator: c.operator || 'eq', value: c.value ?? 0, fromValues: c.fromValues || [] };
  });
  const [actions, setActions] = useState(() => {
    const raw = parseArr(scene?.actions);
    return raw.length ? raw : [{ type: 'setLines', params: defaultParams('setLines'), delay: 0 }];
  });
  const [enabled, setEnabled] = useState(scene?.enabled !== undefined ? !!scene.enabled : true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const addAction = () =>
    setActions(a => [...a, { type: 'setLines', params: defaultParams('setLines'), delay: 0 }]);

  const removeAction = (idx) =>
    setActions(a => a.filter((_, i) => i !== idx));

  const updateAction = (idx, patch) =>
    setActions(a => a.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, ...patch };
      if (patch.type) next.params = defaultParams(patch.type);
      return next;
    }));

  const handleSave = async () => {
    if (!name.trim()) { setError('Scene name is required.'); return; }
    if (!applyToAll) {
      if (!roomNum.trim())     { setError('Please enter a room number.'); return; }
      if (!(roomNum in rooms)) { setError(`Room "${roomNum}" is not defined. Check the room number.`); return; }
    }
    if (actions.length === 0) { setError('Add at least one action.'); return; }

    const triggerConfig = triggerType === 'time'
      ? { time: timeCfg.time, days: timeCfg.days }
      : {
          event: eventCfg.event, operator: eventCfg.operator, value: eventCfg.value,
          ...(eventCfg.fromValues.length > 0 ? { fromValues: eventCfg.fromValues } : {})
        };

    setSaving(true);
    setError('');
    try {
      if (applyToAll && !isEdit) {
        // Single shared scene — executed at runtime for every room
        await onSave({ name: name.trim(), roomNumber: null, triggerType, triggerConfig, actions, enabled, isShared: true });
      } else {
        await onSave({ name: name.trim(), roomNumber: roomNum, triggerType, triggerConfig, actions, enabled });
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save scene.');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-800 text-base">{isEdit ? 'Edit Scene' : 'New Scene'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Name + Room */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Scene Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Morning Routine" className="input text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Room</label>
              {applyToAll ? (
                <div className="input text-sm text-gray-400 bg-gray-50 cursor-not-allowed flex items-center gap-1.5">
                  <Globe size={12} className="text-brand-400" />
                  Shared — all rooms
                </div>
              ) : (() => {
                const trimmed = roomNum.trim();
                const isValid   = trimmed !== '' && trimmed in rooms;
                const isInvalid = trimmed !== '' && !(trimmed in rooms);
                return (
                  <>
                    <input
                      value={roomNum}
                      onChange={e => setRoomNum(e.target.value)}
                      placeholder="e.g. 101"
                      className={`input text-sm ${isValid ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-200' : isInvalid ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
                    />
                    {isValid   && <p className="text-[10px] text-emerald-600 mt-0.5">Room found</p>}
                    {isInvalid && <p className="text-[10px] text-red-500 mt-0.5">Room not found</p>}
                  </>
                );
              })()}
              {!isEdit && (
                <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={applyToAll}
                    onChange={e => setApplyToAll(e.target.checked)}
                    className="w-3.5 h-3.5 accent-brand-500" />
                  <span className="text-[10px] text-gray-500">Shared scene (all rooms)</span>
                </label>
              )}
            </div>
          </div>

          {/* Trigger */}
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">Trigger</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 mb-3">
              {[['time','Time', Clock], ['event','Event', Radio]].map(([v, l, Icon]) => (
                <button key={v} onClick={() => setTriggerType(v)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition ${
                    triggerType === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}>
                  <Icon size={12} />{l}
                </button>
              ))}
            </div>

            {triggerType === 'time' ? (
              <div className="space-y-3 bg-gray-50 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <label className="text-[11px] text-gray-500 w-10">Time</label>
                  <input type="time" value={timeCfg.time}
                    onChange={e => setTimeCfg(c => ({ ...c, time: e.target.value }))}
                    className="input text-sm w-32" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-1.5">Days</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS.map((d, i) => (
                      <button key={d} onClick={() => setTimeCfg(c => ({
                        ...c,
                        days: c.days.includes(d) ? c.days.filter(x => x !== d) : [...c.days, d]
                      }))}
                        className={`w-9 h-7 rounded-md text-[10px] font-bold transition ${
                          timeCfg.days.includes(d)
                            ? 'bg-brand-500 text-white'
                            : 'bg-white text-gray-400 border border-gray-200 hover:border-brand-500'
                        }`}>
                        {DAY_LABELS[i]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">When</label>
                    <select value={eventCfg.event}
                      onChange={e => setEventCfg(c => ({ ...c, event: e.target.value }))}
                      className="input text-xs py-1">
                      {EVENT_KEYS.map(ek => <option key={ek.value} value={ek.value}>{ek.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-1">Condition</label>
                    <select value={eventCfg.operator}
                      onChange={e => setEventCfg(c => ({ ...c, operator: e.target.value }))}
                      className="input text-xs py-1">
                      {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                  </div>
                </div>
                {eventCfg.operator !== 'change' && (() => {
                  const meta = EVENT_KEYS.find(ek => ek.value === eventCfg.event);
                  if (meta?.valueType === 'trigger') return (
                    <p className="text-[11px] text-gray-400 italic">
                      This event fires once when triggered — use <strong>changes</strong> condition or keep value as 1.
                    </p>
                  );
                  if (meta?.valueType === 'binary') return (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">Value</label>
                      <select value={eventCfg.value}
                        onChange={e => setEventCfg(c => ({ ...c, value: Number(e.target.value) }))}
                        className="input text-xs py-1">
                        {meta.options.map(([v, l]) => <option key={v} value={v}>{v} — {l}</option>)}
                      </select>
                    </div>
                  );
                  if (meta?.valueType === 'roomStatus') return (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">Value</label>
                      <select value={eventCfg.value}
                        onChange={e => setEventCfg(c => ({ ...c, value: Number(e.target.value) }))}
                        className="input text-xs py-1">
                        {ROOM_STATUS_LABELS.map((l,i) => <option key={i} value={i}>{i} — {l}</option>)}
                      </select>
                    </div>
                  );
                  return (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1">Value</label>
                      <input type="number" value={eventCfg.value}
                        onChange={e => setEventCfg(c => ({ ...c, value: Number(e.target.value) }))}
                        className="input text-xs py-1 w-28" />
                    </div>
                  );
                })()}

                {/* From State — optional previous-state filter (hidden for trigger/change) */}
                {eventCfg.operator !== 'change' && (() => {
                  const meta = EVENT_KEYS.find(ek => ek.value === eventCfg.event);
                  if (!meta || meta.valueType === 'trigger') return null;
                  const opts = meta.valueType === 'binary'
                    ? meta.options
                    : ROOM_STATUS_LABELS.map((l, i) => [i, l]);
                  const toggle = (v) => setEventCfg(c => ({
                    ...c,
                    fromValues: c.fromValues.includes(v)
                      ? c.fromValues.filter(x => x !== v)
                      : [...c.fromValues, v]
                  }));
                  return (
                    <div>
                      <label className="text-[11px] text-gray-500 block mb-1.5">
                        Previous State <span className="text-gray-300">(optional — only fire when transitioning FROM)</span>
                      </label>
                      <div className="flex gap-1.5 flex-wrap">
                        {opts.map(([v, l]) => (
                          <button key={v} type="button" onClick={() => toggle(v)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition border ${
                              eventCfg.fromValues.includes(v)
                                ? 'bg-brand-500 text-white border-brand-500'
                                : 'bg-white text-gray-400 border-gray-200 hover:border-brand-500'
                            }`}>
                            {v} — {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Actions</label>
              <button onClick={addAction}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand-500 hover:text-brand-600">
                <Plus size={12} /> Add Action
              </button>
            </div>
            <div className="space-y-2">
              {actions.map((action, idx) => (
                <div key={idx} className="bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-2">
                  <div className="flex items-center gap-2">
                    {idx > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Clock size={11} className="text-gray-400" />
                        <input type="number" min={0} max={3600} value={action.delay || 0}
                          onChange={e => updateAction(idx, { delay: Number(e.target.value) })}
                          className="input text-xs py-0.5 w-16" />
                        <span className="text-[11px] text-gray-400">s</span>
                      </div>
                    )}
                    <select value={action.type}
                      onChange={e => updateAction(idx, { type: e.target.value })}
                      className="input text-xs py-1 flex-1">
                      {ACTION_TYPES.map(at => <option key={at.value} value={at.value}>{at.label}</option>)}
                    </select>
                    <button onClick={() => removeAction(idx)}
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <ActionParams
                    type={action.type}
                    params={action.params || {}}
                    onChange={params => updateAction(idx, { params })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-gray-700">Enable Scene</div>
              <div className="text-[11px] text-gray-400">Disabled scenes won't trigger automatically.</div>
            </div>
            <button onClick={() => setEnabled(v => !v)}
              className={`toggle flex-shrink-0 ${enabled ? 'bg-emerald-400' : 'bg-gray-200'}`}>
              <div className={`toggle-knob ${enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
          {error
            ? <p className="text-xs text-red-500 flex-1">{error}</p>
            : <div className="flex-1" />
          }
          <button onClick={onClose} className="btn btn-ghost text-xs">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Scene'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Scene Row ────────────────────────────────────────────────────────────────
function SceneRow({ scene, selected, onSelect, onToggle, onRun, onPush, onEdit, onDelete, runningId, deletingId, pushingId, pushResult }) {
  const actionsArr = parseArr(scene.actions);
  return (
    <div className={`card px-4 py-3 flex items-center gap-3 transition ${!scene.enabled ? 'opacity-55' : ''}`}>

      {/* Checkbox */}
      <input type="checkbox" checked={selected} onChange={e => onSelect(scene.id, e.target.checked)}
        className="w-3.5 h-3.5 accent-brand-500 flex-shrink-0" />

      {/* Enable toggle */}
      <button onClick={() => onToggle(scene)}
        className={`toggle flex-shrink-0 ${scene.enabled ? 'bg-emerald-400' : 'bg-gray-200'}`}>
        <div className={`toggle-knob ${scene.enabled ? 'translate-x-5' : ''}`} />
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-gray-800 truncate">{scene.name}</span>
          {scene.is_shared
            ? <span className="badge bg-brand-50 text-brand-500 flex items-center gap-0.5"><Globe size={9} /> Shared</span>
            : <span className="badge bg-brand-50 text-brand-500">Rm {scene.room_number}</span>
          }
          <span className={`badge ${
            scene.trigger_type === 'time'
              ? 'bg-blue-50 text-blue-500'
              : 'bg-purple-50 text-purple-500'
          }`}>
            {scene.trigger_type === 'time'
              ? <Clock size={9} className="inline mr-0.5" />
              : <Radio size={9} className="inline mr-0.5" />
            }
            {scene.trigger_type}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {triggerSummary(scene)}
          {' · '}{actionsArr.length} action{actionsArr.length !== 1 ? 's' : ''}
          {scene.last_run && (
            <> · Last run: {new Date(scene.last_run + 'Z').toLocaleString()}</>
          )}
        </p>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {!scene.is_shared && (
          <button onClick={() => onRun(scene.id)} disabled={runningId === scene.id}
            title="Run now"
            className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition disabled:opacity-50">
            <Play size={14} />
          </button>
        )}
        <button onClick={() => onPush(scene.id)} disabled={pushingId === scene.id}
          title={pushResult[scene.id]
            ? (pushResult[scene.id].ok ? `Pushed ${pushResult[scene.id].count} scene(s)` : pushResult[scene.id].msg)
            : 'Push to gateway (offline mode)'}
          className={`p-1.5 rounded-lg transition disabled:opacity-50 ${
            pushResult[scene.id]?.ok === true  ? 'text-brand-500 bg-brand-50' :
            pushResult[scene.id]?.ok === false ? 'text-red-400 bg-red-50' :
            'text-gray-400 hover:bg-gray-100'
          }`}>
          <Upload size={14} />
        </button>
        <button onClick={() => onEdit(scene)} title="Edit"
          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
          <Edit2 size={14} />
        </button>
        <button onClick={() => onDelete(scene.id)} disabled={deletingId === scene.id}
          title="Delete"
          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition disabled:opacity-50">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────
export default function ScenesPanel() {
  const { scenes, fetchScenes, createScene, updateScene, deleteScene, bulkDeleteScenes, runScene, pushScene } = useHotelStore();
  const rooms = useHotelStore(s => s.rooms);
  const [roomFilter, setRoomFilter] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingScene, setEditingScene] = useState(null);
  const [runningId, setRunningId]   = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [pushingId, setPushingId]   = useState(null);
  const [pushResult, setPushResult] = useState({});
  const [selected, setSelected]       = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importing, setImporting]       = useState(false);
  const [importMsg, setImportMsg]       = useState('');

  useEffect(() => { fetchScenes(); }, []);

  // Split scenes into shared and regular
  const sharedScenes  = scenes.filter(s => s.is_shared);
  const regularScenes = scenes.filter(s => !s.is_shared);

  const roomNumbers = [...new Set(regularScenes.map(s => s.room_number))].sort();
  const filtered    = roomFilter ? regularScenes.filter(s => s.room_number === roomFilter) : regularScenes;

  const handleSave = async (data) => {
    if (editingScene?.id) await updateScene(editingScene.id, data);
    else                  await createScene(data);
  };

  const handleToggle = (scene) =>
    updateScene(scene.id, { enabled: scene.enabled ? 0 : 1 });

  const handleRun = async (id) => {
    setRunningId(id);
    try { await runScene(id); } catch {}
    setTimeout(() => setRunningId(null), 1500);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this scene?')) return;
    setDeletingId(id);
    try { await deleteScene(id); } catch {}
    setDeletingId(null);
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const handlePush = async (id) => {
    setPushingId(id);
    setPushResult(r => ({ ...r, [id]: null }));
    try {
      const res = await pushScene(id);
      setPushResult(r => ({ ...r, [id]: { ok: true, count: res.scenes } }));
    } catch (e) {
      setPushResult(r => ({ ...r, [id]: { ok: false, msg: e.message } }));
    }
    setTimeout(() => setPushResult(r => { const n = { ...r }; delete n[id]; return n; }), 4000);
    setPushingId(null);
  };

  const handleSelect = (id, checked) => {
    setSelected(s => { const n = new Set(s); checked ? n.add(id) : n.delete(id); return n; });
  };

  const handleSelectAll = (checked) => {
    setSelected(checked ? new Set(filtered.map(s => s.id)) : new Set());
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} scene(s)?`)) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteScenes([...selected]);
      setSelected(new Set());
      fetchScenes();
    } catch {}
    setBulkDeleting(false);
  };

  const openNew   = () => { setEditingScene(null); setShowBuilder(true); };
  const openEdit  = (s) => { setEditingScene(s);   setShowBuilder(true); };
  const closeBuilder = () => { setShowBuilder(false); setEditingScene(null); fetchScenes(); };

  const handleImportPlatformScenes = async () => {
    setImporting(true);
    setImportMsg('');
    try {
      const result = await api('/api/platform-scenes');
      if (!result.supported) {
        setImportMsg('Your IoT platform does not support scene listing.');
        return;
      }
      if (!result.scenes?.length) {
        setImportMsg('No scenes found on the IoT platform.');
        return;
      }
      // Only import scenes that don't already exist (match by name prefix)
      const existing = new Set(scenes.map(s => s.name));
      const toImport = result.scenes.filter(s => !existing.has(`GT: ${s.name}`));
      if (!toImport.length) {
        setImportMsg('All platform scenes are already imported.');
        return;
      }
      for (const s of toImport) {
        await createScene({
          name:          `GT: ${s.name}`,
          roomNumber:    null,
          triggerType:   'time',
          triggerConfig: { time: '08:00', days: DAYS },
          actions:       [{ type: 'activatePlatformScene', params: { platformSceneId: s.name }, delay: 0 }],
          enabled:       false,
          isShared:      true,
        });
      }
      fetchScenes();
      setImportMsg(`Imported ${toImport.length} scene(s). Edit triggers to activate them.`);
    } catch (e) {
      setImportMsg(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
      setTimeout(() => setImportMsg(''), 6000);
    }
  };

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-brand-500" />
          <h2 className="font-bold text-gray-800 text-base">Scenes & Automation</h2>
          <span className="badge bg-gray-100 text-gray-500">{scenes.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={bulkDeleting}
              className="btn btn-ghost text-xs text-red-500 border-red-200 hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-50">
              <Trash2 size={12} /> Delete selected ({selected.size})
            </button>
          )}
          {roomNumbers.length > 0 && (
            <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
              className="input text-xs py-1.5 w-32">
              <option value="">All Rooms</option>
              {roomNumbers.map(r => <option key={r} value={r}>Room {r}</option>)}
            </select>
          )}
          <button onClick={handleImportPlatformScenes} disabled={importing}
            title="Import preset scenes from the IoT platform (e.g. Greentech GRMS)"
            className="btn btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-50">
            <Download size={13} /> {importing ? 'Importing…' : 'Import'}
          </button>
          <button onClick={openNew} className="btn btn-primary text-xs flex items-center gap-1.5">
            <Plus size={14} /> New Scene
          </button>
        </div>
      </div>
      {importMsg && (
        <p className={`text-xs px-3 py-2 rounded-lg ${importMsg.includes('failed') || importMsg.includes('not') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {importMsg}
        </p>
      )}

      {/* ── Shared Scenes ── */}
      {sharedScenes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-brand-400" />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Shared Scenes</span>
            <span className="badge bg-brand-50 text-brand-400">{sharedScenes.length}</span>
            <span className="text-[9px] text-gray-300 ml-1">Applied to every room at runtime</span>
          </div>
          {sharedScenes.map(scene => (
            <SceneRow key={scene.id} scene={scene}
              selected={selected.has(scene.id)}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onRun={handleRun}
              onPush={handlePush}
              onEdit={openEdit}
              onDelete={handleDelete}
              runningId={runningId}
              deletingId={deletingId}
              pushingId={pushingId}
              pushResult={pushResult}
            />
          ))}
        </div>
      )}

      {/* ── Room Scenes ── */}
      {(sharedScenes.length > 0 && regularScenes.length > 0) && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Room Scenes</span>
          <span className="badge bg-gray-100 text-gray-400">{regularScenes.length}</span>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && sharedScenes.length === 0 ? (
        <div className="card p-12 text-center">
          <Zap size={32} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-semibold text-gray-400">No custom scenes yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Create custom automations based on time schedules or sensor events.<br />
            Check "Shared scene" to apply a scene to every room with a single record.
          </p>
          <button onClick={openNew}
            className="btn btn-primary text-xs mt-4 inline-flex items-center gap-1.5">
            <Plus size={12} /> Create First Scene
          </button>
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {/* Select-all row */}
          <div className="flex items-center gap-2 px-1">
            <input type="checkbox" checked={allSelected}
              onChange={e => handleSelectAll(e.target.checked)}
              className="w-3.5 h-3.5 accent-brand-500" />
            <span className="text-[10px] text-gray-400">Select all ({filtered.length})</span>
          </div>
          {filtered.map(scene => (
            <SceneRow key={scene.id} scene={scene}
              selected={selected.has(scene.id)}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onRun={handleRun}
              onPush={handlePush}
              onEdit={openEdit}
              onDelete={handleDelete}
              runningId={runningId}
              deletingId={deletingId}
              pushingId={pushingId}
              pushResult={pushResult}
            />
          ))}
        </div>
      ) : null}

      {showBuilder && (
        <SceneBuilderModal
          scene={editingScene}
          rooms={rooms}
          onSave={handleSave}
          onClose={closeBuilder}
        />
      )}
    </div>
  );
}
