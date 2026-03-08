import { create } from 'zustand';

const useLangStore = create((set) => ({
  lang: localStorage.getItem('ihotel_lang') || 'ar',
  setLang: (lang) => {
    localStorage.setItem('ihotel_lang', lang);
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

// Apply immediately on load
const _lang = localStorage.getItem('ihotel_lang') || 'ar';
document.documentElement.dir  = _lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = _lang;

export default useLangStore;
