/* Qatra — app screens (shared by ar.html and en.html). Units: Kuwait (imperial) gallons. */
const GAL = 4.546; // litres per imperial gallon
const DEFAULT = { profile: null, readings: [], notifs: [], notifSeen: 0 };
let S = JSON.parse(JSON.stringify(DEFAULT));
let view = 'home', readMode = null;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
const MONTHS = t(['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const mName = ym => MONTHS[+ym.slice(5, 7) - 1];
const G = t(' قالون', ' gal');

/* ---------------- tariff (Ministry of Electricity and Water, per 1,000 gallons) ---------------- */
const TIERS = [
  { from: 0, to: 30000, rate: 0.850 },
  { from: 30000, to: 45000, rate: 1.700 },
  { from: 45000, to: 60000, rate: 2.550 },
  { from: 60000, to: null, rate: 2.550 } // above 60,000: rate not given — kept at the last known rate
];
function bill(gal) {
  let total = 0;
  for (const tr of TIERS) { const top = tr.to ?? Infinity; const band = Math.max(0, Math.min(gal, top) - tr.from); total += band / 1000 * tr.rate; }
  return total;
}
const tierOf = gal => TIERS.findIndex(tr => gal < (tr.to ?? Infinity));
const marginalRate = gal => TIERS[Math.max(0, tierOf(gal))].rate;

/* ---------------- readings → monthly use ---------------- */
function sorted() { return [...S.readings].sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value); }
function monthly() { // spreads each period's use across the days it covers
  const r = sorted(), m = {};
  for (let i = 1; i < r.length; i++) {
    const use = r[i].value - r[i - 1].value, d0 = new Date(r[i - 1].date + 'T00:00'), n = days(r[i - 1].date, r[i].date);
    if (use < 0) continue;
    for (let k = 0; k < n; k++) { const d = new Date(d0); d.setDate(d.getDate() + k); const key = d.toISOString().slice(0, 7); m[key] = (m[key] || 0) + use / n; }
  }
  return m;
}
function lastMonths(n) { const out = [], d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setMonth(d.getMonth() - i); out.push(x.toISOString().slice(0, 7)); } return out; }
const curMonth = () => today().slice(0, 7);
function fullMonths() { const m = monthly(), cm = curMonth(); return Object.keys(m).filter(k => k < cm).sort().map(k => ({ month: k, use: m[k] })); }

/* ---------------- similar homes (SIMULATED until real MEW data is connected) ---------------- */
const SEASON = [0.85, 0.85, 0.9, 1.0, 1.1, 1.25, 1.3, 1.3, 1.2, 1.05, 0.9, 0.85];
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function peerKey(p) { return [p.btype, Math.min(p.residents, 14), Math.min(4, p.floors), p.garden ? 'g' : '', p.pool ? 'p' : '', p.carWash ? 'c' : ''].join('|'); }
function expectedMonth(p, mi, res) {
  const r = res ?? p.residents;
  let g = r * 2400 * (1 + 0.05 * (Math.min(4, p.floors) - 1));
  if (p.garden) g += (p.irrArea || 50) * 5 * 30 / GAL;
  if (p.pool) g += 1500;
  if (p.carWash) g += (p.cars || 0) * 4 * 150 / GAL;
  return g * SEASON[mi];
}
function peers(month) {
  const p = S.profile, mi = +month.slice(5, 7) - 1, R = rng(hashStr(peerKey(p) + month)), out = [];
  for (let i = 0; i < 40; i++) {
    const res = Math.max(1, p.residents + Math.round(R() * 2 - 1));
    const z = Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(2 * Math.PI * R());
    out.push(expectedMonth(p, mi, res) * Math.exp(0.22 * z));
  }
  return out.sort((a, b) => a - b);
}
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
function peerDesc() {
  const p = S.profile, yn = (v, a, b) => v ? a : b;
  return [lbl(TYPES, p.btype), `${p.residents} ${t('سكان (±١)', 'residents (±1)')}`, `${p.floors} ${t('أدوار', 'floors')}`,
    yn(p.garden, t('فيه حديقة', 'with garden'), t('بدون حديقة', 'no garden')), yn(p.pool, t('فيه مسبح', 'with pool'), t('بدون مسبح', 'no pool')),
    ...(+p.cars > 0 ? [yn(p.carWash, t('غسيل سيارات بالبيت', 'cars washed at home'), t('بدون غسيل سيارات', 'no car washing'))] : [])].join(' · ');
}
function verdictFor(month, use) {
  const ps = peers(month), p25 = q(ps, .25), p75 = q(ps, .75), med = q(ps, .5);
  const level = use > p75 ? 'red' : use < p25 ? 'green' : 'yellow';
  return { level, med, p25, p75, diff: (use - med) / med * 100 };
}

