import React, { useEffect } from 'react';
import useLangStore from '../store/langStore';
import { t } from '../i18n';

export default function AlertToast({ alert, onDismiss }) {
  const lang = useLangStore(s => s.lang);
  const T = (key) => t(key, lang);
  const isSOS = alert.type === 'SOS';

  useEffect(() => {
    const t = setTimeout(onDismiss, isSOS ? 30000 : 15000);
    return () => clearTimeout(t);
  }, []);

  // Sound
  useEffect(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = isSOS ? 880 : 660;
      g.gain.value = isSOS ? 0.3 : 0.15;
      o.start(); o.stop(ctx.currentTime + 0.2);
    } catch {}
  }, []);

  return (
    <div className={`p-3 rounded-xl shadow-lg border cursor-pointer transition-all hover:scale-[1.02] ${
      isSOS ? 'bg-red-50 border-red-200 animate-sos' : 'bg-amber-50 border-amber-200'}`}
      onClick={onDismiss}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{isSOS ? '🚨' : '🧹'}</span>
        <div className="flex-1">
          <div className={`text-xs font-bold ${isSOS ? 'text-red-600' : 'text-amber-600'}`}>
            {isSOS ? T('alert_sos') : T('alert_mur')}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">{alert.message}</div>
        </div>
        <button className="text-gray-400 hover:text-gray-600 text-xs" onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
      </div>
    </div>
  );
}
