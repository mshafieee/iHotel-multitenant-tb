import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Eye, EyeOff, Wifi, Shield,
  Zap, BarChart3, BedDouble, Thermometer,
  Lightbulb, Lock, Moon, Cpu, Star,
  Bell, Leaf, X, ArrowRight, ChevronRight,
  CheckCircle, TrendingUp, Users, Clock,
} from 'lucide-react';
import useAuthStore from '../store/authStore';

// ── Scroll reveal hook ────────────────────────────────────────────────────────
function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    const els = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
}

// ── Floating particles (stable — computed once, never random on render) ───────
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  size:     ((i * 7  + 3) % 5)  + 2,
  x:        ((i * 19 + 5) % 100),
  y:        ((i * 13 + 10) % 100),
  duration: ((i * 3  + 8) % 10) + 8,
  delay:     (i * 0.65) % 6,
  opacity:  (((i * 11 + 5) % 4) * 0.09) + 0.08,
}));

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {PARTICLES.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-blue-400"
          style={{
            width:     p.size,
            height:    p.size,
            left:      `${p.x}%`,
            top:       `${p.y}%`,
            opacity:   p.opacity,
            animation: `particleFloat ${p.duration}s ${p.delay}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Animated stat card (counts up on scroll into view) ───────────────────────
function AnimatedStat({ value, label, sub, icon: Icon }) {
  const ref        = useRef(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setOn(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1">
      <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-2 backdrop-blur-sm
                      transition-transform duration-500"
           style={on ? { transform: 'scale(1)', opacity: 1 } : { transform: 'scale(0.7)', opacity: 0 }}>
        <Icon size={20} className="text-white" />
      </div>
      <p
        className="text-3xl font-extrabold leading-tight text-white"
        style={on
          ? { animation: 'counterFade 0.7s ease forwards' }
          : { opacity: 0, transform: 'scale(0.6) translateY(10px)' }}
      >
        {value}
      </p>
      <p className="text-sm font-semibold text-white/90"
         style={on ? { animation: 'fadeUp 0.7s 0.25s ease both' } : { opacity: 0 }}>
        {label}
      </p>
      <p className="text-xs text-white/50"
         style={on ? { animation: 'fadeUp 0.7s 0.4s ease both' } : { opacity: 0 }}>
        {sub}
      </p>
    </div>
  );
}

// ── Hero carousel slides (EN + AR) ───────────────────────────────────────────
const HERO_SLIDES = {
  en: [
    {
      badge:   '🟢 Live platform · Real-time IoT control',
      line1:   'The Smartest Way to',
      line2:   'Run Your Hotel',
      sub:     'One platform to monitor every room in real-time, automate guest experiences, manage reservations, and cut energy costs — all from a single dashboard.',
      accent:  'from-blue-300 via-cyan-300 to-indigo-300',
      mockup:  'dashboard',
      dot:     'bg-blue-400',
    },
    {
      badge:   '🌟 Guest Experience · QR portal · No app needed',
      line1:   'Unforgettable',
      line2:   'Guest Experiences',
      sub:     'Guests scan a QR code and instantly control their AC, lights, curtains, and scene presets from their phone — no app download required. DND, housekeeping requests, and reviews built in.',
      accent:  'from-emerald-300 via-teal-300 to-cyan-400',
      mockup:  'guest',
      dot:     'bg-emerald-400',
    },
    {
      badge:   '⚡ Energy AI · Automatic 30–38% savings',
      line1:   'Cut Energy Costs,',
      line2:   'Automatically',
      sub:     'iHotel detects vacant rooms and shuts off AC and lights automatically. Motion sensors, departure automation, and smart scenes reduce your electricity bill by up to 38%.',
      accent:  'from-amber-300 via-orange-300 to-yellow-300',
      mockup:  'pms',
      dot:     'bg-amber-400',
    },
    {
      badge:   '🏨 Multi-Property · One platform, all your hotels',
      line1:   'Manage Every',
      line2:   'Property, Instantly',
      sub:     'Switch between hotels with a single click. See every room live, trigger control commands remotely, and track revenue across your entire group — in one unified view.',
      accent:  'from-violet-300 via-purple-300 to-indigo-300',
      mockup:  'dashboard',
      dot:     'bg-violet-400',
    },
  ],
  ar: [
    {
      badge:   '🟢 منصة فعلية · تحكم لحظي بأجهزة IoT',
      line1:   'أذكى طريقة',
      line2:   'لإدارة فندقك',
      sub:     'منصة واحدة لمراقبة كل غرفة لحظياً، وأتمتة تجربة الضيوف، وإدارة الحجوزات، وتخفيض فاتورة الطاقة — كل شيء من لوحة تحكم واحدة.',
      accent:  'from-blue-300 via-cyan-300 to-indigo-300',
      mockup:  'dashboard',
      dot:     'bg-blue-400',
    },
    {
      badge:   '🌟 تجربة الضيف · بوابة QR · بلا تطبيق',
      line1:   'تجارب ضيوف',
      line2:   'لا تُنسى',
      sub:     'يمسح الضيف رمز QR ويتحكم فوراً في المكيف والإضاءة والستائر والسيناريوهات من هاتفه — دون تحميل أي تطبيق. عدم الإزعاج وطلبات التدبير والتقييمات كلها مدمجة.',
      accent:  'from-emerald-300 via-teal-300 to-cyan-400',
      mockup:  'guest',
      dot:     'bg-emerald-400',
    },
    {
      badge:   '⚡ ذكاء الطاقة · توفير تلقائي 30–38%',
      line1:   'وفّر فاتورة الطاقة',
      line2:   'بشكل تلقائي',
      sub:     'تكتشف iHotel الغرف الفارغة وتُوقف المكيف والإضاءة تلقائياً. حساسات الحركة وأتمتة المغادرة والسيناريوهات الذكية تخفّض فاتورة كهربائك بما يصل إلى 38%.',
      accent:  'from-amber-300 via-orange-300 to-yellow-300',
      mockup:  'pms',
      dot:     'bg-amber-400',
    },
    {
      badge:   '🏨 فنادق متعددة · منصة واحدة لكل فنادقك',
      line1:   'أدر كل فنادقك',
      line2:   'بلحظة واحدة',
      sub:     'انتقل بين الفنادق بنقرة واحدة. شاهد كل غرفة مباشرة، وأرسل أوامر التحكم عن بُعد، وتابع الإيرادات عبر مجموعتك كاملة — في عرض واحد.',
      accent:  'from-violet-300 via-purple-300 to-indigo-300',
      mockup:  'dashboard',
      dot:     'bg-violet-400',
    },
  ],
};

// ── Translations (idiomatic Arabic, not literal) ──────────────────────────────
const T = {
  en: {
    langToggle: 'عربي',
    nav: { features: 'Features', platform: 'Platform', reviews: 'Reviews', signIn: 'Sign In' },
    badge: '🟢 Live platform · Real-time IoT control',
    heroLine1: 'The Smartest Way to',
    heroLine2: 'Run Your Hotel',
    heroLine3: '',
    heroSub: 'One platform to monitor every room in real-time, automate guest experiences, manage reservations, and cut energy costs — all from a single dashboard.',
    stats: [{ v: '500+', l: 'Rooms Managed' }, { v: '38%', l: 'Avg Energy Saved' }, { v: '< 1s', l: 'Live Updates' }, { v: '4.9★', l: 'Guest Rating' }],
    getStarted: 'Sign In to Your Hotel',
    bookRoom: 'Book a Room',
    seeFeatures: 'Explore features',
    trustedBy: 'Deployed in',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Dubai'],
    featuresTag: '✦ Platform Features',
    featuresTitle: 'Everything your hotel needs — nothing it doesn\'t',
    featuresSub: 'Built for hotel operators who demand real-time visibility, energy intelligence, and outstanding guest experience — all from one platform.',
    features: [
      { title: 'Real-time IoT Control',    desc: 'AC, lights, curtains, door locks, CO₂ and humidity — every room updated every second.', result: '< 1s response' },
      { title: 'PMS & Reservations',       desc: 'QR check-in, guest portal, room allocation, checkout automation — all built in.', result: 'Zero paperwork' },
      { title: 'Revenue & Shift Tracking', desc: 'Live income logs, shift reconciliation, room-type pricing, and export to management.', result: 'Full accountability' },
      { title: 'Enterprise Security',      desc: 'JWT auth, bcrypt encryption, per-hotel isolation, and rate limiting out of the box.', result: 'Bank-grade security' },
      { title: 'Energy Intelligence',      desc: 'Auto-vacate on departure, motion-triggered AC and lights off — 30–40% energy reduction.', result: '~38% saved' },
      { title: 'Smart Automation Scenes',  desc: 'Welcome routines, departure cleanup, sleep presets, DND — all triggered automatically.', result: 'Fully hands-free' },
      { title: 'Instant Staff Alerts',     desc: 'SOS, housekeeping requests, checkout reminders — instant notification to the right person.', result: '0 missed alerts' },
      { title: 'IoT Hardware Ready',       desc: 'Works with any smart room controller. Bring your own hardware. Zero vendor lock-in.', result: 'Any hardware' },
    ],
    platformTag: '✦ One Platform',
    platformTitle: 'Every hotel workflow, covered',
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
    badge: '🟢 منصة فعلية · تحكم لحظي بأجهزة IoT',
    heroLine1: 'أذكى طريقة',
    heroLine2: 'لإدارة فندقك',
    heroLine3: '',
    heroSub: 'منصة واحدة لمراقبة كل غرفة لحظياً، وأتمتة تجربة الضيوف، وإدارة الحجوزات، وتخفيض فاتورة الطاقة — كل شيء من لوحة تحكم واحدة.',
    stats: [{ v: '+500', l: 'غرفة مُدارة' }, { v: '38%', l: 'متوسط توفير الطاقة' }, { v: '< 1ث', l: 'تحديث فوري' }, { v: '4.9★', l: 'تقييم الضيوف' }],
    getStarted: 'ادخل للوحة تحكم فندقك',
    bookRoom: 'احجز غرفة',
    seeFeatures: 'اكتشف المميزات',
    trustedBy: '✦ فنادق نشطة في',
    cities: ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'دبي'],
    featuresTag: '✦ مميزات المنصة',
    featuresTitle: 'كل ما يحتاجه فندقك — في مكان واحد',
    featuresSub: 'صُممت لمشغّلي الفنادق الذين يريدون الرؤية الفورية، وذكاء الطاقة، وتجربة ضيوف لا تُنسى — كل ذلك من منصة واحدة.',
    features: [
      { title: 'تحكم لحظي بأجهزة IoT',    desc: 'مكيف، إضاءة، ستائر، أقفال الأبواب، CO₂ والرطوبة — كل غرفة محدّثة كل ثانية.', result: 'استجابة أقل من ثانية' },
      { title: 'الحجوزات وإدارة الفندق',   desc: 'تسجيل دخول بـ QR، بوابة الضيف، توزيع الغرف، وأتمتة المغادرة — كل شيء جاهز.', result: 'بلا ورق' },
      { title: 'الإيرادات والمناوبات',       desc: 'سجلات إيرادات فورية، مطابقة المناوبات، تسعير أنواع الغرف، والتصدير للإدارة.', result: 'مساءلة كاملة' },
      { title: 'أمان المستوى المؤسسي',       desc: 'مصادقة JWT، تشفير bcrypt، عزل كل فندق، وحد معدل الطلبات — جاهز من البداية.', result: 'حماية بنكية' },
      { title: 'ذكاء الطاقة',               desc: 'إيقاف تلقائي عند المغادرة، وإطفاء عند انعدام الحركة — وفّر من 30 إلى 40% من الطاقة.', result: 'توفير ~38%' },
      { title: 'سيناريوهات الأتمتة الذكية', desc: 'روتين الاستقبال، تنظيف المغادرة، وضع النوم، عدم الإزعاج — كل شيء يعمل تلقائياً.', result: 'تشغيل بالكامل آلياً' },
      { title: 'تنبيهات فورية للموظفين',    desc: 'نداء الطوارئ، طلبات التدبير، تذكيرات المغادرة — إشعار فوري للشخص المناسب.', result: 'صفر تنبيهات فائتة' },
      { title: 'جاهز لأي أجهزة ذكية',       desc: 'يعمل مع أي وحدة تحكم ذكية للغرف. جهازك أو أي جهاز. بلا قيود على الموردين.', result: 'أي جهاز' },
    ],
    platformTag: '✦ منصة واحدة',
    platformTitle: 'يغطي كل سير عمل في فندقك',
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
    ctaTitle: 'فندقك يستحق أفضل من ذلك',
    ctaSub: 'انضم لمشغّلي الفنادق الذين يديرون منشآت أكثر ذكاءً وكفاءةً وربحيةً. IoT فوري، بوابة ضيف، تتبع إيرادات، وأتمتة طاقة — كل ذلك في منصة iHotel الواحدة.',
    ctaBtn: 'ادخل لوحة تحكم فندقك الآن',
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
  const [lang, setLang]           = useState('ar');
  const [slideIdx, setSlideIdx]   = useState(0);
  const t      = T[lang];
  const isRTL  = lang === 'ar';
  const slides = HERO_SLIDES[lang];
  const slide  = slides[slideIdx];

  useScrollReveal();

  // Auto-advance hero slides every 5 s
  useEffect(() => {
    const id = setInterval(() => setSlideIdx(i => (i + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [slides.length]);

  // Reset slide index when language changes
  useEffect(() => { setSlideIdx(0); }, [lang]);

  // Always preload Cairo font (Arabic is the default)
  useEffect(() => {
    const id = 'cairo-font';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

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
            <Link to="/book" className="hidden md:flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 font-medium transition">
              <BedDouble size={13} />{t.bookRoom}
            </Link>
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
      <section className="hero-bg pt-28 pb-20 px-6 relative overflow-hidden" style={{ minHeight: '92vh', display: 'flex', alignItems: 'center' }}>

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }} />

        {/* Floating particles */}
        <FloatingParticles />

        {/* Ambient glow orbs */}
        <div className="absolute -top-40 start-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 -end-20 w-[400px] h-[400px] bg-indigo-500/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 start-0 w-[500px] h-[400px] bg-violet-600/6 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto relative z-10 w-full">
          <div className="grid lg:grid-cols-2 gap-14 items-center">

            {/* ── Slide content ── */}
            <div key={slideIdx} style={{ animation: 'fadeUp 0.7s ease forwards' }}>

              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-3 py-1.5 mb-7">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-300 font-semibold">{slide.badge}</span>
              </div>

              {/* Headline */}
              <h1 className="font-extrabold text-white leading-[1.1] mb-6 text-5xl">
                {slide.line1}<br />
                <span className={`text-transparent bg-clip-text bg-gradient-to-r ${slide.accent}`}>
                  {slide.line2}
                </span>
              </h1>

              <p className="text-white/55 text-base leading-relaxed mb-10 max-w-md">{slide.sub}</p>

              {/* Stats strip */}
              <div className="grid grid-cols-4 gap-3 mb-10">
                {t.stats.map((s, i) => (
                  <div
                    key={s.l}
                    className="bg-white/5 border border-white/8 rounded-xl px-3 py-3 text-center hover:bg-white/8 transition-colors duration-200"
                    style={{ animation: `fadeUp 0.6s ${0.1 + i * 0.08}s ease both` }}
                  >
                    <p className="text-xl font-extrabold text-white leading-tight">{s.v}</p>
                    <p className="text-[10px] text-white/35 mt-1 leading-snug">{s.l}</p>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setShowLogin(true)}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold px-7 py-3 rounded-xl transition shadow-2xl shadow-blue-500/30 text-sm">
                  {t.getStarted}
                  {isRTL ? <ChevronRight size={15} className="rotate-180" /> : <ArrowRight size={15} />}
                </button>
                <Link to="/book"
                  className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-7 py-3 rounded-xl transition shadow-xl shadow-emerald-500/20 text-sm">
                  <BedDouble size={15} />
                  {t.bookRoom}
                </Link>
                <a href="#features" className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm font-medium transition">
                  {t.seeFeatures}
                  {isRTL ? <ChevronRight size={13} className="rotate-180" /> : <ChevronRight size={13} />}
                </a>
              </div>
            </div>

            {/* ── Mockup (desktop only) ── */}
            <div key={`mock-${slideIdx}`} className="relative hidden lg:block"
                 style={{ animation: 'slideLeft 0.75s ease forwards' }}>
              <div className="absolute inset-0 bg-blue-500/8 blur-3xl rounded-3xl" />
              <div className="relative float-card">
                {slide.mockup === 'dashboard' && (
                  <>
                    <DashboardMockup />
                    <div className="absolute -end-5 -bottom-8 shadow-2xl float-card-delay">
                      <RoomControlCard />
                    </div>
                  </>
                )}
                {slide.mockup === 'guest' && (
                  <div className="flex justify-center">
                    <GuestPortalMockup />
                  </div>
                )}
                {slide.mockup === 'pms' && <PMSMockup />}
              </div>
            </div>
          </div>

          {/* ── Slide controls ── */}
          <div className="mt-14 flex items-center gap-5">
            {/* Dot indicators */}
            <div className="flex items-center gap-2">
              {slides.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setSlideIdx(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={`rounded-full transition-all duration-300 ${
                    i === slideIdx
                      ? `w-6 h-2 ${s.dot}`
                      : 'w-2 h-2 bg-white/20 hover:bg-white/45'
                  }`}
                />
              ))}
            </div>
            {/* Progress bar */}
            <div className="flex-1 h-px bg-white/10 rounded-full overflow-hidden">
              <div
                key={`prog-${slideIdx}`}
                className="h-full bg-white/35 rounded-full"
                style={{ animation: 'progressBar 5s linear forwards' }}
              />
            </div>
            {/* Slide counter */}
            <span
              key={`cnt-${slideIdx}`}
              className="text-[11px] text-white/25 font-mono tabular-nums"
              style={{ animation: 'fadeIn 0.5s ease forwards' }}
            >
              {String(slideIdx + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
            </span>
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
          <div className="text-center mb-16 reveal">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">{t.featuresTag}</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">{t.featuresTitle}</h2>
            <p className="text-gray-400 text-sm max-w-lg mx-auto">{t.featuresSub}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {t.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              const [bg, ic] = FEATURE_COLORS[i].split(' ');
              return (
                <div key={i} className={`reveal d${i + 1} group p-5 border border-gray-100 rounded-2xl hover:border-blue-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-default bg-white flex flex-col`}>
                  <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200`}>
                    <Icon size={20} className={ic} />
                  </div>
                  <h3 className="font-bold text-gray-800 text-sm mb-2">{f.title}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed flex-1">{f.desc}</p>
                  {f.result && (
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                        <CheckCircle size={10} className="shrink-0" />
                        {f.result}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Impact numbers strip ── */}
      <section className="impact-bg py-20 px-6 relative overflow-hidden">
        {/* Subtle glow overlay */}
        <div className="absolute inset-0 bg-white/3 pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {(isRTL ? [
              { icon: TrendingUp, v: '38%',      l: 'متوسط توفير الطاقة',   sub: 'في أول 3 أشهر'    },
              { icon: Clock,      v: '20 دقيقة', l: 'أسرع في تجهيز الغرف', sub: 'بعد كل مغادرة'    },
              { icon: Users,      v: '4.9★',     l: 'تقييم الضيوف',         sub: 'بعد بوابة QR'     },
              { icon: Zap,        v: '< 1ث',     l: 'وقت الاستجابة',        sub: 'تحديثات لحظية'   },
            ] : [
              { icon: TrendingUp, v: '38%',     l: 'Avg Energy Saved',      sub: 'In first 3 months'  },
              { icon: Clock,      v: '20 min',  l: 'Faster Room Turnover',  sub: 'After each checkout' },
              { icon: Users,      v: '4.9★',    l: 'Guest Satisfaction',    sub: 'After QR portal'     },
              { icon: Zap,        v: '< 1s',    l: 'Response Time',         sub: 'Live IoT updates'    },
            ]).map(({ icon, v, l, sub }) => (
              <AnimatedStat key={l} value={v} label={l} sub={sub} icon={icon} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Showcase ── */}
      <section id="showcase" className="py-24 px-6 bg-slate-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 reveal">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-widest mb-2">{t.platformTag}</p>
            <h2 className="text-3xl font-bold text-white mb-3">{t.platformTitle}</h2>
            <p className="text-white/30 text-sm max-w-lg mx-auto">{t.platformSub}</p>
          </div>
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="reveal-left d1">
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.dashLabel}</p>
              <DashboardMockup />
            </div>
            <div className="reveal d2">
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.pmsLabel}</p>
              <PMSMockup />
            </div>
            <div className="reveal-right d3">
              <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3 font-semibold">{t.guestLabel}</p>
              <div className="flex justify-center"><GuestPortalMockup /></div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-12 reveal">
            {(isRTL
              ? ['تحديث فوري', 'تسجيل دخول QR', 'تقارير الإيرادات', 'إدارة المناوبات', 'أتمتة الطاقة', 'سيناريوهات ذكية', 'عدم الإزعاج / SOS', 'فنادق متعددة', 'تحكم ذكي بالغرف', 'صلاحيات بالأدوار', 'بوابة الضيف']
              : ['Real-time telemetry', 'QR check-in', 'Revenue reports', 'Shift management', 'Energy automation', 'Scene presets', 'DND / SOS', 'Multi-property', 'Smart room control', 'Role-based access', 'Guest portal']
            ).map(pill => (
              <span key={pill} className="text-[11px] text-white/35 bg-white/5 border border-white/8 px-3 py-1 rounded-full hover:text-white/60 hover:bg-white/10 transition-colors duration-200">{pill}</span>
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
      <section className="py-28 px-6 bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 relative overflow-hidden">
        <div className="absolute -top-40 -end-40 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 start-0 w-[400px] h-[400px] bg-indigo-500/8 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-2xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-4 py-1.5 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-white/70 font-medium">{isRTL ? 'جاهز للبدء الفوري' : 'Ready to deploy today'}</span>
          </div>
          <h2 className="text-4xl font-extrabold text-white mb-5 leading-tight">{t.ctaTitle}</h2>
          <p className="text-white/50 text-base leading-relaxed mb-10 max-w-md mx-auto">{t.ctaSub}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <button onClick={() => setShowLogin(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold px-8 py-3.5 rounded-xl text-sm transition shadow-2xl shadow-blue-500/30">
              {t.ctaBtn}
              {isRTL ? <ChevronRight size={16} className="rotate-180" /> : <ArrowRight size={16} />}
            </button>
            <a href="#features"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold px-8 py-3.5 rounded-xl text-sm transition">
              {isRTL ? 'اكتشف المميزات' : 'See all features'}
            </a>
          </div>
          <p className="text-white/25 text-[11px] mt-8">
            {t.sysAdmin}{' '}
            <Link to="/platform/login" className="text-white/40 hover:text-white/70 underline underline-offset-2">{t.platformLogin}</Link>
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