/* ---------------- notifications ---------------- */
function addNotif(key, kind, text) {
  if (S.notifs.some(n => n.key === key)) return;
  S.notifs.unshift({ key, kind, text, at: Date.now() }); S.notifs = S.notifs.slice(0, 30); save();
  if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker)
    navigator.serviceWorker.ready.then(r => r.showNotification(t('قطرة', 'Qatra'), { body: text, icon: 'icon.png', tag: key })).catch(() => {});
}
function checkNotifs() {
  const fm = fullMonths(); if (fm.length < 2) return;
  for (let i = Math.max(1, fm.length - 2); i < fm.length; i++) {
    const cur = fm[i], prev = fm.slice(Math.max(0, i - 3), i), avg = prev.reduce((s, x) => s + x.use, 0) / prev.length, ch = (cur.use - avg) / avg * 100;
    const pm = fm[i - 1], chPrev = (cur.use - pm.use) / pm.use * 100;
    if (chPrev >= 15 || ch >= 20) addNotif('leak-' + cur.month, 'red', t(`استهلاك ${mName(cur.month)} أعلى بـ ${fmt(Math.max(ch, chPrev))}% من ${chPrev >= ch ? 'الشهر اللي قبله' : 'معدلك'}. ممكن يكون فيه تسريب بالبيت، افحص السيفونات والحنفيات والتانكي.`,
      `${mName(cur.month)} use is ${fmt(Math.max(ch, chPrev))}% above ${chPrev >= ch ? 'the previous month' : 'your average'}. There may be a leak: check toilets, taps and the roof tank.`));
    else if (chPrev <= -5) addNotif('save-' + cur.month, 'green', t(`أحسنت! وفّرت ${fmt(-chPrev)}% في ${mName(cur.month)} مقارنة بـ ${mName(pm.month)} (${fmt(pm.use - cur.use)} قالون).`,
      `Well done! You saved ${fmt(-chPrev)}% in ${mName(cur.month)} compared with ${mName(pm.month)} (${fmt(pm.use - cur.use)} gal).`));
  }
}
function updateBell() { const n = S.notifs.filter(x => x.at > (S.notifSeen || 0)).length, b = $('#bell b'); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; } }
function openNotifs() {
  S.notifSeen = Date.now(); save(); updateBell();
  const m = $('#modal');
  m.innerHTML = `<div class="card"><div class="row between"><h2>${t('الإشعارات', 'Notifications')}</h2><button class="link" style="margin:0" id="cl">${t('إغلاق', 'Close')}</button></div>
   ${S.notifs.length ? S.notifs.map(n => `<div class="notif"><span class="dot" style="width:9px;height:9px;margin-inline-end:6px;background:var(--${n.kind === 'red' ? 'red' : 'green'})"></span>${esc(n.text)}<div class="tiny muted">${new Date(n.at).toLocaleDateString(t('ar-KW-u-nu-latn', 'en-GB'))}</div></div>`).join('') : `<p class="small muted">${t('ما فيه إشعارات للحين.', 'No notifications yet.')}</p>`}</div>`;
  m.classList.remove('hide'); $('#cl').onclick = () => m.classList.add('hide'); m.onclick = e => { if (e.target === m) m.classList.add('hide'); };
}
async function enablePush() {
  if (!('Notification' in window) || !navigator.serviceWorker) { toast(t('جوالك ما يدعم الإشعارات هنا. بالآيفون: أضف البرنامج للشاشة الرئيسية أول.', 'Notifications are not supported here. On iPhone, add the app to your Home Screen first.')); return; }
  try { await navigator.serviceWorker.register('sw.js'); const p = await Notification.requestPermission();
    toast(p === 'granted' ? t('تم تفعيل الإشعارات', 'Notifications enabled') : t('ما تم التفعيل', 'Not enabled'));
  } catch (e) { toast(t('ما قدرنا نفعّل الإشعارات', 'Could not enable notifications')); }
}

/* ---------------- charts ---------------- */
function lineChart(months) {
  const W = 340, H = 190, L = 44, B = 26, T = 12, m = monthly(), cm = curMonth();
  const mine = months.map(k => k < cm && m[k] ? m[k] : null);
  const ps = months.map(k => peers(k)), lo = ps.map(a => q(a, .25)), mid = ps.map(a => q(a, .5)), hi = ps.map(a => q(a, .75));
  const max = Math.max(...hi, ...mine.filter(v => v != null)) * 1.12;
  const X = i => L + i * (W - L - 8) / (months.length - 1), Y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, .25, .5, .75, 1].map(f => max * f);
  const band = `M${hi.map((v, i) => `${X(i)},${Y(v)}`).join(' L')} L${lo.map((v, i) => `${X(i)},${Y(v)}`).reverse().join(' L')} Z`;
  let path = '', pen = false; mine.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${X(i)},${Y(v)} `; pen = true; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" dir="ltr" font-family="var(--font)">
   ${ticks.map(v => `<line x1="${L}" x2="${W - 4}" y1="${Y(v)}" y2="${Y(v)}" stroke="#E8EEF4"/><text x="${L - 6}" y="${Y(v) + 3}" font-size="9" text-anchor="end" fill="#6B7F92">${v >= 1000 ? fmt(v / 1000) + 'k' : fmt(v)}</text>`).join('')}
   <path d="${band}" fill="#9DBAEB" opacity=".35"/>
   <path d="M${mid.map((v, i) => `${X(i)},${Y(v)}`).join(' L')}" fill="none" stroke="#6B7F92" stroke-width="2" stroke-dasharray="5 4"/>
   <path d="${path}" fill="none" stroke="#2F6FDB" stroke-width="3" stroke-linejoin="round"/>
   ${mine.map((v, i) => v == null ? '' : `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="#2F6FDB"/>`).join('')}
   ${months.map((k, i) => i % 2 === (months.length - 1) % 2 ? `<text x="${X(i)}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#6B7F92">${mName(k)}</text>` : '').join('')}
  </svg>
  <div class="legend"><span><i style="background:#2F6FDB"></i>${t('بيتك', 'Your home')}</span><span><i style="background:#6B7F92"></i>${t('متوسط البيوت المشابهة', 'Similar homes (median)')}</span><span><i style="background:#9DBAEB;height:10px"></i>${t('المعدل الطبيعي', 'Normal range')}</span></div>`;
}
function barChart(fm) {
  const d = fm.slice(-12), W = 340, H = 180, L = 6, B = 24, T = 22, max = Math.max(...d.map(x => x.use)) * 1.1, bw = (W - L) / d.length;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" dir="ltr" font-family="var(--font)">${d.map((x, i) => {
    const h = Math.max(2, x.use / max * (H - T - B)), prev = d[i - 1], ch = prev ? (x.use - prev.use) / prev.use * 100 : null;
    const col = ch == null ? '#9DBAEB' : ch > 0 ? '#D9534F' : '#3FA672';
    return `<rect x="${L + i * bw + bw * .18}" y="${H - B - h}" width="${bw * .64}" height="${h}" rx="5" fill="${col}"/>
     ${ch == null ? '' : `<text x="${L + i * bw + bw / 2}" y="${H - B - h - 5}" font-size="8.5" text-anchor="middle" fill="${col}" font-weight="600">${ch > 0 ? '+' : ''}${fmt(ch)}%</text>`}
     ${(d.length - 1 - i) % 2 === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#6B7F92">${mName(x.month)}</text>` : ''}`;
  }).join('')}</svg>
  <div class="legend"><span><i style="background:#3FA672;height:10px"></i>${t('أقل من الشهر اللي قبله (وفّرت)', 'Less than previous month (saved)')}</span><span><i style="background:#D9534F;height:10px"></i>${t('أكثر من الشهر اللي قبله', 'More than previous month')}</span></div>`;
}

