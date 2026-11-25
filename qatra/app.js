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
    if (chPrev >= 15 || ch >= 20) addNotif('leak-' + cur.month, 'red', t(`استهلاك ${mName(cur.month)} أعلى بـ ${fmt(Math.max(ch, chPrev))}% من المعتاد. ممكن يكون فيه تسريب.`,
      `${mName(cur.month)} use is ${fmt(Math.max(ch, chPrev))}% above usual. There may be a leak.`));
    else if (chPrev <= -5) addNotif('save-' + cur.month, 'green', t(`وفّرت ${fmt(-chPrev)}% في ${mName(cur.month)} (${fmt(pm.use - cur.use)} قالون).`,
      `You saved ${fmt(-chPrev)}% in ${mName(cur.month)} (${fmt(pm.use - cur.use)} gal).`));
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
  const W = 340, H = 200, L = 50, B = 26, T = 14, m = monthly(), cm = curMonth();
  const mine = months.map(k => k < cm && m[k] ? m[k] : null), mid = months.map(k => q(peers(k), .5));
  const lv = months.map((k, i) => mine[i] == null ? null : verdictFor(k, mine[i]).level);
  const max = Math.max(...mid, ...mine.filter(v => v != null)) * 1.15, n = months.length, bw = (W - L - 10) / n;
  const X = i => L + 4 + i * bw + bw / 2, Y = v => T + (H - T - B) * (1 - v / max);
  const COL = { green: '#3FA672', yellow: '#E5B800', red: '#D9534F' };
  const ticks = [0, .25, .5, .75, 1].map(f => max * f);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" dir="ltr" font-family="var(--font)">
   ${ticks.map(v => `<line x1="${L}" x2="${W - 4}" y1="${Y(v)}" y2="${Y(v)}" stroke="#E8EEF4"/><text x="${L - 6}" y="${Y(v) + 3}" font-size="9" text-anchor="end" fill="#6B7F92">${v >= 1000 ? fmt(v / 1000) + 'k' : fmt(v)}</text>`).join('')}
   ${mine.map((v, i) => v == null ? '' : `<rect x="${X(i) - bw * .32}" y="${Y(v)}" width="${bw * .64}" height="${Y(0) - Y(v)}" rx="4" fill="${COL[lv[i]]}"/>`).join('')}
   <path d="M${mid.map((v, i) => `${X(i)},${Y(v)}`).join(' L')}" fill="none" stroke="#14324B" stroke-width="2" stroke-dasharray="5 4"/>
   ${mid.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="2.5" fill="#14324B"/>`).join('')}
   ${months.map((k, i) => i % 2 === (n - 1) % 2 ? `<text x="${X(i)}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#6B7F92">${mName(k)}</text>` : '').join('')}
  </svg>
  <div class="legend"><span><i style="background:#14324B"></i>${t('المعتاد للبيوت المشابهة', 'Typical for similar homes')}</span></div>
  <div class="legend"><span><i style="background:#3FA672;height:10px;width:10px"></i>${t('بيتك: قليل', 'You: low')}</span><span><i style="background:#E5B800;height:10px;width:10px"></i>${t('متوسط', 'average')}</span><span><i style="background:#D9534F;height:10px;width:10px"></i>${t('عالي', 'high')}</span></div>`;
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

function chips(list) { return `<div class="chips">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`; }
function peerChips() {
  const p = S.profile, out = [lbl(TYPES, p.btype), `${p.residents} ${t('سكان', 'residents')}`, `${p.floors} ${t('أدوار', 'floors')}`];
  if (p.garden) out.push(t('حديقة', 'Garden')); if (p.pool) out.push(t('مسبح', 'Pool')); if (p.carWash && +p.cars) out.push(t('غسيل سيارات', 'Car washing'));
  return out;
}
function compare() {
  const fm = fullMonths();
  if (!fm.length) { $('#view').innerHTML = `<div class="card empty"><div class="ico">${ICON.chart}</div><h2>${t('ما فيه بيانات كافية', 'Not enough data yet')}</h2><p class="small muted">${t('سجّل قراءتين بينهم شهر عشان تبدأ المقارنة.', 'Log two readings a month apart to start comparing.')}</p>${demoCard()}</div>`; return; }
  const last = fm[fm.length - 1], v = verdictFor(last.month, last.use), prev = fm[fm.length - 2], ch = prev ? (last.use - prev.use) / prev.use * 100 : null;
  const word = { red: t('عالي', 'High'), yellow: t('متوسط', 'Average'), green: t('قليل', 'Low') }[v.level];
  const yr = fm.slice(-12), tot = yr.reduce((a, x) => a + x.use, 0), top = yr.reduce((a, x) => x.use > a.use ? x : a, yr[0]);
  $('#view').innerHTML = `
  <div class="card"><div class="row between"><h2>${t('مقارنة بالبيوت المشابهة', 'Vs similar homes')}</h2><span class="tag">${t('تجريبي', 'Demo')}</span></div>
   ${chips(peerChips())}
   ${lineChart(lastMonths(12))}
   <div class="verdict ${v.level}"><span class="lamp"></span><div class="grow"><b>${t('استهلاكك', 'Your use')} ${word}</b><div class="tiny">${mName(last.month)}</div></div>
    <div class="pct">${v.diff >= 0 ? '+' : '−'}${fmt(Math.abs(v.diff))}%<div class="tiny">${t('عن المعتاد', 'vs typical')}</div></div></div>
   <div class="kpis"><div><span>${t('بيتك', 'You')}</span><b>${fmt(last.use)}</b></div><div><span>${t('المعتاد', 'Typical')}</span><b>${fmt(v.med)}</b></div><div><span>${t('الفرق', 'Gap')}</span><b>${fmt(last.use - v.med)}</b></div></div>
   <p class="tiny muted center">${t('بالقالون', 'in gallons')}</p></div>
  <div class="card"><h2>${t('شهر بشهر', 'Month by month')}</h2>
   ${fm.length >= 2 ? barChart(fm) : `<p class="small muted">${t('يحتاج شهرين على الأقل.', 'Needs at least two months.')}</p>`}
   ${ch == null ? '' : `<div class="alert ${ch > 0 ? (ch >= 15 ? 'red' : 'amber') : 'green'}" style="margin-top:10px">${ch > 0
     ? t(`زاد ${fmt(ch)}% عن ${mName(prev.month)}${ch >= 15 ? '. ممكن يكون فيه تسريب.' : '.'}`, `Up ${fmt(ch)}% on ${mName(prev.month)}${ch >= 15 ? '. There may be a leak.' : '.'}`)
     : t(`وفّرت ${fmt(-ch)}% عن ${mName(prev.month)}.`, `You saved ${fmt(-ch)}% on ${mName(prev.month)}.`)}</div>`}
   <div class="kpis"><div><span>${t('مجموع السنة', 'Year total')}</span><b>${fmt(tot)}</b></div><div><span>${t('المعدل الشهري', 'Monthly avg')}</span><b>${fmt(tot / yr.length)}</b></div><div><span>${t('أعلى شهر', 'Peak')}</span><b>${mName(top.month)}</b></div></div></div>
  <div class="card"><div class="row between"><h2>${t('أكثر شي يوفر لك', 'Your top savings')}</h2><button class="link" style="margin:0" onclick="go('tips')">${t('الكل', 'All')}</button></div>
   ${topTips(3).map(tipRow).join('')}</div>`;
}

/* ---------------- reading (photo or smart-meter chip) ---------------- */
function reading() {
  const p = S.profile; if (!readMode) readMode = p.chip ? 'chip' : 'photo';
  const seg = `<div class="seg big2" style="margin-bottom:12px">
   <label><input type="radio" name="rm" value="photo" ${readMode === 'photo' ? 'checked' : ''}><span>${t('عداد عادي · تصوير', 'Standard meter · photo')}</span></label>
   <label><input type="radio" name="rm" value="chip" ${readMode === 'chip' ? 'checked' : ''}><span>${t('عداد ذكي · شريحة', 'Smart meter · chip')}</span></label></div>`;
  if (readMode === 'photo') {
    $('#view').innerHTML = seg + `<div class="card"><h2>${t('صوّر العداد', 'Photograph the meter')}</h2>
    <p class="muted small" style="margin-bottom:12px">${t('صوّر أرقام العداد بشكل واضح. القراءة بالقالون.', 'Take a clear photo of the digits. Readings are in gallons.')}</p>
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
    <p class="muted small">${t('القراءة تنسحب من الشريحة مباشرة.', 'The reading comes straight from the chip.')}</p>
    ${editing ? `<form id="cf" novalidate>${field('chip', t('رقم الشريحة الإلكترونية', 'Electronic chip number'), { value: p.chip || '', ph: t('مكتوب على العداد أو بفاتورة الوزارة', 'Printed on the meter or on your MEW bill'), attrs: 'dir="ltr" autocapitalize="characters"' })}
      <button class="btn" style="margin-top:12px">${t('احفظ رقم الشريحة', 'Save chip number')}</button>
      ${p.chip ? `<button type="button" class="link" onclick="reading.editChip=false;render()">${t('إلغاء', 'Cancel')}</button>` : ''}</form>`
    : `<div class="tierrow" style="margin-top:10px"><span>${t('رقم الشريحة', 'Chip number')}</span><b dir="ltr">${esc(p.chip)}</b></div>
      <button class="btn" id="pull" style="margin-top:12px">${t('اسحب القراءة من الشريحة', 'Get reading from chip')}</button>
      <button class="link" onclick="reading.editChip=true;render()">${t('تغيير رقم الشريحة', 'Change chip number')}</button>
      <p class="tiny muted" style="margin-top:8px">${t('تجريبي: القراءة محاكاة.', 'Demo: reading is simulated.')}</p>`}
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
const ICON = {
  drop: '<path d="M12 3c-3 4.5-6 7.5-6 11a6 6 0 0 0 12 0c0-3.5-3-6.5-6-11z"/>',
  shower: '<path d="M4 20V8a4 4 0 0 1 8 0"/><path d="M9 8h6"/><path d="M11 12v1M14 12v1M17 12v1M12.5 15v1M15.5 15v1"/>',
  tap: '<path d="M4 10h10a3 3 0 0 1 3 3v2"/><path d="M8 10V6h4M10 6V4"/><path d="M17 19v1"/>',
  toilet: '<path d="M6 4h8v6H6z"/><path d="M4 10h14a4 4 0 0 1-4 4l1 6H8l1-6a4 4 0 0 1-5-4z"/>',
  leaf: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19l8-8"/>',
  timer: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M10 3h4"/>',
  car: '<path d="M5 16V12l2-5h10l2 5v4"/><path d="M3 16h18"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  wrench: '<path d="M14 6a4 4 0 0 0 5 5l-8 8a2 2 0 0 1-3-3l8-8a4 4 0 0 0-2-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'
};
for (const k in ICON) ICON[k] = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
function tipList() {
  const p = S.profile, n = p.residents, Lday = {
    toilet: n * USE.flushes * USE.flushL, faucet: n * USE.faucetL, shower: n * USE.showerMin * USE.showerLpm,
    garden: p.garden ? (p.irrArea || 0) * USE.gardenLm2 : 0, car: p.carWash ? (p.cars || 0) * 4 * USE.washHoseL / 30 : 0
  };
  const T = [
    { id: 'pressure', cat: 'dev', icon: 'toilet', cost: 'high', on: true, base: 'toilet', pct: 50, pctLabel: '50%',
      t: t('سيفون بضغط الهوا', 'Pressure-assisted toilet'), s: t('أغلى، بس يقص ماي السيفون للنص.', 'Pricier, but halves toilet water.'),
      cmp: [[t('العادي', 'Standard'), t('٦ لتر', '6 L')], [t('بضغط الهوا', 'Pressure-assisted'), t('~٣ لتر', '~3 L')]], src: 'pressure' },
    { id: 'sensor', cat: 'dev', icon: 'tap', cost: 'high', on: true, base: 'faucet', pct: 32, pctLabel: '32–54%',
      t: t('حنفية سنسر + مرشد تدفق', 'Sensor tap + low-flow aerator'), s: t('تسكر الماي أول ما تشيل يدك.', 'Stops as soon as your hands move away.'),
      note: t('بدون مرشد تدفق قليل ممكن تزيد الاستهلاك.', 'Without a low-flow aerator it can increase use.'), src: 'sensor' },
    { id: 'aerator', cat: 'dev', icon: 'tap', cost: 'low', on: true, base: 'faucet', pct: 30, pctLabel: '30%',
      t: t('مرشد الحنفية (Aerator)', 'Tap aerator'), s: t('قطعة رخيصة تخلط الهوا بالماي.', 'A cheap part that mixes air into the flow.'), src: 'epaFaucet' },
    { id: 'shower', cat: 'dev', icon: 'shower', cost: 'low', on: true, base: 'shower', pct: 20, pctLabel: '20%+',
      t: t('دش موفر', 'Water-saving showerhead'), s: t('نفس القوة بماي أقل.', 'Same spray, less water.'), src: 'epaShower' },
    { id: 'shorter', cat: 'hab', icon: 'timer', cost: 'free', on: true, base: 'shower', pct: 37.5, pctLabel: '37%',
      t: t('شاور ٥ دقايق بدال ٨', '5-minute showers instead of 8'), s: t('كل دقيقة ≈ ٩.٥ لتر.', 'Each minute ≈ 9.5 L.') },
    { id: 'bag', cat: 'dev', icon: 'toilet', cost: 'free', on: true, base: 'toilet', pct: 16, pctLabel: '16%',
      t: t('قنينة داخل خزان السيفون', 'Bottle in the cistern'), s: t('توفر لتر بكل سحبة.', 'Saves 1 L every flush.') },
    { id: 'leak', cat: 'hab', icon: 'wrench', cost: 'low', on: true, base: 'leak', pct: null, pctLabel: t('حتى 10%', 'up to 10%'),
      t: t('صلّح أي تسريب', 'Fix any leak'), s: t('التسريب الصغير يهدر وايد مع الوقت.', 'Small leaks waste a lot over time.'), src: 'epaLeak' },
    { id: 'drip', cat: 'gar', icon: 'leaf', cost: 'mid', on: !!p.garden, base: 'garden', pct: 20, pctLabel: '20–50%',
      t: t('ري بالتنقيط', 'Drip irrigation'), s: t('الماي يوصل للجذور مباشرة.', 'Water goes straight to the roots.'), src: 'epaIrr' },
    { id: 'ctrl', cat: 'gar', icon: 'timer', cost: 'mid', on: !!p.garden, base: 'garden', pct: 30, pctLabel: t('حتى 30%', 'up to 30%'),
      t: t('مؤقت ري ذكي', 'Smart irrigation timer'), s: t('يسقي حسب الطقس.', 'Waters by the weather.'), src: 'epaCtrl' },
    { id: 'car', cat: 'hab', icon: 'car', cost: 'free', on: !!(p.carWash && p.cars), base: 'car', pct: 87, pctLabel: '87%',
      t: t('غسيل السيارة بالسطل', 'Wash the car with a bucket'), s: t('٢٠ لتر بدال ١٥٠ لتر بالهوز.', '20 L instead of 150 L with a hose.') }
  ];
  const curUse = (() => { const fm = fullMonths(); return fm.length ? fm[fm.length - 1].use : expectedMonth(p, new Date().getMonth()); })();
  const rate = marginalRate(curUse);
  return T.filter(x => x.on).map(x => {
    const lday = x.base === 'leak' ? 180 * 3.785 / 7 : Lday[x.base] * x.pct / 100, galMonth = lday * 30 / GAL;
    return { ...x, galMonth, kdMonth: galMonth / 1000 * rate };
  }).sort((a, b) => b.galMonth - a.galMonth);
}
function topTips(n) { return tipList().slice(0, n); }
const COST = () => ({ free: t('مجاني', 'Free'), low: t('رخيص', 'Low cost'), mid: t('متوسط', 'Medium'), high: t('أغلى · يوفر على المدى البعيد', 'Pricier · pays back') });
function tipRow(x) {
  return `<details class="tipc"><summary><span class="ico">${ICON[x.icon]}</span><span class="grow"><b>${x.t}</b><small>~${fmt(x.galMonth)}${G} · ${fmt(x.kdMonth, 3)} ${t('د.ك', 'KD')} ${t('بالشهر', '/mo')}</small></span><span class="pctb">${x.pctLabel}</span></summary>
   <div class="more"><p>${x.s}</p>${x.note ? `<p class="warn">${x.note}</p>` : ''}
   ${x.cmp ? `<div class="cmp">${x.cmp.map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('')}</div>` : ''}
   <div class="row between tiny muted" style="margin-top:8px"><span>${COST()[x.cost]}</span>${x.src ? `<a href="${SRC[x.src][1]}" target="_blank" rel="noopener">${t('المصدر', 'Source')}</a>` : `<span>${t('محسوبة', 'Calculated')}</span>`}</div></div></details>`;
}
let tipFilter = 'all';
function tips() {
  const fm = fullMonths(), last = fm[fm.length - 1], use = last ? last.use : 0, max = 60000, pos = Math.min(100, use / max * 100);
  const cats = [['all', t('الكل', 'All')], ['dev', t('أجهزة', 'Devices')], ['hab', t('عادات', 'Habits')], ['gar', t('الحديقة', 'Garden')]].filter(([k]) => k !== 'gar' || S.profile.garden);
  const list = tipList().filter(x => tipFilter === 'all' || x.cat === tipFilter), total = tipList().reduce((a, x) => a + x.galMonth, 0);
  $('#view').innerHTML = `
  <div class="card"><div class="row between"><h2>${t('التعرفة المقترحة', 'Proposed tariff')}</h2><span class="tag">${t('دراسة مستقبلية', 'Future study')}</span></div>
   <div class="tierbar" dir="ltr"><i style="width:50%"></i><i style="width:25%"></i><i style="width:25%"></i>${last ? `<em style="left:${pos}%"></em>` : ''}</div>
   <div class="tierlbl" dir="ltr"><span>0</span><span style="left:50%">30k</span><span style="left:75%">45k</span><span style="right:0">60k</span></div>
   <div class="tiers3" dir="ltr">${TIERS.slice(0, 3).map((tr, i) => `<div class="${last && Math.min(2, tierOf(use)) === i ? 'on' : ''}"><b>${tr.rate.toFixed(3)}</b><span>${t('د.ك / ١٠٠٠ قالون', 'KD / 1,000 gal')}</span></div>`).join('')}</div>
   ${last ? `<div class="kpis"><div><span>${mName(last.month)}</span><b>${fmt(use)}</b></div><div><span>${t('الفاتورة', 'Bill')}</span><b>${fmt(bill(use), 3)}</b></div><div><span>${t('للشريحة الجاية', 'To next tier')}</span><b>${use < 60000 ? fmt(TIERS[tierOf(use)].to - use) : '—'}</b></div></div>` : ''}</div>
  <div class="card"><div class="row between"><h2>${t('نصايح التوفير', 'Saving tips')}</h2><span class="tiny muted">${t('توفير يوصل', 'up to')} ~${fmt(total)}${G}/${t('شهر', 'mo')}</span></div>
   <div class="filters">${cats.map(([k, l]) => `<button class="${tipFilter === k ? 'on' : ''}" onclick="tipFilter='${k}';tips()">${l}</button>`).join('')}</div>
   ${list.map(tipRow).join('')}
   <details class="how"><summary>${t('شلون حسبنا التوفير؟', 'How we calculate savings')}</summary><p class="tiny muted">${t(`للشخص باليوم: ${USE.flushes} سحبات × ${USE.flushL} لتر، ${USE.faucetL} لتر مغاسل، شاور ${USE.showerMin} دقايق × ${USE.showerLpm} لتر، الحديقة ${USE.gardenLm2} لتر/م². القالون = ${GAL} لتر.`, `Per person per day: ${USE.flushes} flushes × ${USE.flushL} L, ${USE.faucetL} L at sinks, ${USE.showerMin}-min shower × ${USE.showerLpm} L, garden ${USE.gardenLm2} L/m². 1 gal = ${GAL} L.`)}</p></details></div>`;
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
