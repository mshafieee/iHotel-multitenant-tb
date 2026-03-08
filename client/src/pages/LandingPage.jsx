import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Eye, EyeOff, Wifi, Shield,
  Zap, BarChart3, BedDouble, Thermometer,
  Lightbulb, Lock, Moon, Cpu, Star,
  Bell, Leaf, X, ArrowRight, ChevronRight,
} from 'lucide-react';
import useAuthStore from '../store/authStore';

// ── Translations (idiomatic Arabic, not literal) ──────────────────────────────
const T = {
  en: {
    langToggle: 'عربي',
    nav: { features: 'Features', platform: 'Platform', reviews: 'Reviews', signIn: 'Sign In' },
    badge: 'Live platform · Real-time IoT control',
    heroLine1: 'The Future of',
    heroLine2: 'Hotel Management',
    heroLine3: 'is Here',
    heroSub: 'One platform to monitor every room in real-time, automate guest experiences, manage reservations, and reduce energy costs — across all your properties.',
    stats: [{ v: '500+', l: 'Rooms Managed' }, { v: '~40%', l: 'Energy Savings' }, { v: '< 1s', l: 'Live Updates' }, { v: '99.9%', l: 'Uptime' }],
    getStarted: 'Get Started',
    seeFeatures: 'See features',
    trustedBy: 'Trusted by hotels in',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Dubai'],
    featuresTag: 'Platform Features',
    featuresTitle: 'Everything your hotel needs',
    featuresSub: 'Built for hotel operators who demand real-time visibility, energy intelligence, and outstanding guest experience — all from one platform.',
    features: [
      { title: 'Real-time IoT Control',    desc: 'AC, lights, curtains, door locks, CO₂ and humidity — every room updated every second.' },
      { title: 'PMS & Reservations',       desc: 'QR check-in, guest portal, room allocation, checkout automation — all built in.' },
      { title: 'Revenue & Shift Tracking', desc: 'Live income logs, shift reconciliation, room-type pricing, and export to management.' },
      { title: 'Enterprise Security',      desc: 'JWT auth, bcrypt encryption, per-hotel isolation, and rate limiting out of the box.' },
      { title: 'Energy Intelligence',      desc: 'Auto-vacate on departure, motion-triggered AC and lights off — 30–40% energy reduction.' },
      { title: 'Smart Automation Scenes',  desc: 'Welcome routines, departure cleanup, sleep presets, DND — all triggered automatically.' },
      { title: 'Instant Staff Alerts',     desc: 'SOS, housekeeping requests, checkout reminders — instant notification to the right person.' },
      { title: 'IoT Hardware Ready',        desc: 'Works with any smart room controller. Zero vendor lock-in.' },
    ],
    platformTag: 'One Platform',
    platformTitle: 'Every workflow covered',
    platformSub: 'From front desk to housekeeping, energy management to guest experience — iHotel handles it all in one place.',
    dashLabel: 'Live Room Dashboard',
    pmsLabel: 'PMS — Reservations',
    guestLabel: 'Guest Mobile Portal',
    reviewsTag: 'Customer Reviews',
    reviewsTitle: 'Trusted by hotel operators',
    reviewsSub: 'Real results from hotels that have deployed iHotel',
    testimonials: [
      { stars: 5, text: '"iHotel transformed how we operate. We reduced energy costs by 38% in the very first month. The real-time dashboard gives us complete visibility over every room — AC temperature, door status, humidity — all without leaving the front desk. Our housekeeping team now knows the exact checkout moment automatically, with zero phone calls."', name: 'Faris Al-Khalidi', title: 'Operations Director', hotel: '5-star property, Riyadh', stat: '38% energy reduction' },
      { stars: 5, text: '"The guest portal alone justified the entire platform. Guests scan a QR code and instantly control their AC, lights, curtains, and scene presets from their phone — no app download required. Our satisfaction scores jumped measurably after launch. The integration was smooth and the support team was with us every step of the way."', name: 'Noura Al-Mansouri', title: 'General Manager', hotel: 'Business hotel, Jeddah', stat: '4.9★ guest satisfaction' },
      { stars: 5, text: '"Managing 3 properties from one platform used to sound impossible. iHotel makes it effortless. The NOT_OCCUPIED automation alone saves us 4–5 hours of daily manual work. When a room sits empty for 5 minutes, AC and lights shut off automatically. Maintenance logs are real-time and accurate, and revenue reports are always up-to-date."', name: 'Tariq Mohammed', title: 'Hotel Technology Manager', hotel: '3-property group, Mecca', stat: '5 h/day saved' },
      { stars: 5, text: '"The departure scene automation is brilliant. The moment we check a guest out, the room runs through a full cleanup routine — lights, AC, curtains — all reset automatically. Our housekeeping team arrives to a room that is already prepared. We have cut room turnaround time by over 20 minutes per checkout."', name: 'Hind Al-Qahtani', title: 'Executive Housekeeper', hotel: '4-star resort, Al-Ula', stat: '20 min faster turnover' },
      { stars: 5, text: '"Before iHotel we had no visibility into energy waste. Now we can see exactly which rooms are consuming power while vacant and trigger NOT_OCCUPIED mode remotely from the dashboard. Our electricity bill dropped by nearly a third in the first quarter — that saving alone pays for the entire platform many times over."', name: 'Abdullah Al-Shehri', title: 'Chief Engineer', hotel: '250-room hotel, Medina', stat: '32% electricity saved' },
      { stars: 5, text: '"The multi-property dashboard is what sold us. I can switch between our three properties with a click and see every room\'s live status — occupied, vacant, service, not-occupied. If something looks wrong I can send a control command instantly. iHotel has become the central nervous system of our entire hotel group."', name: 'Mona Al-Harbi', title: 'Group Hotel Director', hotel: 'Hotel group, Dammam', stat: '3 properties, 1 platform' },
    ],
    ctaTitle: 'Ready to transform your hotel?',
    ctaSub: 'Join hotel operators running smarter, greener, and more profitable properties with iHotel. Real-time IoT. Guest portal. Revenue tracking. All in one platform.',
    ctaBtn: 'Sign In to Your Hotel',
    sysAdmin: 'System administrator?',
    platformLogin: 'Platform login',
    footer: 'Built for hospitality',
    loginTitle: 'Hotel Staff Login',
    loginSub: 'Sign in to manage your property',
    codeLabel: 'Hotel Code',
    codePh: 'e.g. hilton-grand',
    codeHint: 'Provided by your hotel administrator',
    userLabel: 'Username',
    userPh: 'Enter username',
    passLabel: 'Password',
    passPh: 'Enter password',
    signIn: 'Sign In',
    forgotPw: 'Forgot password?',
    forgotMsg: 'Please contact your hotel administrator to reset your password.',
  },
  ar: {
    langToggle: 'English',
    nav: { features: 'المميزات', platform: 'المنصة', reviews: 'آراء العملاء', signIn: 'دخول' },
    badge: 'منصة فعلية · تحكم لحظي بأجهزة IoT',
    heroLine1: 'مستقبل إدارة الفنادق',
    heroLine2: 'أصبح واقعاً',
    heroLine3: '',
    heroSub: 'منصة واحدة لمراقبة كل غرفة لحظياً، وأتمتة تجربة الضيوف، وإدارة الحجوزات، وتخفيض فاتورة الطاقة — عبر جميع فنادقك.',
    stats: [{ v: '+500', l: 'غرفة مُدارة' }, { v: '٪40~', l: 'توفير في الطاقة' }, { v: '< 1ث', l: 'تحديث فوري' }, { v: '٪99.9', l: 'وقت التشغيل' }],
    getStarted: 'ابدأ الآن',
    seeFeatures: 'اكتشف المميزات',
    trustedBy: 'فنادق من مدن',
    cities: ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'دبي'],
    featuresTag: 'مميزات المنصة',
    featuresTitle: 'كل ما يحتاجه فندقك',
    featuresSub: 'صُممت لمشغّلي الفنادق الذين يريدون الرؤية الفورية، وذكاء الطاقة، وتجربة ضيوف لا تُنسى — كل ذلك من منصة واحدة.',
    features: [
      { title: 'تحكم لحظي بأجهزة IoT',    desc: 'مكيف، إضاءة، ستائر، أقفال الأبواب، CO₂ والرطوبة — كل غرفة محدّثة كل ثانية.' },
      { title: 'الحجوزات وإدارة الفندق',   desc: 'تسجيل دخول بـ QR، بوابة الضيف، توزيع الغرف، وأتمتة المغادرة — كل شيء جاهز.' },
      { title: 'الإيرادات والمناوبات',       desc: 'سجلات إيرادات فورية، مطابقة المناوبات، تسعير أنواع الغرف، والتصدير للإدارة.' },
      { title: 'أمان المستوى المؤسسي',       desc: 'مصادقة JWT، تشفير bcrypt، عزل كل فندق، وحد معدل الطلبات — جاهز من البداية.' },
      { title: 'ذكاء الطاقة',               desc: 'إيقاف تلقائي عند المغادرة، وإطفاء عند انعدام الحركة — وفّر من 30 إلى 40% من الطاقة.' },
      { title: 'سيناريوهات الأتمتة الذكية', desc: 'روتين الاستقبال، تنظيف المغادرة، وضع النوم، عدم الإزعاج — كل شيء يعمل تلقائياً.' },
      { title: 'تنبيهات فورية للموظفين',    desc: 'نداء الطوارئ، طلبات التدبير، تذكيرات المغادرة — إشعار فوري للشخص المناسب.' },
      { title: 'جاهز للأجهزة الذكية',        desc: 'يعمل مع أي وحدة تحكم ذكية للغرف. لا قيود على الموردين.' },
    ],
    platformTag: 'منصة واحدة',
    platformTitle: 'يغطي كل متطلباتك',
    platformSub: 'من مكتب الاستقبال إلى خدمة الغرف، ومن إدارة الطاقة إلى تجربة الضيف — iHotel يدير كل شيء من مكان واحد.',
    dashLabel: 'لوحة الغرف المباشرة',
    pmsLabel: 'نظام إدارة الفندق',
    guestLabel: 'بوابة الضيف على الجوال',
    reviewsTag: 'آراء العملاء',
    reviewsTitle: 'يثق به مشغّلو الفنادق',
    reviewsSub: 'نتائج حقيقية من فنادق تعمل بـ iHotel',
    testimonials: [
      { stars: 5, text: '"غيّرت iHotel طريقة عملنا بالكامل. وفّرنا 38% من تكاليف الطاقة في الشهر الأول وحده. لوحة التحكم المباشرة توفّر رؤية شاملة لكل غرفة — من درجة حرارة المكيف إلى حالة الباب — دون الحاجة لمغادرة مكتب الاستقبال. فريق التدبير لدينا بات يعرف لحظة المغادرة تلقائياً بلا أي مكالمات."', name: 'فارس الخالدي', title: 'مدير العمليات', hotel: 'فندق 5 نجوم، الرياض', stat: '38% توفير في الطاقة' },
      { stars: 5, text: '"بوابة الضيف وحدها كانت تستحق المنصة بأكملها. يمسح الضيف رمز QR ويتحكم فوراً في المكيف والإضاءة والستائر من هاتفه — دون تحميل أي تطبيق. شهدنا تحسناً واضحاً في تقييمات الضيوف منذ الإطلاق. كان التكامل سلساً والدعم الفني حاضراً في كل خطوة."', name: 'نورة المنصوري', title: 'المدير العام', hotel: 'فندق أعمال، جدة', stat: '4.9★ رضا الضيوف' },
      { stars: 5, text: '"إدارة 3 فنادق من منصة واحدة كانت تبدو مستحيلة. iHotel جعلها في غاية السهولة. أتمتة حالة "غير مُشغّل" وحدها توفّر علينا 4-5 ساعات عمل يومياً. عندما تبقى الغرفة فارغة 5 دقائق يُطفأ المكيف والإضاءة تلقائياً. سجلات الصيانة دقيقة وفورية، وتقارير الإيرادات محدّثة دائماً."', name: 'طارق محمد', title: 'مدير تقنية الفنادق', hotel: 'مجموعة 3 فنادق، مكة المكرمة', stat: '5 ساعات يومياً موفّرة' },
      { stars: 5, text: '"سيناريو المغادرة التلقائي أذهلنا. بمجرد تسجيل خروج الضيف، تُعيد الغرفة ضبط نفسها — إضاءة، مكيف، ستائر — كل شيء يتجهّز من تلقاء ذاته. فريق التدبير لدينا يجد الغرفة جاهزة قبل أن يبدأ العمل. قلّصنا وقت تجهيز الغرف بأكثر من 20 دقيقة في كل مغادرة."', name: 'هند القحطاني', title: 'مديرة التدبير المنزلي', hotel: 'منتجع 4 نجوم، العُلا', stat: '20 دقيقة أسرع في التجهيز' },
      { stars: 5, text: '"قبل iHotel لم تكن لدينا أي رؤية على الطاقة المُهدرة. الآن نرى بدقة أي الغرف تستهلك كهرباء وهي فارغة، ونُفعّل وضع "غير مُشغّل" من لوحة التحكم مباشرة. انخفضت فاتورة الكهرباء بما يقارب الثلث في الربع الأول، وهذا التوفير وحده يغطّي تكلفة المنصة أضعافاً."', name: 'عبدالله الشهري', title: 'كبير المهندسين', hotel: 'فندق 250 غرفة، المدينة المنورة', stat: '32% توفير في الكهرباء' },
      { stars: 5, text: '"لوحة تحكم الفنادق المتعددة هي ما أقنعني. أنتقل بين فنادقنا الثلاثة بنقرة واحدة وأرى حالة كل غرفة مباشرة — مُشغّلة، فارغة، في الخدمة، غير مُشغّل. إذا لاحظت ما يستدعي التدخل، أرسل أمر التحكم فوراً. أصبحت iHotel الجهاز العصبي المركزي لمجموعة فنادقنا."', name: 'منى الحربي', title: 'مديرة مجموعة الفنادق', hotel: 'مجموعة فنادق، الدمام', stat: '3 فنادق، منصة واحدة' },
    ],
    ctaTitle: 'هل أنت مستعد لتحويل فندقك؟',
    ctaSub: 'انضم لمشغّلي الفنادق الذين يديرون منشآت أكثر ذكاءً وكفاءةً وربحيةً مع iHotel. IoT فوري. بوابة الضيف. تتبع الإيرادات. كل شيء في منصة واحدة.',
    ctaBtn: 'دخول لوحة تحكم فندقك',
    sysAdmin: 'مدير النظام؟',
    platformLogin: 'دخول المنصة',
    footer: 'صُنع لقطاع الضيافة',
    loginTitle: 'دخول موظفي الفندق',
    loginSub: 'سجّل دخولك لإدارة فندقك',
    codeLabel: 'رمز الفندق',
    codePh: 'مثال: hilton-grand',
    codeHint: 'يوفّره مسؤول الفندق',
    userLabel: 'اسم المستخدم',
    userPh: 'أدخل اسم المستخدم',
    passLabel: 'كلمة المرور',
    passPh: 'أدخل كلمة المرور',
    signIn: 'دخول',
    forgotPw: 'نسيت كلمة المرور؟',
    forgotMsg: 'يرجى التواصل مع مسؤول الفندق لإعادة تعيين كلمة المرور.',
  },
};