/* ---------------- screens ---------------- */
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  if ((!CU || !S.profile) && view !== 'settings') view = 'settings';
  ({ home, compare, reading, tips, settings, history })[view]();
  updateBell(); window.scrollTo(0, 0);
}
function go(v) { view = v; render(); }

function demoCard() { return `<button class="btn ghost" style="margin-top:4px" onclick="loadDemo()">${t('جرّب ببيانات تجريبية', 'Try with demo data')}</button>`; }

function home() {
  const fm = fullMonths(), last = fm[fm.length - 1], m = monthly(), cur = m[curMonth()] || 0, r = sorted();
  $('#view').innerHTML = `
  <p class="muted small" style="margin-bottom:8px">${t('مرحباً', 'Hello')}، ${esc(CU.name.split(' ')[0])}</p>
  ${!r.length ? `<div class="alert blue"><b>${t('أول خطوة:', 'First step:')}</b> ${t('سجّل قراءة العداد من خانة القراءة.', 'log your meter reading from the Reading tab.')}</div>` : ''}
  ${S.notifs[0] ? `<div class="alert ${S.notifs[0].kind === 'red' ? 'red' : 'green'}">${esc(S.notifs[0].text)}</div>` : ''}
  <div class="card"><h2>${t('هذا الشهر', 'This month')}</h2><div class="grid2">
   <div class="stat"><div class="tiny muted">${t('الاستهلاك لين الحين', 'Used so far')}</div><div class="big">${fmt(cur)}<span class="small">${G}</span></div></div>
   <div class="stat"><div class="tiny muted">${t('الشهر الماضي', 'Last month')}</div><div class="big">${last ? fmt(last.use) : '–'}<span class="small">${G}</span></div>${last ? `<div class="tiny muted">${fmt(bill(last.use), 3)} ${t('د.ك', 'KD')}</div>` : ''}</div></div></div>
  ${fm.length >= 2 ? `<div class="card"><h2>${t('استهلاكك الشهري', 'Your monthly use')}</h2>${barChart(fm)}</div>` : ''}
  <button class="btn pink" onclick="go('reading')">${t('سجّل قراءة', 'Log a reading')}</button>
  <button class="btn ghost" style="margin-top:8px" onclick="go('history')">${t('كل القراءات', 'All readings')}</button>
  ${!r.length ? demoCard() : ''}`;
}

function compare() {
  const fm = fullMonths();
  if (!fm.length) { $('#view').innerHTML = `<div class="card"><h2>${t('المقارنة', 'Compare')}</h2><p class="small muted">${t('سجّل قراءتين على الأقل بينهم شهر عشان نقارن بيتك بالبيوت المشابهة.', 'Log at least two readings a month apart to compare your home with similar homes.')}</p></div>${demoCard()}`; return; }
  const last = fm[fm.length - 1], v = verdictFor(last.month, last.use), months = lastMonths(12);
  const words = { red: [t('استهلاكك عالي', 'Your use is high'), t('أعلى من أغلب البيوت المشابهة لك. شوف نصايح التوفير تحت.', 'Higher than most similar homes. See the saving tips below.')],
    yellow: [t('استهلاكك متوسط', 'Your use is average'), t('ضمن المعدل الطبيعي للبيوت المشابهة لك.', 'Within the normal range for similar homes.')],
    green: [t('استهلاكك قليل', 'Your use is low'), t('أقل من أغلب البيوت المشابهة لك. استمر!', 'Lower than most similar homes. Keep it up!')] }[v.level];
  const prev = fm[fm.length - 2], ch = prev ? (last.use - prev.use) / prev.use * 100 : null;
  $('#view').innerHTML = `
  <div class="card"><h2>${t('بيتك مقارنة بالبيوت المشابهة', 'Your home vs similar homes')}</h2>
   <p class="tiny muted" style="margin-bottom:6px">${t('بيوت مثل بيتك: ', 'Homes like yours: ')}${esc(peerDesc())}</p>
   ${lineChart(months)}
   <div class="verdict ${v.level}"><span class="lamp"></span><div><b>${words[0]}</b> · ${mName(last.month)}<br><span class="small">${words[1]}</span></div></div>
   <div class="cmp"><div>${t('بيتك', 'Your home')}<b>${fmt(last.use)}${G}</b></div><div>${t('البيت المشابه المعتاد', 'Typical similar home')}<b>${fmt(v.med)}${G}</b></div></div>
   <p class="small" style="margin-top:8px">${v.diff >= 0 ? t(`تستهلك أكثر بـ ${fmt(v.diff)}% من البيت المشابه المعتاد.`, `You use ${fmt(v.diff)}% more than a typical similar home.`) : t(`تستهلك أقل بـ ${fmt(-v.diff)}% من البيت المشابه المعتاد.`, `You use ${fmt(-v.diff)}% less than a typical similar home.`)}</p>
   <p class="tiny muted" style="margin-top:6px">${t('بيانات البيوت المشابهة تجريبية (محاكاة) لين يتم ربطها ببيانات الوزارة.', 'Similar-home data is simulated until it is connected to Ministry records.')}</p></div>
  <div class="card"><h2>${t('استهلاك بيتك شهر بشهر', 'Your home month by month')}</h2>
   ${fm.length >= 2 ? barChart(fm) : `<p class="small muted">${t('يحتاج شهرين على الأقل.', 'Needs at least two months.')}</p>`}
   ${ch == null ? '' : `<div class="alert ${ch > 0 ? (ch >= 15 ? 'red' : 'amber') : 'green'}" style="margin-top:10px">${ch > 0
     ? t(`زاد استهلاكك ${fmt(ch)}% في ${mName(last.month)} مقارنة بـ ${mName(prev.month)}.${ch >= 15 ? ' ممكن يكون فيه تسريب بالبيت.' : ''}`, `Your use rose ${fmt(ch)}% in ${mName(last.month)} vs ${mName(prev.month)}.${ch >= 15 ? ' There may be a leak.' : ''}`)
     : t(`وفّرت ${fmt(-ch)}% في ${mName(last.month)} مقارنة بـ ${mName(prev.month)}.`, `You saved ${fmt(-ch)}% in ${mName(last.month)} vs ${mName(prev.month)}.`)}</div>`}</div>
  <div class="card"><h2>${t('شلون تقلل استهلاكك', 'How to use less')}</h2>
   ${topTips(3).map(x => `<div class="tip"><b class="small">${x.t}</b><div class="save"><span>${t('توفير', 'Saves')} ${x.pctLabel}</span><span class="kd">~${fmt(x.galMonth)}${G} ${t('بالشهر', '/month')}</span></div></div>`).join('')}
   <button class="btn sec" style="margin-top:10px" onclick="go('tips')">${t('كل نصايح التوفير', 'All saving tips')}</button></div>`;
}