// ── Feature icon map (stable, shared across languages) ───────────────────────
const FEATURE_ICONS = [Wifi, BedDouble, BarChart3, Shield, Leaf, Zap, Bell, Cpu];
const FEATURE_COLORS = [
  'bg-blue-50 text-blue-500', 'bg-indigo-50 text-indigo-500', 'bg-emerald-50 text-emerald-500',
  'bg-purple-50 text-purple-500', 'bg-green-50 text-green-600', 'bg-amber-50 text-amber-500',
  'bg-red-50 text-red-500', 'bg-slate-50 text-slate-500',
];

// ── Room heatmap data ─────────────────────────────────────────────────────────
const ROOMS = [1,1,0,4,1,0,0,1,2,1,0,1,3,1,1,0,1,4,1,0,1,1,2,0,1,4,0,1,1,0,0,1,1,2,0,1];
const ROOM_CLR = ['bg-white/20','bg-blue-400','bg-amber-400','bg-red-400','bg-slate-500/50'];
const ROOM_LBL = ['Vacant','Occupied','Service','Maintenance','Not Occupied'];

// ── Mock UI components (always in English — these show the real product UI) ──

function DashboardMockup() {
  return (
    <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 text-xs">
      <div className="bg-slate-950 px-3 py-2 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/70" /><div className="w-3 h-3 rounded-full bg-amber-500/70" /><div className="w-3 h-3 rounded-full bg-green-500/70" />
        </div>
        <div className="flex-1 mx-3">
          <div className="bg-white/10 rounded px-3 py-1 text-white/40 text-[11px] font-mono text-center truncate">app.ihotel.io — Hilton Grand Hotel</div>
        </div>
      </div>
      <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/10 rounded"><LayoutDashboard size={12} className="text-white" /></div>
          <span className="text-white font-bold text-xs">Hilton Grand</span>
          <span className="text-white/30 text-[11px]">iHotel</span>
        </div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-white/40 text-[11px]">36 rooms live</span></div>
      </div>
      <div className="bg-slate-800/80 px-3 py-2 grid grid-cols-4 gap-2">
        {[{l:'Occupied',v:'24',c:'text-blue-300'},{l:'Vacant',v:'6',c:'text-white/50'},{l:'Service',v:'4',c:'text-amber-300'},{l:'Revenue',v:'142K',c:'text-emerald-300'}].map(k => (
          <div key={k.l} className="bg-white/5 rounded px-2 py-2 text-center">
            <p className={`font-bold ${k.c} text-sm`}>{k.v}</p>
            <p className="text-white/30 text-[10px] uppercase tracking-wide mt-0.5">{k.l}</p>
          </div>
        ))}
      </div>
      <div className="bg-slate-900 p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-white/40 text-[11px] uppercase tracking-wider font-medium">Room Heatmap — Live</span>
          <div className="flex-1 h-px bg-white/5" /><span className="text-white/25 text-[11px]">Floors 1–3</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROOMS.map((s,i) => <div key={i} className={`w-[24px] h-[24px] rounded-[4px] ${ROOM_CLR[s]} transition-all`} title={`Room ${101+i}: ${ROOM_LBL[s]}`} />)}
        </div>
        <div className="flex gap-4 mt-2">
          {[['bg-blue-400','Occupied'],['bg-amber-400','Service'],['bg-red-400','Maint.'],['bg-white/20','Vacant']].map(([c,l]) => (
            <div key={l} className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-sm ${c}`} /><span className="text-white/35 text-[11px]">{l}</span></div>
          ))}
        </div>
      </div>
      <div className="bg-slate-900 border-t border-white/5 px-3 py-2.5 space-y-1.5">
        {[{room:'214',msg:'AC set → 22°C · COOL',color:'text-blue-300'},{room:'301',msg:'Guest checked in',color:'text-green-300'},{room:'108',msg:'DND activated',color:'text-amber-300'},{room:'415',msg:'NOT_OCCUPIED — 5 min no motion',color:'text-slate-400'}].map((e,i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-white/20 shrink-0" />
            <span className={`font-semibold text-xs ${e.color}`}>Rm {e.room}</span>
            <span className="text-white/35 text-[11px] truncate">{e.msg}</span>
            <span className="text-white/20 text-[11px] ms-auto shrink-0">{i+1}m ago</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomControlCard() {
  return (
    <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-4 w-52">
      <div className="flex items-center justify-between mb-3">
        <div><p className="text-sm font-bold text-gray-800">Room 214</p><p className="text-[11px] text-gray-400">Suite · Floor 2</p></div>
        <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">Occupied</span>
      </div>
      <div className="space-y-2">
        {[{Icon:Thermometer,label:'AC',val:'22°C · COOL',valCls:'text-gray-700'},{Icon:Lock,label:'Door',val:'Locked',valCls:'text-green-600'},{Icon:Moon,label:'DND',val:'Active',valCls:'text-blue-600'}].map(({Icon,label,val,valCls}) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-gray-500"><Icon size={13} /><span className="text-xs">{label}</span></div>
            <span className={`text-xs font-semibold ${valCls}`}>{val}</span>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-gray-500"><Lightbulb size={13} /><span className="text-xs">Lights</span></div>
          <div className="flex gap-1"><div className="w-4 h-4 rounded-sm bg-amber-400" /><div className="w-4 h-4 rounded-sm bg-amber-400" /><div className="w-4 h-4 rounded-sm bg-gray-200" /></div>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-gray-100 grid grid-cols-2 gap-1.5">
        <div className="text-center bg-gray-50 rounded py-1.5"><p className="text-[10px] text-gray-400">CO₂</p><p className="text-xs font-bold text-gray-700">612 ppm</p></div>
        <div className="text-center bg-gray-50 rounded py-1.5"><p className="text-[10px] text-gray-400">Humidity</p><p className="text-xs font-bold text-gray-700">51%</p></div>
      </div>
    </div>
  );
}

function PMSMockup() {
  return (
    <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 text-xs">
      <div className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-white/5">
        <span className="text-white font-semibold text-xs">Reservations — PMS</span>
        <span className="text-[11px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">3 today</span>
      </div>
      <div className="bg-slate-900 p-3 space-y-2">
        {[{room:'301',guest:'Khalid Al-Rashid',in:'Mar 1',out:'Mar 5',status:'ACTIVE',color:'text-emerald-400',bg:'bg-emerald-500/10'},{room:'214',guest:'Sara Mohammed',in:'Mar 2',out:'Mar 3',status:'ACTIVE',color:'text-emerald-400',bg:'bg-emerald-500/10'},{room:'108',guest:'Ahmed Al-Farsi',in:'Feb 28',out:'Mar 1',status:'CHECKOUT',color:'text-slate-500',bg:'bg-slate-700/30'}].map(r => (
          <div key={r.room} className="bg-white/5 rounded-lg p-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><span className="text-white/70 text-[11px] font-bold">{r.room}</span></div>
              <div><p className="text-white/85 font-semibold text-[11px]">{r.guest}</p><p className="text-white/35 text-[10px]">{r.in} → {r.out}</p></div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.bg} ${r.color}`}>{r.status}</span>
          </div>
        ))}
        <div className="flex gap-1 mt-1">
          {[{v:'94K',l:'SAR / month',c:'text-emerald-400'},{v:'78%',l:'Occupancy',c:'text-blue-400'},{v:'4.8★',l:'Avg. Rating',c:'text-amber-400'}].map(s => (
            <div key={s.l} className="flex-1 bg-white/5 rounded-lg p-2.5 text-center"><p className={`font-bold text-sm ${s.c}`}>{s.v}</p><p className="text-white/35 text-[10px]">{s.l}</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GuestPortalMockup() {
  return (
    <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10 text-xs w-52">
      <div className="bg-blue-700 px-3 py-3 flex items-center justify-between">
        <div><p className="text-white font-bold text-xs">Hilton Grand</p><p className="text-blue-200 text-[11px]">Guest Portal · Room 301</p></div>
        <span className="text-white font-bold text-base">301</span>
      </div>
      <div className="bg-white p-3 space-y-2.5">
        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-[10px] text-gray-400 mb-2 font-medium">Lighting</p>
          <div className="flex gap-1">
            {[['bg-amber-400','ON','text-white'],['bg-gray-200','OFF','text-gray-400'],['bg-amber-400','ON','text-white']].map(([bg,l,tc],i) => (
              <div key={i} className={`flex-1 ${bg} rounded text-center py-1.5`}><p className={`text-[10px] font-bold ${tc}`}>{l}</p></div>
            ))}
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-[10px] text-gray-400 mb-1.5 font-medium">AC — 22°C</p>
          <div className="flex gap-1">
            {['Cool','Heat','Fan'].map((m,i) => (
              <div key={m} className={`flex-1 rounded text-center py-1.5 ${i===0?'bg-blue-500':'bg-gray-200'}`}><p className={`text-[10px] font-bold ${i===0?'text-white':'text-gray-400'}`}>{m}</p></div>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          {['Reading','TV','Sleep'].map((p,i) => (
            <div key={p} className={`flex-1 rounded-lg py-2 text-center border ${i===2?'bg-indigo-500 border-indigo-500':'bg-gray-50 border-gray-200'}`}><p className={`text-[10px] font-semibold ${i===2?'text-white':'text-gray-500'}`}>{p}</p></div>
          ))}
        </div>
        <div className="flex items-center justify-between bg-gray-50 rounded-lg px-2.5 py-2">
          <span className="text-[10px] text-gray-500 font-semibold">Do Not Disturb</span>
          <div className="w-8 h-4 bg-indigo-500 rounded-full flex items-center justify-end pr-0.5"><div className="w-3 h-3 bg-white rounded-full" /></div>
        </div>
      </div>
    </div>
  );
}

// ── Login modal ───────────────────────────────────────────────────────────────
function HotelLoginModal({ onClose, t, isRTL }) {
  const [hotelSlug, setHotelSlug] = useState('');
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const { login, error } = useAuthStore();

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await login(hotelSlug.trim(), username, password);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-slate-800 rounded-lg"><LayoutDashboard size={14} className="text-white" /></div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">{t.loginTitle}</h2>
              <p className="text-[11px] text-gray-400">{t.loginSub}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-300 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.codeLabel}</label>
            <input className="input" value={hotelSlug} onChange={e => setHotelSlug(e.target.value)} placeholder={t.codePh} autoFocus required />
            <p className="text-[10px] text-gray-400 mt-1">{t.codeHint}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.userLabel}</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder={t.userPh} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t.passLabel}</label>
            <div className="relative">
              <input className="input pr-10" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={t.passPh} required />
              <button type="button" className="absolute inset-y-0 end-3 flex items-center text-gray-300 hover:text-gray-500" onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2">
            <Shield size={15} />
            {loading ? '…' : t.signIn}
          </button>
        </form>
        <div className="px-6 pb-5 space-y-2 text-center">
          {forgotSent
            ? <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{t.forgotMsg}</p>
            : <button onClick={() => setForgotSent(true)} className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2 transition">{t.forgotPw}</button>
          }
          <p className="text-[11px] text-gray-400">
            {t.sysAdmin}{' '}
            <Link to="/platform/login" className="text-gray-600 hover:text-gray-800 underline underline-offset-2 font-medium">{t.platformLogin}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── SEO ───────────────────────────────────────────────────────────────────────
function SEOMeta({ lang }) {
  useEffect(() => {
    document.title = lang === 'ar'
      ? 'iHotel — منصة إدارة الفنادق الذكية'
      : 'iHotel — Smart Hotel IoT Management Platform';
    const set = (name, content, prop = false) => {
      const sel = prop ? `meta[property="${name}"]` : `meta[name="${name}"]`;
      let el = document.querySelector(sel);
      if (!el) { el = document.createElement('meta'); prop ? el.setAttribute('property', name) : el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    if (lang === 'ar') {
      set('description', 'iHotel — منصة إدارة الفنادق الذكية. تحكم في المكيف والإضاءة والستائر وأجهزة الاستشعار في كل غرفة من لوحة تحكم واحدة. نظام حجوزات، بوابة الضيف، وتوفير الطاقة.');
      set('keywords', 'إدارة فنادق، فندق ذكي، إنترنت الأشياء للفنادق، أتمتة الغرف، نظام إدارة الفنادق، لوحة تحكم الفندق');
    } else {
      set('description', 'iHotel — the all-in-one smart hotel IoT platform. Control AC, lights, curtains and sensors across all rooms from one real-time dashboard. PMS, guest portal, energy automation.');
      set('keywords', 'hotel IoT, smart hotel, hotel management system, room automation, PMS, hotel dashboard, IoT hotel, smart room, hotel technology');
    }
    set('og:title', document.title, true);
    set('og:type', 'website', true);
    return () => { document.title = 'iHotel'; };
  }, [lang]);
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [showLogin, setShowLogin] = useState(false);
  const [lang, setLang]           = useState('en');
  const t     = T[lang];
  const isRTL = lang === 'ar';

  // Load Cairo font for Arabic
  useEffect(() => {
    if (lang !== 'ar') return;
    const id = 'cairo-font';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap';
    document.head.appendChild(link);
  }, [lang]);

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      style={isRTL ? { fontFamily: "'Cairo', 'Segoe UI', system-ui, sans-serif" } : {}}
      className="min-h-screen bg-white"
    >
      <SEOMeta lang={lang} />

      {/* ── Navbar ── */}
      <nav className="fixed top-0 start-0 end-0 z-40 bg-slate-950/95 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-white/10 rounded-lg"><LayoutDashboard size={15} className="text-white" /></div>
            <span className="font-bold text-white tracking-tight text-sm">iHotel</span>
            <span className="hidden sm:inline text-[9px] font-semibold text-white/25 uppercase tracking-widest bg-white/8 px-2 py-0.5 rounded-full">{t.nav.features === 'Features' ? 'Smart Platform' : 'منصة ذكية'}</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#features" className="hidden md:block text-sm text-white/45 hover:text-white/75 transition">{t.nav.features}</a>
            <a href="#showcase" className="hidden md:block text-sm text-white/45 hover:text-white/75 transition">{t.nav.platform}</a>
            <a href="#testimonials" className="hidden md:block text-sm text-white/45 hover:text-white/75 transition">{t.nav.reviews}</a>
            {/* Language toggle */}
            <button
              onClick={() => setLang(l => l === 'en' ? 'ar' : 'en')}
              className="text-white/40 hover:text-white/75 text-sm font-medium transition border border-white/10 px-3 py-1 rounded-lg hover:border-white/25"
            >
              {t.langToggle}
            </button>
            <button onClick={() => setShowLogin(true)}
              className="bg-white/10 hover:bg-white/18 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition border border-white/10">
              {t.nav.signIn}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 pt-28 pb-24 px-6 relative overflow-hidden">
        <div className="absolute -top-60 -start-60 w-[700px] h-[700px] bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 end-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto relative">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/8 border border-white/10 rounded-full px-3 py-1.5 mb-7">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-white/50 font-medium">{t.badge}</span>
              </div>
              <h1 className="text-5xl font-bold text-white leading-tight mb-5">
                {t.heroLine1}<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-indigo-300 to-purple-300">
                  {t.heroLine2}
                </span>
                {t.heroLine3 && <><br />{t.heroLine3}</>}
              </h1>
              <p className="text-white/50 text-base leading-relaxed mb-8 max-w-md">{t.heroSub}</p>
              <div className="flex gap-8 mb-10 flex-wrap">
                {t.stats.map(s => (
                  <div key={s.l}>
                    <p className="text-2xl font-bold text-white">{s.v}</p>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <button onClick={() => setShowLogin(true)}
                  className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-7 py-3 rounded-xl transition shadow-xl shadow-blue-500/20 text-sm">
                  {t.getStarted}
                  {isRTL ? <ChevronRight size={15} className="rotate-180" /> : <ArrowRight size={15} />}
                </button>
                <a href="#features" className="inline-flex items-center gap-1.5 text-white/45 hover:text-white/75 text-sm font-medium transition">
                  {t.seeFeatures}
                  {isRTL ? <ChevronRight size={13} className="rotate-180" /> : <ChevronRight size={13} />}
                </a>
              </div>
            </div>
            <div className="relative hidden lg:block">
              <DashboardMockup />
              <div className="absolute -end-5 -bottom-8 shadow-2xl"><RoomControlCard /></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trusted by ── */}
      <div className="bg-slate-900 border-t border-white/5 border-b border-b-white/5 px-6 py-5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-center">
          <p className="text-white/25 text-xs uppercase tracking-widest font-semibold">{t.trustedBy}</p>
          {t.cities.map(city => <span key={city} className="text-white/40 text-sm font-medium">{city}</span>)}
        </div>
      </div>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">{t.featuresTag}</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">{t.featuresTitle}</h2>
            <p className="text-gray-400 text-sm max-w-lg mx-auto">{t.featuresSub}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {t.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              const [bg, ic] = FEATURE_COLORS[i].split(' ');
              return (
                <div key={i} className="p-5 border border-gray-100 rounded-xl hover:border-gray-200 hover:shadow-md transition cursor-default">
                  <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
                    <Icon size={18} className={ic} />
                  </div>
                  <h3 className="font-semibold text-gray-800 text-sm mb-2">{f.title}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Showcase ── */}
      <section id="showcase" className="py-24 px-6 bg-slate-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-widest mb-2">{t.platformTag}</p>
            <h2 className="text-3xl font-bold text-white mb-3">{t.platformTitle}</h2>
            <p className="text-white/30 text-sm max-w-lg mx-auto">{t.platformSub}</p>
          </div>
          <div className="grid lg:grid-cols-3 gap-8">
            <div><p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.dashLabel}</p><DashboardMockup /></div>
            <div><p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.pmsLabel}</p><PMSMockup /></div>
            <div><p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.guestLabel}</p><div className="flex justify-center"><GuestPortalMockup /></div></div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-12">
            {(isRTL
              ? ['تحديث فوري', 'تسجيل دخول QR', 'تقارير الإيرادات', 'إدارة المناوبات', 'أتمتة الطاقة', 'سيناريوهات ذكية', 'عدم الإزعاج / SOS', 'فنادق متعددة', 'تحكم ذكي بالغرف', 'صلاحيات بالأدوار', 'بوابة الضيف']
              : ['Real-time telemetry', 'QR check-in', 'Revenue reports', 'Shift management', 'Energy automation', 'Scene presets', 'DND / SOS', 'Multi-property', 'Smart room control', 'Role-based access', 'Guest portal']
            ).map(pill => (
              <span key={pill} className="text-[11px] text-white/35 bg-white/5 border border-white/8 px-3 py-1 rounded-full">{pill}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section id="testimonials" className="py-24 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">{t.reviewsTag}</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">{t.reviewsTitle}</h2>
            <p className="text-gray-400 text-sm">{t.reviewsSub}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {t.testimonials.map((te, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col">
                <div className="flex gap-0.5 mb-4">
                  {[1,2,3,4,5].map(s => <Star key={s} size={13} className={s <= te.stars ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} />)}
                </div>
                <p className="text-gray-500 text-sm leading-relaxed flex-1 italic">{te.text}</p>
                <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{te.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{te.title} · {te.hotel}</p>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">{te.stat}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 relative overflow-hidden">
        <div className="absolute -top-40 -end-40 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-2xl mx-auto text-center relative">
          <h2 className="text-4xl font-bold text-white mb-4">{t.ctaTitle}</h2>
          <p className="text-blue-100 text-base leading-relaxed mb-10 max-w-md mx-auto">{t.ctaSub}</p>
          <button onClick={() => setShowLogin(true)}
            className="inline-flex items-center gap-2 bg-white text-blue-600 font-bold px-8 py-3.5 rounded-xl text-sm hover:bg-blue-50 transition shadow-xl">
            {t.ctaBtn}
            {isRTL ? <ChevronRight size={16} className="rotate-180" /> : <ArrowRight size={16} />}
          </button>
          <p className="text-blue-200/40 text-[11px] mt-7">
            {t.sysAdmin}{' '}
            <Link to="/platform/login" className="text-blue-100/60 hover:text-blue-100 underline underline-offset-2">{t.platformLogin}</Link>
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-950 px-6 py-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-white/10 rounded"><LayoutDashboard size={12} className="text-white" /></div>
            <span className="font-bold text-white text-sm">iHotel</span>
            <span className="text-white/20 text-xs">· {isRTL ? 'منصة إدارة الفنادق الذكية' : 'Smart Hotel IoT Platform'}</span>
          </div>
          <p className="text-white/15 text-xs">{t.footer}</p>
        </div>
      </footer>

      {/* ── Login modal ── */}
      {showLogin && <HotelLoginModal onClose={() => setShowLogin(false)} t={t} isRTL={isRTL} />}
    </div>
  );
}