/* ---------------- reading (photo or smart-meter chip) ---------------- */
function reading() {
  const p = S.profile; if (!readMode) readMode = p.chip ? 'chip' : 'photo';
  const seg = `<div class="seg big2" style="margin-bottom:12px">
   <label><input type="radio" name="rm" value="photo" ${readMode === 'photo' ? 'checked' : ''}><span>${t('عداد عادي · تصوير', 'Standard meter · photo')}</span></label>
   <label><input type="radio" name="rm" value="chip" ${readMode === 'chip' ? 'checked' : ''}><span>${t('عداد ذكي · شريحة', 'Smart meter · chip')}</span></label></div>`;
  if (readMode === 'photo') {
    $('#view').innerHTML = seg + `<div class="card"><h2>${t('صوّر العداد', 'Photograph the meter')}</h2>
    <p class="muted small" style="margin-bottom:12px">${t('للبيوت اللي عدادها بدون شريحة. صوّر أرقام العداد بشكل واضح ومستقيم. القراءة بالقالون.', 'For homes without a chip. Take a clear, straight photo of the digits. Readings are in gallons.')}</p>
    <label class="drop" for="ph"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2F6FDB" stroke-width="1.8"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>
    <div style="font-weight:600;margin-top:6px">${t('صوّر أو ارفع صورة', 'Take or upload a photo')}</div></label>
    <input id="ph" type="file" accept="image/*" capture="environment" class="hide">
    <div id="pv" class="hide" style="margin-top:12px">
     <p class="small" style="margin-bottom:6px"><b>${t('حدد الأرقام:', 'Select the digits:')}</b> ${t('اسحب المربع على أرقام العداد بس.', 'drag the box over the meter digits only.')}</p>
     <div id="cropWrap" style="position:relative;touch-action:none;border-radius:16px;overflow:hidden;background:#1F2A36"><canvas id="cv" style="display:block;width:100%"></canvas>
      <div id="box" style="position:absolute;border:3px solid #F2A7C3;border-radius:8px;box-shadow:0 0 0 2000px rgba(0,0,0,.45)"></div></div>
     <button id="read" class="btn" style="margin-top:12px">${t('اقرأ الأرقام', 'Read digits')}</button>
     <p class="tiny muted" style="margin-top:6px">${t('القراءة تصير على جهازك، والصورة ما تطلع منه.', 'Reading happens on your device; the photo never leaves it.')}</p></div>
    <div id="res"></div></div>
    <button class="btn ghost" onclick="manual()">${t('أدخل القراءة يدوياً', 'Enter the reading manually')}</button>`;
    $('#ph').onchange = async e => { const f = e.target.files[0]; if (!f) return; await loadImg(f); $('#pv').classList.remove('hide'); $('#res').innerHTML = ''; };
    $('#read').onclick = readOCR;
  } else {
    const editing = !p.chip || reading.editChip;
    $('#view').innerHTML = seg + `<div class="card"><h2>${t('العداد الذكي', 'Smart meter')}</h2>
    <p class="muted small">${t('للبيوت الجديدة اللي عدادها فيه شريحة إلكترونية. القراءة تنسحب من الشريحة بدون تصوير.', 'For new homes whose meter has an electronic chip. The reading is pulled from the chip, no photo needed.')}</p>
    ${editing ? `<form id="cf" novalidate>${field('chip', t('رقم الشريحة الإلكترونية', 'Electronic chip number'), { value: p.chip || '', ph: t('مكتوب على العداد أو بفاتورة الوزارة', 'Printed on the meter or on your MEW bill'), attrs: 'dir="ltr" autocapitalize="characters"' })}
      <button class="btn" style="margin-top:12px">${t('احفظ رقم الشريحة', 'Save chip number')}</button>
      ${p.chip ? `<button type="button" class="link" onclick="reading.editChip=false;render()">${t('إلغاء', 'Cancel')}</button>` : ''}</form>`
    : `<div class="tierrow" style="margin-top:10px"><span>${t('رقم الشريحة', 'Chip number')}</span><b dir="ltr">${esc(p.chip)}</b></div>
      <button class="btn" id="pull" style="margin-top:12px">${t('اسحب القراءة من الشريحة', 'Get reading from chip')}</button>
      <button class="link" onclick="reading.editChip=true;render()">${t('تغيير رقم الشريحة', 'Change chip number')}</button>
      <p class="tiny muted" style="margin-top:8px">${t('وضع تجريبي: القراءة محاكاة لين يتم الربط بنظام الوزارة.', 'Demo mode: the reading is simulated until linked to the Ministry system.')}</p>`}
    <div id="res"></div></div>`;
    if (editing) $('#cf').onsubmit = e => {
      e.preventDefault(); clearErrs(); const c = val('chip').toUpperCase().replace(/\s+/g, '');
      if (!c) return setErr('chip', t('اكتب رقم الشريحة', 'Enter the chip number'));
      if (!/^[A-Z0-9-]{6,20}$/.test(c)) return setErr('chip', t('رقم الشريحة لازم من ٦ إلى ٢٠ حرف أو رقم إنجليزي', 'Chip number must be 6–20 English letters or digits'));
      S.profile.chip = c; save(); reading.editChip = false; toast(t('تم حفظ رقم الشريحة', 'Chip number saved')); render();
    };
    else $('#pull').onclick = async () => {
      const b = $('#pull'); busy(b, true); await new Promise(r => setTimeout(r, 700)); busy(b, false);
      const prev = sorted().slice(-1)[0], d = prev ? days(prev.date, today()) : 0;
      const daily = expectedMonth(S.profile, new Date().getMonth()) / 30 * (0.9 + Math.random() * 0.2);
      confirmBox({ reading: Math.round((prev ? prev.value : 48000) + daily * d), source: 'chip' });
    };
  }
  document.querySelectorAll('[name=rm]').forEach(r => r.onchange = () => { readMode = r.value; render(); });
}
function manual() { readMode = 'photo'; view = 'reading'; render(); confirmBox(null, { note: t('اكتب الرقم الظاهر على العداد بالقالون.', 'Type the number shown on the meter, in gallons.') }); }
function confirmBox(v, o = {}) {
  const ok = v && typeof v.reading === 'number' && isFinite(v.reading), prev = sorted().slice(-1)[0], back = ok && prev && v.reading < prev.value;
  const src = v && v.source === 'chip' ? 'chip' : ok ? 'photo' : 'manual';
  $('#res').innerHTML = `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
  ${ok ? `<div class="tiny muted">${src === 'chip' ? t('قراءة الشريحة', 'Chip reading') : t('القراءة', 'Reading')}</div><div class="digits">${fmt(v.reading)} <span class="small">${t('قالون', 'gal')}</span></div>
   ${v.digits_seen ? `<div class="tiny muted">${t('الأرقام المقروءة', 'Digits seen')}: ${esc(v.digits_seen)} · ${t('الثقة', 'confidence')} ${fmt((v.confidence || 0) * 100)}%</div>` : ''}` : ''}
  ${back ? `<div class="alert amber" style="margin-top:10px">${t('هذي القراءة أقل من آخر قراءة. تأكد من الرقم.', 'This is lower than your last reading. Please check the number.')}</div>` : ''}
  ${!ok ? `<div class="alert blue">${esc(o.note || t('ما قدرنا نقرأ الأرقام.', 'Could not read the digits.'))}</div>` : ''}
  <label>${t('أكّد القراءة أو عدّلها (قالون)', 'Confirm or correct the reading (gallons)')}</label><input id="valIn" type="number" step="1" inputmode="numeric" value="${ok ? v.reading : ''}">
  <div class="err" id="e_valIn"></div>
  <label>${t('التاريخ', 'Date')}</label><input id="dt" type="date" value="${today()}" max="${today()}">
  <button class="btn" style="margin-top:12px" id="sv">${t('احفظ القراءة', 'Save reading')}</button></div>`;
  $('#sv').onclick = () => {
    const x = parseFloat($('#valIn').value); if (!(x >= 0)) { $('#e_valIn').textContent = t('اكتب القراءة', 'Enter the reading'); return; }
    S.readings.push({ id: Math.random().toString(36).slice(2, 9), date: $('#dt').value || today(), value: Math.round(x), source: src, auto: ok ? v.reading : null });
    save(); checkNotifs(); toast(t('تم حفظ القراءة', 'Reading saved')); go('home');
  };
}

/* ---------------- وفّر / Save tab ---------------- */
// Per-person daily assumptions used to turn a % saving into gallons for this home (labelled in the app).
const USE = { flushes: 5, flushL: 6, faucetL: 30, showerMin: 8, showerLpm: 9.5, gardenLm2: 5, washHoseL: 150, washBucketL: 20 };
const SRC = {
  epaFaucet: ['EPA WaterSense', 'https://www.epa.gov/watersense/statistics-and-facts'],
  epaShower: ['EPA WaterSense', 'https://www.epa.gov/watersense/statistics-and-facts'],
  epaLeak: ['EPA WaterSense – Fix a Leak', 'https://www.epa.gov/watersense/fixaleak/'],
  epaIrr: ['EPA WaterSense at Work', 'https://19january2017snapshot.epa.gov/www3/watersense/commercial/docs/watersense_at_work/files/assets/basic-html/page162.html'],
  epaCtrl: ['EPA WaterSense', 'https://www.epa.gov/watersense/statistics-and-facts'],
  pressure: ['Bob Vila – Low-flush toilets', 'https://www.bobvila.com/articles/low-flush-toilets.md'],
  sensor: ['Sacramento State study (2016) / Alliance for Water Efficiency', 'https://www.csus.edu/experience/innovation-creativity/sustainability/_internal/_documents/ir-faucet.pdf']
};
function tipList() {
  const p = S.profile, n = p.residents, Lday = {
    toilet: n * USE.flushes * USE.flushL, faucet: n * USE.faucetL, shower: n * USE.showerMin * USE.showerLpm,
    garden: p.garden ? (p.irrArea || 0) * USE.gardenLm2 : 0, car: p.carWash ? (p.cars || 0) * 4 * USE.washHoseL / 30 : 0
  };
  const T = [
    { id: 'pressure', cat: t('أجهزة', 'Devices'), cost: 'high', on: true, base: 'toilet', pct: 50, pctLabel: '50%',
      t: t('سيفون بضغط الهوا (Pressure-assisted)', 'Pressure-assisted toilet'),
      d: t('السيفون العادي الحديث يصرف تقريباً ٦ لتر بالسحبة. السيفون اللي يشتغل بضغط الهوا يدفع الماي بقوة أكبر، وبعض موديلاته تصرف بحدود ٣ لتر بس (0.8 قالون أمريكي). صح إنه أغلى ويحتاج تبديل الكرسي كامل، بس يوفر نص ماي السيفون كل شهر.',
        'A modern standard toilet uses about 6 L per flush. Pressure-assisted toilets push water with air pressure; some models use only about 3 L (0.8 US gal). It costs more and needs a full replacement, but it halves toilet water every month.'),
      cmp: [[t('السيفون العادي', 'Standard'), t('٦ لتر', '6 L')], [t('بضغط الهوا', 'Pressure-assisted'), t('~٣ لتر', '~3 L')]], src: 'pressure' },
    { id: 'sensor', cat: t('أجهزة', 'Devices'), cost: 'high', on: true, base: 'faucet', pct: 32, pctLabel: t('حتى 32–54%', 'up to 32–54%'),
      t: t('حنفية سنسر مع مرشد تدفق قليل', 'Sensor tap with a low-flow aerator'),
      d: t('الحنفية السنسر أغلى من العادية، بس تسكر الماي أول ما تشيل يدك. دراسة جامعة ساكرامنتو (2016) لقت توفير 32% مع مرشد 0.5 قالون/دقيقة و54% مع 0.35. تنبيه: دراسات ثانية لقت إن السنسر بدون مرشد ممكن يزيد الاستهلاك لأنه يشتغل بروحه، فلازم يكون معاه مرشد تدفق قليل.',
        'Sensor taps cost more but stop the flow as soon as your hands move away. A Sacramento State study (2016) found 32% savings with a 0.5 gpm aerator and 54% with 0.35 gpm. Note: other studies found sensor taps without a low-flow aerator can increase use, so pair it with one.'),
      src: 'sensor' },
    { id: 'aerator', cat: t('أجهزة', 'Devices'), cost: 'low', on: true, base: 'faucet', pct: 30, pctLabel: '30%',
      t: t('مرشد الحنفيات (Aerator)', 'Tap aerators'), d: t('قطعة رخيصة تنركب على الحنفية وتخلط الهوا بالماي. حسب برنامج WaterSense تقلل ماي المغاسل 30% بدون ما تحس بفرق.', 'A cheap screw-on part that mixes air into the stream. WaterSense says it cuts sink water use by 30% with no noticeable difference.'), src: 'epaFaucet' },
    { id: 'shower', cat: t('أجهزة', 'Devices'), cost: 'low', on: true, base: 'shower', pct: 20, pctLabel: t('20% أو أكثر', '20% or more'),
      t: t('دش موفر', 'Water-saving showerhead'), d: t('الدشات المعتمدة من WaterSense تصرف أقل بـ 20% على الأقل من الدش العادي وبنفس القوة.', 'WaterSense-labelled showerheads use at least 20% less water with the same spray.'), src: 'epaShower' },
    { id: 'shorter', cat: t('عادات', 'Habits'), cost: 'free', on: true, base: 'shower', pct: 37.5, pctLabel: '37%',
      t: t('قصّر الشاور من ٨ دقايق إلى ٥', 'Cut showers from 8 to 5 minutes'), d: t('كل دقيقة شاور تصرف تقريباً ٩.٥ لتر. ٣ دقايق أقل = توفير 37% من ماي الشاور.', 'Each shower minute uses about 9.5 L. Three minutes less saves 37% of shower water.'), calc: true },
    { id: 'bag', cat: t('أجهزة', 'Devices'), cost: 'free', on: true, base: 'toilet', pct: 16, pctLabel: '16%',
      t: t('بالون أو قنينة بخزان السيفون', 'Bottle or bag in the cistern'), d: t('قنينة لتر مليانة ماي داخل خزان السيفون تقلل كل سحبة لتر. مع سيفون ٦ لتر هذا توفير تقريباً 16%.', 'A filled 1 L bottle in the cistern saves 1 L per flush, about 16% on a 6 L toilet.'), calc: true },
    { id: 'leak', cat: t('تسريب', 'Leaks'), cost: 'low', on: true, base: 'leak', pct: null, pctLabel: t('حتى 10% من الفاتورة', 'up to 10% of the bill'),
      t: t('افحص السيفون وبدّل السدادة إذا تسرب', 'Check toilets and replace a leaking flapper'),
      d: t('حط صبغة طعام بخزان السيفون وانتظر ١٥ دقيقة بدون سحب. إذا طلع لون بالكرسي، السدادة تسرب. حسب WaterSense تسريبات البيت المعتادة تهدر تقريباً 180 قالون أمريكي بالأسبوع.', 'Add food colouring to the cistern and wait 15 minutes without flushing. Colour in the bowl means the flapper leaks. WaterSense says typical household leaks waste about 180 US gallons a week.'), src: 'epaLeak' },
    { id: 'drip', cat: t('الحديقة', 'Garden'), cost: 'mid', on: !!p.garden, base: 'garden', pct: 20, pctLabel: '20–50%',
      t: t('ري بالتنقيط', 'Drip irrigation'), d: t('يوصل الماي للجذور مباشرة ويقلل التبخر بحر الكويت. يصرف أقل بـ 20 إلى 50% من الرشاشات (حسبنا التوفير على 20%).', 'Delivers water straight to the roots and cuts evaporation. Uses 20–50% less than sprinklers (savings calculated at 20%).'), src: 'epaIrr' },
    { id: 'ctrl', cat: t('الحديقة', 'Garden'), cost: 'mid', on: !!p.garden, base: 'garden', pct: 30, pctLabel: t('حتى 30%', 'up to 30%'),
      t: t('مؤقت ري ذكي', 'Smart irrigation controller'), d: t('يسقي حسب الطقس بدال الساعة الثابتة. حسب WaterSense يقلل ماي الري حتى 30%.', 'Waters by the weather instead of a fixed clock. WaterSense says it cuts irrigation water by up to 30%.'), src: 'epaCtrl' },
    { id: 'car', cat: t('عادات', 'Habits'), cost: 'free', on: !!(p.carWash && p.cars), base: 'car', pct: 87, pctLabel: '87%',
      t: t('اغسل السيارة بالسطل بدال الهوز', 'Wash the car with a bucket, not a hose'), d: t('الهوز المفتوح ١٥ دقيقة يصرف تقريباً ١٥٠ لتر. سطلين (٢٠ لتر) يكفون، يعني توفير تقريباً 87%.', 'A hose running 15 minutes uses about 150 L; two buckets (20 L) are enough, about 87% less.'), calc: true }
  ];
  const curUse = (() => { const fm = fullMonths(); return fm.length ? fm[fm.length - 1].use : expectedMonth(p, new Date().getMonth()); })();
  const rate = marginalRate(curUse);
  return T.filter(x => x.on).map(x => {
    const lday = x.base === 'leak' ? 180 * 3.785 / 7 : Lday[x.base] * x.pct / 100;
    const galMonth = lday * 30 / GAL;
    return { ...x, galMonth, kdMonth: galMonth / 1000 * rate, ofTotal: galMonth / curUse * 100 };
  });
}
function topTips(n) { return tipList().sort((a, b) => b.galMonth - a.galMonth).slice(0, n); }
function tips() {
  const fm = fullMonths(), last = fm[fm.length - 1], use = last ? last.use : 0, ti = last ? tierOf(use) : -1;
  const costL = { free: t('مجاني', 'Free'), low: t('رخيص', 'Low cost'), mid: t('تكلفة متوسطة', 'Medium cost'), high: t('أغلى، بس يوفر على المدى البعيد', 'Pricier, pays back over time') };
  const left = last && ti === 0 ? 30000 - use : null;
  $('#view').innerHTML = `
  <div class="card"><h2>${t('سعر الماي الطبيعي', 'Normal water price')}</h2>
   <p class="small muted">${t('حسب تعرفة وزارة الكهرباء والماء، لكل ١٠٠٠ قالون بالشهر:', 'Ministry of Electricity and Water tariff, per 1,000 gallons a month:')}</p>
   ${TIERS.slice(0, 3).map((tr, i) => `<div class="tierrow ${i === ti || (ti === 3 && i === 2) ? 'on' : ''}"><span>${fmt(tr.from)} – ${fmt(tr.to)}${G}</span><b>${tr.rate.toFixed(3)} ${t('د.ك', 'KD')}</b></div>`).join('')}
   ${last ? `<p class="small" style="margin-top:10px">${t(`استهلاكك في ${mName(last.month)}: <b>${fmt(use)} قالون</b>، وفاتورته التقديرية <b>${fmt(bill(use), 3)} د.ك</b>.`, `Your ${mName(last.month)} use: <b>${fmt(use)} gal</b>, estimated bill <b>${fmt(bill(use), 3)} KD</b>.`)}</p>
    ${left != null ? `<div class="alert green" style="margin-top:8px">${t(`باقي لك ${fmt(left)} قالون قبل ما تدخل الشريحة الثانية (١.٧٠٠ د.ك).`, `${fmt(left)} gallons left before the second tier (1.700 KD).`)}</div>` : `<div class="alert amber" style="margin-top:8px">${t('تعديت السعر الطبيعي. التوفير تحت يرجعك للشريحة الأولى.', 'You are above the normal price. The tips below can bring you back to the first tier.')}</div>`}` : ''}
   <p class="tiny muted" style="margin-top:8px">${t('السعر يزيد مع الاستهلاك عشان يكون فيه عدل بين البيوت: البيت اللي عنده مسبح أو حديقة كبيرة يستهلك أكثر ويدفع أكثر. الحساب بالشرايح: كل جزء من الاستهلاك يتحاسب بسعر شريحته.', 'The price rises with use for fairness: homes with a pool or large garden use more and pay more. Billing is tiered: each part of your use is charged at its own tier price.')}</p></div>
  <div class="card"><h2>${t('نصايح التوفير لبيتك', 'Saving tips for your home')}</h2>
   <p class="tiny muted">${t('مرتبة من الأكثر توفير لبيتك. التوفير بالقالون والدينار محسوب على عدد سكان بيتك وسعر شريحتك.', 'Ordered by how much they save your home. Gallons and KD are calculated for your household size and tier.')}</p>
   ${tipList().sort((a, b) => b.galMonth - a.galMonth).map(x => `<div class="tip">
    <div class="row between"><b class="small">${x.t}</b><span class="tag">${x.cat}</span></div>
    <div class="small muted" style="margin:4px 0">${x.d}</div>
    ${x.cmp ? `<div class="cmp">${x.cmp.map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('')}</div>` : ''}
    <div class="save"><span>${t('نسبة التوفير', 'Saving')}: ${x.pctLabel}</span><span class="kd">~${fmt(x.galMonth)}${G} ${t('بالشهر', '/month')}</span><span class="kd">~${fmt(x.kdMonth, 3)} ${t('د.ك بالشهر', 'KD/month')}</span></div>
    <div class="tiny muted" style="margin-top:4px">${costL[x.cost]}</div>
    ${x.src ? `<div class="src">${t('المصدر', 'Source')}: <a href="${SRC[x.src][1]}" target="_blank" rel="noopener">${SRC[x.src][0]}</a></div>` : `<div class="src">${t('محسوبة من الأرقام المذكورة.', 'Calculated from the figures stated.')}</div>`}
   </div>`).join('')}
   <p class="tiny muted" style="margin-top:10px">${t(`افتراضات الحساب للشخص باليوم: ${USE.flushes} سحبات سيفون × ${USE.flushL} لتر، ${USE.faucetL} لتر مغاسل، شاور ${USE.showerMin} دقايق × ${USE.showerLpm} لتر، والحديقة ${USE.gardenLm2} لتر/م². القالون = ${GAL} لتر.`,
     `Assumptions per person per day: ${USE.flushes} flushes × ${USE.flushL} L, ${USE.faucetL} L at sinks, ${USE.showerMin}-minute shower × ${USE.showerLpm} L, garden ${USE.gardenLm2} L/m². 1 gallon = ${GAL} L.`)}</p></div>`;
}

function history() {
  const r = sorted().reverse();
  $('#view').innerHTML = `<div class="card"><h2>${t('القراءات', 'Readings')}</h2>
  ${r.length ? `<table><tr><th>${t('التاريخ', 'Date')}</th><th>${t('القراءة (قالون)', 'Reading (gal)')}</th><th>${t('المصدر', 'Source')}</th><th></th></tr>${r.map(x => `<tr><td>${x.date}</td><td><b>${fmt(x.value)}</b></td><td class="tiny">${{ chip: t('شريحة', 'Chip'), photo: t('تصوير', 'Photo'), manual: t('يدوي', 'Manual') }[x.source] || t('يدوي', 'Manual')}</td><td><button class="btn ghost" style="padding:4px 8px;width:auto;font-size:12px" onclick="delR('${x.id}')">✕</button></td></tr>`).join('')}</table>` : `<p class="muted small">${t('لا توجد قراءات بعد.', 'No readings yet.')}</p>`}</div>`;
}
function delR(id) { S.readings = S.readings.filter(x => x.id !== id); save(); render(); }

function loadDemo() {
  const p = S.profile, months = lastMonths(13); let v = 48000 + Math.round(Math.random() * 2000);
  const factors = [1.08, 1.12, 1.05, 1.1, 1.06, 1.12, 1.1, 1.08, 1.06, 1.04, 0.95, 1.3];
  const r = [{ id: 'd0', date: months[0] + '-01', value: v, source: 'manual' }];
  for (let i = 1; i < months.length; i++) { const mi = +months[i - 1].slice(5, 7) - 1; v += Math.round(expectedMonth(p, mi) * factors[i - 1]); r.push({ id: 'd' + i, date: months[i] + '-01', value: v, source: p.chip ? 'chip' : 'photo' }); }
  const d = new Date().getDate() - 1; if (d > 0) { v += Math.round(expectedMonth(p, new Date().getMonth()) / 30 * d); r.push({ id: 'dn', date: today(), value: v, source: 'photo' }); }
  S.readings = r; S.notifs = []; S.notifSeen = 0; save(); checkNotifs(); toast(t('تم تحميل البيانات التجريبية', 'Demo data loaded')); go('compare');
}
function toast(m) { const x = document.createElement('div'); x.textContent = m; x.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#14324B;color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;z-index:10;max-width:90%;text-align:center'; document.body.appendChild(x); setTimeout(() => x.remove(), 2600); }
function ask(qs, yes) { const m = $('#modal'); m.innerHTML = `<div class="card"><p style="margin-bottom:14px">${esc(qs)}</p><div class="row"><button class="btn ghost" id="no">${t('إلغاء', 'Cancel')}</button><button class="btn" id="yes" style="background:var(--red)">${t('تأكيد', 'Confirm')}</button></div></div>`; m.classList.remove('hide'); $('#no').onclick = () => m.classList.add('hide'); $('#yes').onclick = () => { m.classList.add('hide'); yes(); }; }

document.querySelectorAll('nav button').forEach(b => b.onclick = () => { if (!CU || !S.profile) { go('settings'); return; } go(b.dataset.v); });
$('#bell').onclick = () => { if (CU) openNotifs(); };
if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) navigator.serviceWorker.register('sw.js').catch(() => {});
loadLocal(); render();
