/* Qatra — shared account, building profile and meter-reading code (used by ar.html and en.html).
   NOTE: `api` below is a LOCAL SIMULATION of a server so the prototype runs on static hosting.
   Replace its functions with real HTTPS calls (e.g. Firebase Auth / your own backend) for production:
   real servers must hash passwords server-side and send verification codes by email/SMS. */
const LANG = document.documentElement.lang === 'ar' ? 'ar' : 'en';
const t = (ar, en) => LANG === 'ar' ? ar : en;
let CU = null; // current user (public fields only)

/* ---------------- storage helpers ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ---------------- crypto ---------------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const randBytes = n => crypto.getRandomValues(new Uint8Array(n));
const randToken = () => b64(randBytes(32)).replace(/[^a-zA-Z0-9]/g, '');
async function hashPassword(pw, saltB64, iter) {
  const salt = saltB64 ? unb64(saltB64) : randBytes(16), iterations = iter || 210000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return { salt: b64(salt), hash: b64(bits), iter: iterations };
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/* ---------------- validation ---------------- */
const normEmail = e => String(e || '').trim().toLowerCase();
function normPhone(p) {
  let s = String(p || '').replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (s.startsWith('+965')) s = s.slice(4); else if (s.startsWith('00965')) s = s.slice(5);
  return s;
}
const isEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(normEmail(e));
const isPhone = p => /^[569]\d{7}$/.test(normPhone(p));
const pwRules = pw => [
  [pw.length >= 8, t('٨ خانات على الأقل', 'At least 8 characters')],
  [/[A-Z]/.test(pw), t('حرف إنجليزي كبير', 'An uppercase letter')],
  [/[a-z]/.test(pw), t('حرف إنجليزي صغير', 'A lowercase letter')],
  [/\d/.test(pw), t('رقم', 'A number')],
  [/[^A-Za-z0-9]/.test(pw), t('رمز مثل ! @ #', 'A symbol such as ! @ #')]
];
const pwStrong = pw => pwRules(pw).every(r => r[0]);

/* ---------------- simulated server ---------------- */
const SRV = 'qatra_srv';
const db0 = () => store.get(SRV, { users: [], tokens: {}, codes: {}, fails: {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
const api = {
  async available(email, phone) {
    await wait(250); const d = db0();
    return { emailTaken: d.users.some(u => u.email === normEmail(email)), phoneTaken: d.users.some(u => u.phone === normPhone(phone)) };
  },
  // Sends a 6-digit code. SIMULATION: the code is returned so the prototype can show it.
  async sendCode(purpose, target) {
    await wait(400); const d = db0(); const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    d.codes[purpose + ':' + target] = { code, exp: Date.now() + 10 * 60e3, tries: 0 }; store.set(SRV, d); return { demoCode: code };
  },
  checkCode(d, purpose, target, code) {
    const c = d.codes[purpose + ':' + target];
    if (!c || Date.now() > c.exp) return 'expired';
    if (c.tries >= 5) return 'locked';
    if (!safeEqual(String(code), c.code)) { c.tries++; store.set(SRV, d); return 'wrong'; }
    delete d.codes[purpose + ':' + target]; return 'ok';
  },
  async signup({ name, email, phone, password, channel, code }) {
    await wait(300); const d = db0(); email = normEmail(email); phone = normPhone(phone);
    if (d.users.some(u => u.email === email || u.phone === phone)) return { error: 'taken' };
    const r = this.checkCode(d, 'signup', channel === 'email' ? email : phone, code); if (r !== 'ok') return { error: r };
    const h = await hashPassword(password);
    const user = { id: 'u' + randToken().slice(0, 12), name: name.trim(), email, phone, ...h, created: Date.now(), verified: channel };
    d.users.push(user); const tok = randToken(); d.tokens[tok] = { uid: user.id, exp: Date.now() + 30 * 864e5 }; store.set(SRV, d);
    return { token: tok };
  },
  async login(identifier, password) {
    await wait(300); const d = db0(); const key = identifier.includes('@') ? normEmail(identifier) : normPhone(identifier);
    const f = d.fails[key] || { n: 0, until: 0 };
    if (Date.now() < f.until) return { error: 'locked', mins: Math.ceil((f.until - Date.now()) / 60e3) };
    const u = d.users.find(x => x.email === key || x.phone === key);
    const h = await hashPassword(password, u ? u.salt : null, u ? u.iter : null); // hash even if no user (same timing)
    if (!u || !safeEqual(h.hash, u.hash)) {
      f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; } d.fails[key] = f; store.set(SRV, d); return { error: 'bad' };
    }
    delete d.fails[key]; const tok = randToken(); d.tokens[tok] = { uid: u.id, exp: Date.now() + 30 * 864e5 }; store.set(SRV, d);
    return { token: tok };
  },
  async resetStart(identifier) {
    await wait(300); const d = db0(); const key = identifier.includes('@') ? normEmail(identifier) : normPhone(identifier);
    const u = d.users.find(x => x.email === key || x.phone === key);
    if (!u) return { sent: true }; // do not reveal whether an account exists
    const r = await this.sendCode('reset', key); return { sent: true, demoCode: r.demoCode };
  },
  async resetFinish(identifier, code, newPw) {
    await wait(300); const d = db0(); const key = identifier.includes('@') ? normEmail(identifier) : normPhone(identifier);
    const u = d.users.find(x => x.email === key || x.phone === key); if (!u) return { error: 'wrong' };
    const r = this.checkCode(d, 'reset', key, code); if (r !== 'ok') return { error: r };
    Object.assign(u, await hashPassword(newPw));
    for (const k in d.tokens) if (d.tokens[k].uid === u.id) delete d.tokens[k]; // sign out other sessions
    store.set(SRV, d); return { ok: true };
  },
  me(token) {
    const d = db0(), s = d.tokens[token]; if (!s || Date.now() > s.exp) return null;
    const u = d.users.find(x => x.id === s.uid); return u ? { id: u.id, name: u.name, email: u.email, phone: u.phone } : null;
  },
  logout(token) { const d = db0(); delete d.tokens[token]; store.set(SRV, d); }
};

/* ---------------- session + per-user state (overrides page storage) ---------------- */
function loadLocal() {
  const tok = store.get('qatra_session', null); CU = tok ? api.me(tok) : null;
  if (!CU) { store.del('qatra_session'); S = JSON.parse(JSON.stringify(DEFAULT)); return; }
  const x = store.get('qatra_state_' + CU.id, null);
  S = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), x || {});
}
function save() { if (CU) store.set('qatra_state_' + CU.id, S); }
function startSession(token) { store.set('qatra_session', token); loadLocal(); }
function logout() { const tok = store.get('qatra_session', null); if (tok) api.logout(tok); store.del('qatra_session'); CU = null; S = JSON.parse(JSON.stringify(DEFAULT)); authMode = 'login'; go('settings'); }
function switchLang() { store.set('qatra_lang', LANG === 'ar' ? 'en' : 'ar'); location.href = LANG === 'ar' ? 'en.html' : 'ar.html'; }

/* ---------------- form helpers ---------------- */
function field(name, label, opts = {}) {
  const v = opts.value ?? '', type = opts.type || 'text';
  const input = opts.options
    ? `<select name="${name}" id="f_${name}">${opts.options.map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : `<input name="${name}" id="f_${name}" type="${type}" value="${esc(v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} ${opts.attrs || ''}>`;
  return `<div class="fld" id="w_${name}" ${opts.hidden ? 'style="display:none"' : ''}><label>${label}${opts.optional ? ` <span class="muted tiny">(${t('اختياري', 'optional')})</span>` : ''}</label>${input}<div class="err" id="e_${name}"></div></div>`;
}
function yesNo(name, label, v) {
  return `<div class="fld" id="w_${name}"><label>${label}</label><div class="seg">
  <label><input type="radio" name="${name}" value="yes" ${v === true ? 'checked' : ''}><span>${t('نعم', 'Yes')}</span></label>
  <label><input type="radio" name="${name}" value="no" ${v === false ? 'checked' : ''}><span>${t('لا', 'No')}</span></label></div><div class="err" id="e_${name}"></div></div>`;
}
function clearErrs() { document.querySelectorAll('.err').forEach(e => e.textContent = ''); document.querySelectorAll('.bad').forEach(e => e.classList.remove('bad')); }
function setErr(name, msg) { const e = $('#e_' + name); if (e) e.textContent = msg; const i = $('#f_' + name) || document.querySelector(`[name="${name}"]`); if (i) i.classList.add('bad'); }
const val = n => { const el = document.querySelector(`[name="${n}"]:checked`) || document.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
function busy(btn, on, label) { btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>'; } else btn.innerHTML = label || btn.dataset.l; }
function pwEye(name) { return `<button type="button" class="eye" onclick="const i=document.getElementById('f_${name}');i.type=i.type==='password'?'text':'password'">${t('إظهار', 'Show')}</button>`; }
function demoBanner(code, where) {
  return `<div class="alert blue"><b>${t('وضع تجريبي', 'Demo mode')}:</b> ${t('الرمز', 'your code is')} <b dir="ltr" style="letter-spacing:3px">${code}</b><br><span class="tiny">${t('بالنسخة الحقيقية يوصلك على ' + where + '.', 'In the real app it is sent to your ' + where + '.')}</span></div>`;
}

/* ---------------- auth screens ---------------- */
let authMode = 'login', pendingSignup = null, resetId = null;
function authView() {
  const head = `<div class="card" style="text-align:center"><div class="logo" style="width:56px;height:56px;margin:4px auto 8px;border-radius:18px"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 2C9 7 5 10.5 5 15a7 7 0 0 0 14 0c0-4.5-4-8-7-13z" fill="#fff"/></svg></div>
   <h2 style="font-size:20px;margin:0">${t('قطرة', 'Qatra')}</h2><p class="small muted">${t('راقب استهلاك الماي ببيتك', 'Track your home water use')}</p></div>`;
  const tabs = (authMode === 'login' || authMode === 'signup') ? `<div class="seg big2" style="margin-bottom:12px"><label><input type="radio" name="am" ${authMode === 'login' ? 'checked' : ''} onclick="authMode='login';render()"><span>${t('تسجيل الدخول', 'Log in')}</span></label><label><input type="radio" name="am" ${authMode === 'signup' ? 'checked' : ''} onclick="authMode='signup';render()"><span>${t('إنشاء حساب', 'Create account')}</span></label></div>` : '';
  const langBtn = `<button class="btn ghost" style="margin-top:4px" onclick="switchLang()">${t('English', 'العربية')}</button>`;
  $('#view').innerHTML = head + tabs + `<div id="auth"></div>` + langBtn;
  ({ login: loginForm, signup: signupForm, verify: verifyForm, forgot: forgotForm, reset: resetForm })[authMode]();
}
function loginForm() {
  $('#auth').innerHTML = `<form class="card" id="af" novalidate><h2>${t('تسجيل الدخول', 'Log in')}</h2>
  ${field('id', t('البريد الإلكتروني أو رقم الهاتف', 'Email or phone number'), { attrs: 'autocomplete="username" dir="ltr"' })}
  <div style="position:relative">${field('pw', t('كلمة المرور', 'Password'), { type: 'password', attrs: 'autocomplete="current-password" dir="ltr"' })}${pwEye('pw')}</div>
  <div id="gerr"></div>
  <button class="btn" id="sb" style="margin-top:14px">${t('دخول', 'Log in')}</button>
  <button type="button" class="link" onclick="authMode='forgot';render()">${t('نسيت كلمة المرور؟', 'Forgot password?')}</button></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault(); clearErrs(); $('#gerr').innerHTML = '';
    const id = val('id'), pw = $('#f_pw').value; let ok = true;
    if (!id) { setErr('id', t('اكتب البريد الإلكتروني أو رقم الهاتف', 'Enter your email or phone number')); ok = false; }
    else if (id.includes('@') ? !isEmail(id) : !isPhone(id)) { setErr('id', id.includes('@') ? t('صيغة البريد غير صحيحة', 'Email format is not valid') : t('رقم الهاتف لازم ٨ أرقام ويبدأ بـ 5 أو 6 أو 9', 'Phone must be 8 digits starting with 5, 6 or 9')); ok = false; }
    if (!pw) { setErr('pw', t('اكتب كلمة المرور', 'Enter your password')); ok = false; }
    if (!ok) return;
    const b = $('#sb'); busy(b, true); const r = await api.login(id, pw); busy(b, false);
    if (r.error === 'locked') { $('#gerr').innerHTML = `<div class="alert red">${t('محاولات كثيرة. جرّب بعد ' + r.mins + ' دقايق.', 'Too many attempts. Try again in ' + r.mins + ' min.')}</div>`; return; }
    if (r.error) { $('#gerr').innerHTML = `<div class="alert red">${t('بيانات الدخول غير صحيحة', 'Incorrect login details')}</div>`; setErr('id', ''); setErr('pw', ''); return; }
    startSession(r.token); toast(t('أهلاً ' + CU.name.split(' ')[0], 'Welcome ' + CU.name.split(' ')[0])); go(S.profile ? 'home' : 'settings');
  };
}
function signupForm() {
  const p = pendingSignup || {};
  $('#auth').innerHTML = `<form class="card" id="af" novalidate><h2>${t('إنشاء حساب', 'Create account')}</h2>
  ${field('name', t('الاسم الكامل', 'Full name'), { value: p.name, attrs: 'autocomplete="name"' })}
  ${field('email', t('البريد الإلكتروني', 'Email'), { type: 'email', value: p.email, attrs: 'autocomplete="email" dir="ltr"' })}
  ${field('phone', t('رقم الهاتف', 'Phone number'), { type: 'tel', value: p.phone, ph: '5xxxxxxx', attrs: 'autocomplete="tel" dir="ltr" inputmode="tel"' })}
  <div style="position:relative">${field('pw', t('كلمة المرور', 'Password'), { type: 'password', attrs: 'autocomplete="new-password" dir="ltr"' })}${pwEye('pw')}</div>
  <ul class="rules" id="rules"></ul>
  ${field('pw2', t('تأكيد كلمة المرور', 'Confirm password'), { type: 'password', attrs: 'autocomplete="new-password" dir="ltr"' })}
  <button class="btn" id="sb" style="margin-top:14px">${t('التالي', 'Next')}</button></form>`;
  const showRules = () => { const pw = $('#f_pw').value; $('#rules').innerHTML = pwRules(pw).map(([ok, l]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '•'} ${l}</li>`).join(''); };
  $('#f_pw').oninput = showRules; showRules();
  $('#af').onsubmit = async e => {
    e.preventDefault(); clearErrs();
    const name = val('name'), email = val('email'), phone = val('phone'), pw = $('#f_pw').value, pw2 = $('#f_pw2').value; let ok = true;
    if (!name) { setErr('name', t('اكتب اسمك الكامل', 'Enter your full name')); ok = false; }
    else if (name.split(/\s+/).length < 2) { setErr('name', t('اكتب الاسم الأول واسم العائلة على الأقل', 'Enter at least your first and last name')); ok = false; }
    if (!email) { setErr('email', t('اكتب البريد الإلكتروني', 'Enter your email')); ok = false; }
    else if (!isEmail(email)) { setErr('email', t('صيغة البريد غير صحيحة، مثال: name@mail.com', 'Email format is not valid, e.g. name@mail.com')); ok = false; }
    if (!phone) { setErr('phone', t('اكتب رقم الهاتف', 'Enter your phone number')); ok = false; }
    else if (!isPhone(phone)) { setErr('phone', t('رقم الهاتف لازم ٨ أرقام ويبدأ بـ 5 أو 6 أو 9', 'Phone must be 8 digits starting with 5, 6 or 9')); ok = false; }
    if (!pw) { setErr('pw', t('اكتب كلمة المرور', 'Enter a password')); ok = false; }
    else if (!pwStrong(pw)) { setErr('pw', t('كلمة المرور ضعيفة، شوف الشروط تحت', 'Password is too weak, see the rules below')); ok = false; }
    if (!pw2) { setErr('pw2', t('أعد كتابة كلمة المرور', 'Re-enter the password')); ok = false; }
    else if (pw && pw !== pw2) { setErr('pw2', t('كلمتا المرور مو متطابقتين', 'Passwords do not match')); ok = false; }
    if (!ok) return;
    const b = $('#sb'); busy(b, true); const a = await api.available(email, phone); busy(b, false);
    if (a.emailTaken) { setErr('email', t('هذا البريد مسجل بحساب ثاني', 'This email is already registered')); ok = false; }
    if (a.phoneTaken) { setErr('phone', t('هذا الرقم مسجل بحساب ثاني', 'This phone number is already registered')); ok = false; }
    if (!ok) return;
    pendingSignup = { name, email: normEmail(email), phone: normPhone(phone), password: pw, channel: 'email', demo: null };
    authMode = 'verify'; render();
  };
}
function verifyForm() {
  const p = pendingSignup; if (!p) { authMode = 'signup'; return render(); }
  const target = p.channel === 'email' ? p.email : p.phone;
  $('#auth').innerHTML = `<div class="card"><h2>${t('تأكيد الحساب', 'Verify your account')}</h2>
  <p class="small muted">${t('وين نرسل لك رمز التحقق؟', 'Where should we send your code?')}</p>
  <div class="seg" style="margin:8px 0"><label><input type="radio" name="ch" value="email" ${p.channel === 'email' ? 'checked' : ''}><span>${t('البريد', 'Email')}</span></label><label><input type="radio" name="ch" value="sms" ${p.channel === 'sms' ? 'checked' : ''}><span>${t('رسالة SMS', 'SMS')}</span></label></div>
  <p class="small" dir="ltr" style="text-align:center"><b>${esc(target)}</b></p>
  <button class="btn sec" id="send">${p.demo ? t('أرسل الرمز مرة ثانية', 'Resend code') : t('أرسل الرمز', 'Send code')}</button>
  <div id="demo" style="margin-top:10px">${p.demo ? demoBanner(p.demo, p.channel === 'email' ? t('بريدك', 'email') : t('جوالك', 'phone')) : ''}</div>
  <form id="af" novalidate ${p.demo ? '' : 'style="display:none"'}>${field('code', t('رمز التحقق (٦ أرقام)', 'Verification code (6 digits)'), { attrs: 'inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code"' })}
  <button class="btn" id="sb" style="margin-top:12px">${t('تأكيد وإنشاء الحساب', 'Verify and create account')}</button></form>
  <button class="link" onclick="authMode='signup';render()">${t('رجوع لتعديل البيانات', 'Back to edit details')}</button></div>`;
  document.querySelectorAll('[name=ch]').forEach(r => r.onchange = () => { p.channel = r.value; p.demo = null; render(); });
  $('#send').onclick = async () => { const b = $('#send'); busy(b, true); const r = await api.sendCode('signup', target); p.demo = r.demoCode; busy(b, false); render(); };
  $('#af').onsubmit = async e => {
    e.preventDefault(); clearErrs(); const code = val('code').replace(/\D/g, '');
    if (code.length !== 6) return setErr('code', t('الرمز لازم ٦ أرقام', 'The code must be 6 digits'));
    const b = $('#sb'); busy(b, true); const r = await api.signup({ ...p, code }); busy(b, false);
    if (r.error === 'wrong') return setErr('code', t('الرمز غلط', 'Incorrect code'));
    if (r.error === 'expired') return setErr('code', t('الرمز انتهى، أرسل رمز جديد', 'Code expired, send a new one'));
    if (r.error === 'locked') return setErr('code', t('محاولات كثيرة، أرسل رمز جديد', 'Too many attempts, send a new code'));
    if (r.error === 'taken') { authMode = 'signup'; render(); return; }
    pendingSignup = null; startSession(r.token); toast(t('تم إنشاء الحساب', 'Account created')); wizStep = 1; wizData = null; go('settings');
  };
}
function forgotForm() {
  $('#auth').innerHTML = `<form class="card" id="af" novalidate><h2>${t('استرجاع كلمة المرور', 'Reset password')}</h2>
  <p class="small muted">${t('اكتب بريدك أو رقمك ونرسل لك رمز.', 'Enter your email or phone and we will send you a code.')}</p>
  ${field('id', t('البريد الإلكتروني أو رقم الهاتف', 'Email or phone number'), { attrs: 'dir="ltr"' })}
  <button class="btn" id="sb" style="margin-top:12px">${t('أرسل الرمز', 'Send code')}</button>
  <button type="button" class="link" onclick="authMode='login';render()">${t('رجوع لتسجيل الدخول', 'Back to log in')}</button></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault(); clearErrs(); const id = val('id');
    if (!id) return setErr('id', t('اكتب البريد الإلكتروني أو رقم الهاتف', 'Enter your email or phone number'));
    if (id.includes('@') ? !isEmail(id) : !isPhone(id)) return setErr('id', t('الصيغة غير صحيحة', 'Format is not valid'));
    const b = $('#sb'); busy(b, true); const r = await api.resetStart(id); busy(b, false);
    resetId = { id, demo: r.demoCode || null }; authMode = 'reset'; render();
  };
}
function resetForm() {
  const r0 = resetId; if (!r0) { authMode = 'forgot'; return render(); }
  $('#auth').innerHTML = `<form class="card" id="af" novalidate><h2>${t('كلمة مرور جديدة', 'New password')}</h2>
  <p class="small muted">${t('إذا الحساب موجود، أرسلنا رمز على', 'If an account exists, we sent a code to')} <b dir="ltr">${esc(r0.id)}</b></p>
  ${r0.demo ? demoBanner(r0.demo, r0.id.includes('@') ? t('بريدك', 'email') : t('جوالك', 'phone')) : `<div class="alert amber tiny">${t('وضع تجريبي: ما لقينا حساب بهذي البيانات.', 'Demo mode: no account was found with these details.')}</div>`}
  ${field('code', t('رمز التحقق', 'Verification code'), { attrs: 'inputmode="numeric" maxlength="6" dir="ltr"' })}
  <div style="position:relative">${field('pw', t('كلمة المرور الجديدة', 'New password'), { type: 'password', attrs: 'autocomplete="new-password" dir="ltr"' })}${pwEye('pw')}</div>
  <ul class="rules" id="rules"></ul>
  ${field('pw2', t('تأكيد كلمة المرور', 'Confirm password'), { type: 'password', attrs: 'dir="ltr"' })}
  <button class="btn" id="sb" style="margin-top:12px">${t('احفظ كلمة المرور', 'Save password')}</button>
  <button type="button" class="link" onclick="authMode='login';render()">${t('رجوع لتسجيل الدخول', 'Back to log in')}</button></form>`;
  const showRules = () => { $('#rules').innerHTML = pwRules($('#f_pw').value).map(([ok, l]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '•'} ${l}</li>`).join(''); };
  $('#f_pw').oninput = showRules; showRules();
  $('#af').onsubmit = async e => {
    e.preventDefault(); clearErrs(); const code = val('code').replace(/\D/g, ''), pw = $('#f_pw').value, pw2 = $('#f_pw2').value; let ok = true;
    if (code.length !== 6) { setErr('code', t('الرمز لازم ٦ أرقام', 'The code must be 6 digits')); ok = false; }
    if (!pwStrong(pw)) { setErr('pw', t('كلمة المرور ضعيفة، شوف الشروط تحت', 'Password is too weak, see the rules below')); ok = false; }
    if (pw !== pw2) { setErr('pw2', t('كلمتا المرور مو متطابقتين', 'Passwords do not match')); ok = false; }
    if (!ok) return;
    const b = $('#sb'); busy(b, true); const r = await api.resetFinish(r0.id, code, pw); busy(b, false);
    if (r.error) return setErr('code', r.error === 'expired' ? t('الرمز انتهى، اطلب رمز جديد', 'Code expired, request a new one') : t('الرمز غلط', 'Incorrect code'));
    resetId = null; authMode = 'login'; toast(t('تم تغيير كلمة المرور، سجّل دخول', 'Password changed, please log in')); render();
  };
}

/* ---------------- building wizard ---------------- */
const GOVS = [['capital', t('العاصمة', 'Capital')], ['hawalli', t('حولي', 'Hawalli')], ['farwaniya', t('الفروانية', 'Farwaniya')], ['ahmadi', t('الأحمدي', 'Ahmadi')], ['jahra', t('الجهراء', 'Jahra')], ['mubarak', t('مبارك الكبير', 'Mubarak Al-Kabeer')]];
const TYPES = [['house', t('بيت', 'House')], ['apartments', t('عمارة شقق', 'Apartment building')], ['school', t('مدرسة', 'School')], ['industrial', t('مبنى صناعي', 'Industrial building')], ['agricultural', t('مبنى زراعي', 'Agricultural building')], ['other', t('أخرى', 'Other')]];
const lbl = (list, k) => (list.find(x => x[0] === k) || ['', k])[1];
let wizStep = 1, wizData = null;
function wizard() {
  if (!wizData) wizData = JSON.parse(JSON.stringify(S.profile || {}));
  const d = wizData, steps = [t('المبنى', 'Building'), t('السكان', 'People'), t('المراجعة', 'Review')];
  const bar = `<div class="steps">${steps.map((s, i) => `<div class="${i + 1 <= wizStep ? 'on' : ''}"><i>${i + 1}</i>${s}</div>`).join('')}</div>`;
  let body = '';
  if (wizStep === 1) body = `<form class="card" id="wf" novalidate><h2>${t('١. معلومات المبنى', '1. Building information')}</h2>
    ${field('bname', t('اسم المبنى', 'Building name'), { value: d.bname, ph: t('مثال: بيت العنزي', 'e.g. Al-Enezi home') })}
    ${field('gov', t('المحافظة', 'Governorate'), { value: d.gov || '', options: [['', t('اختر', 'Select')], ...GOVS] })}
    ${field('area', t('المنطقة', 'Area'), { value: d.area })}
    <div class="grid2">${field('block', t('القطعة', 'Block'), { value: d.block, attrs: 'inputmode="numeric"' })}${field('street', t('الشارع', 'Street'), { value: d.street })}</div>
    <div class="grid2">${field('avenue', t('الجادة', 'Avenue'), { value: d.avenue, optional: true })}${field('houseNo', t('رقم المنزل', 'House no.'), { value: d.houseNo })}</div>
    ${field('btype', t('نوع المبنى', 'Building type'), { value: d.btype || '', options: [['', t('اختر', 'Select')], ...TYPES] })}
    ${field('btypeOther', t('حدد نوع المبنى', 'Specify the building type'), { value: d.btypeOther, hidden: d.btype !== 'other' })}
    <div class="grid2">${field('floors', t('عدد الأدوار', 'Floors'), { type: 'number', value: d.floors, attrs: 'min="1" inputmode="numeric"' })}
    ${field('apts', t('عدد الشقق', 'Apartments'), { type: 'number', value: d.apts, attrs: 'min="1" inputmode="numeric"', hidden: d.btype !== 'apartments' })}</div>
    ${field('barea', t('مساحة المبنى (م²)', 'Building area (m²)'), { type: 'number', value: d.barea, attrs: 'min="1" inputmode="decimal"' })}
    <button class="btn" style="margin-top:14px">${t('التالي', 'Next')}</button></form>`;
  if (wizStep === 2) body = `<form class="card" id="wf" novalidate><h2>${t('٢. الأشخاص والاستخدام', '2. People and use')}</h2>
    <div class="grid2">${field('kids', t('الأطفال (0–17)', 'Children (0–17)'), { type: 'number', value: d.kids ?? '', attrs: 'min="0" inputmode="numeric"' })}
    ${field('adults', t('البالغين (18+)', 'Adults (18+)'), { type: 'number', value: d.adults ?? '', attrs: 'min="0" inputmode="numeric"' })}</div>
    ${field('cars', t('عدد السيارات', 'Number of cars'), { type: 'number', value: d.cars ?? '', attrs: 'min="0" inputmode="numeric"' })}
    <div id="washWrap" ${+d.cars > 0 ? '' : 'style="display:none"'}>${yesNo('carWash', t('هل تنغسل السيارات بالبيت؟', 'Are cars washed at home?'), d.carWash)}</div>
    ${yesNo('garden', t('هل فيه حديقة أو مساحة مزروعة؟', 'Is there a garden or planted area?'), d.garden)}
    <div id="gWrap" ${d.garden ? '' : 'style="display:none"'}>${field('irrArea', t('مساحة الحديقة (م²)', 'Garden area (m²)'), { type: 'number', value: d.irrArea || '', attrs: 'min="1" inputmode="decimal"' })}</div>
    ${yesNo('pool', t('هل فيه مسبح؟', 'Is there a swimming pool?'), d.pool)}
    <div class="row" style="margin-top:14px"><button type="button" class="btn ghost" id="back">${t('رجوع', 'Back')}</button><button class="btn">${t('التالي', 'Next')}</button></div></form>`;
  if (wizStep === 3) {
    const yn = v => v ? t('نعم', 'Yes') : t('لا', 'No');
    const addr = [lbl(GOVS, d.gov), d.area, t('قطعة ', 'Block ') + d.block, t('شارع ', 'Street ') + d.street, d.avenue ? t('جادة ', 'Avenue ') + d.avenue : '', t('منزل ', 'House ') + d.houseNo].filter(Boolean).join('، ');
    const rows = [[t('اسم المبنى', 'Building name'), d.bname], [t('الموقع', 'Location'), addr], [t('نوع المبنى', 'Building type'), d.btype === 'other' ? d.btypeOther : lbl(TYPES, d.btype)],
      [t('عدد الأدوار', 'Floors'), d.floors], ...(d.btype === 'apartments' ? [[t('عدد الشقق', 'Apartments'), d.apts]] : []), [t('مساحة المبنى', 'Building area'), d.barea + t(' م²', ' m²')],
      [t('السكان', 'Residents'), `${+d.kids + +d.adults} (${t('أطفال', 'children')} ${d.kids}، ${t('بالغين', 'adults')} ${d.adults})`],
      [t('السيارات', 'Cars'), d.cars + (+d.cars > 0 ? ` · ${t('غسيل بالبيت', 'washed at home')}: ${yn(d.carWash)}` : '')],
      [t('حديقة', 'Garden'), d.garden ? `${t('نعم', 'Yes')} · ${d.irrArea}${t(' م²', ' m²')}` : t('لا', 'No')], [t('مسبح', 'Pool'), yn(d.pool)]];
    body = `<div class="card"><h2>${t('٣. مراجعة البيانات', '3. Review')}</h2>
    <table>${rows.map(([k, v]) => `<tr><th style="width:38%">${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    <p style="margin:16px 0 10px;font-weight:600;text-align:center">${t('هل المعلومات صحيحة؟', 'Is this information correct?')}</p>
    <div class="row"><button class="btn ghost" id="edit">${t('لا، أبي أعدّل', 'No, edit')}</button><button class="btn" id="ok">${t('نعم، احفظ', 'Yes, save')}</button></div></div>`;
  }
  $('#view').innerHTML = bar + body;
  if (wizStep === 1) {
    $('#f_btype').onchange = e => { $('#w_btypeOther').style.display = e.target.value === 'other' ? '' : 'none'; $('#w_apts').style.display = e.target.value === 'apartments' ? '' : 'none'; };
    $('#wf').onsubmit = e => {
      e.preventDefault(); clearErrs(); let ok = true; const req = (k, m) => { if (!val(k)) { setErr(k, m); ok = false; } };
      req('bname', t('اكتب اسم المبنى', 'Enter the building name')); req('gov', t('اختر المحافظة', 'Select the governorate'));
      req('area', t('اكتب المنطقة', 'Enter the area')); req('block', t('اكتب رقم القطعة', 'Enter the block')); req('street', t('اكتب الشارع', 'Enter the street'));
      req('houseNo', t('اكتب رقم المنزل', 'Enter the house number')); req('btype', t('اختر نوع المبنى', 'Select the building type'));
      if (val('btype') === 'other') req('btypeOther', t('حدد نوع المبنى', 'Specify the building type'));
      const fl = +val('floors'); if (!(fl >= 1 && Number.isInteger(fl))) { setErr('floors', t('عدد الأدوار لازم رقم صحيح ١ أو أكثر', 'Floors must be a whole number, 1 or more')); ok = false; }
      if (val('btype') === 'apartments') { const a = +val('apts'); if (!(a >= 1 && Number.isInteger(a))) { setErr('apts', t('اكتب عدد الشقق', 'Enter the number of apartments')); ok = false; } }
      if (!(+val('barea') > 0)) { setErr('barea', t('اكتب مساحة المبنى بالمتر المربع', 'Enter the building area in m²')); ok = false; }
      if (!ok) { const f = document.querySelector('.bad'); if (f) f.scrollIntoView({ block: 'center' }); return; }
      Object.assign(d, { bname: val('bname'), gov: val('gov'), area: val('area'), block: val('block'), street: val('street'), avenue: val('avenue'), houseNo: val('houseNo'),
        btype: val('btype'), btypeOther: val('btype') === 'other' ? val('btypeOther') : '', floors: fl, apts: val('btype') === 'apartments' ? +val('apts') : null, barea: +val('barea') });
      wizStep = 2; wizard(); scrollTo(0, 0);
    };
  }
  if (wizStep === 2) {
    $('#f_cars').oninput = e => { $('#washWrap').style.display = +e.target.value > 0 ? '' : 'none'; };
    document.querySelectorAll('[name=garden]').forEach(r => r.onchange = () => { $('#gWrap').style.display = val('garden') === 'yes' ? '' : 'none'; });
    $('#back').onclick = () => { wizStep = 1; wizard(); };
    $('#wf').onsubmit = e => {
      e.preventDefault(); clearErrs(); let ok = true; const int = (k, min, m) => { const v = val(k); if (v === '' || !(+v >= min) || !Number.isInteger(+v)) { setErr(k, m); ok = false; } };
      int('kids', 0, t('اكتب عدد الأطفال (٠ إذا ما فيه)', 'Enter the number of children (0 if none)'));
      int('adults', 0, t('اكتب عدد البالغين', 'Enter the number of adults'));
      if (ok && +val('kids') + +val('adults') < 1) { setErr('adults', t('لازم يكون فيه ساكن واحد على الأقل', 'There must be at least one resident')); ok = false; }
      int('cars', 0, t('اكتب عدد السيارات (٠ إذا ما فيه)', 'Enter the number of cars (0 if none)'));
      if (+val('cars') > 0 && !val('carWash')) { setErr('carWash', t('اختر نعم أو لا', 'Choose yes or no')); ok = false; }
      if (!val('garden')) { setErr('garden', t('اختر نعم أو لا', 'Choose yes or no')); ok = false; }
      if (val('garden') === 'yes' && !(+val('irrArea') > 0)) { setErr('irrArea', t('اكتب مساحة الحديقة', 'Enter the garden area')); ok = false; }
      if (!val('pool')) { setErr('pool', t('اختر نعم أو لا', 'Choose yes or no')); ok = false; }
      if (!ok) { const f = document.querySelector('.err:not(:empty)'); if (f) f.scrollIntoView({ block: 'center' }); return; }
      Object.assign(d, { kids: +val('kids'), adults: +val('adults'), cars: +val('cars'), carWash: +val('cars') > 0 ? val('carWash') === 'yes' : false,
        garden: val('garden') === 'yes', irrArea: val('garden') === 'yes' ? +val('irrArea') : 0, pool: val('pool') === 'yes' });
      wizStep = 3; wizard(); scrollTo(0, 0);
    };
  }
  if (wizStep === 3) {
    $('#edit').onclick = () => { wizStep = 1; wizard(); scrollTo(0, 0); };
    $('#ok').onclick = () => {
      S.profile = { ...d, chip: (S.profile && S.profile.chip) || d.chip || '', name: d.bname, residents: +d.kids + +d.adults, floors: Math.min(4, +d.floors) }; save();
      wizData = null; wizStep = 1; editingBuilding = false; toast(t('تم حفظ المعلومات', 'Information saved')); go('home');
    };
  }
}

/* ---------------- المنزل / Household page ---------------- */
let editingBuilding = false;
function onboard() { settings(); }
function settings() {
  if (!CU) return authView();
  if (!S.profile || editingBuilding) return wizard();
  const p = S.profile, yn = v => v ? t('نعم', 'Yes') : t('لا', 'No');
  const addr = [lbl(GOVS, p.gov), p.area, p.block ? t('قطعة ', 'Block ') + p.block : '', p.street ? t('شارع ', 'Street ') + p.street : '', p.avenue ? t('جادة ', 'Avenue ') + p.avenue : '', p.houseNo ? t('منزل ', 'House ') + p.houseNo : ''].filter(Boolean).join('، ');
  const rows = [[t('الموقع', 'Location'), addr], [t('نوع المبنى', 'Building type'), p.btype === 'other' ? p.btypeOther : lbl(TYPES, p.btype)],
    [t('عدد الأدوار', 'Floors'), p.floors], ...(p.btype === 'apartments' ? [[t('عدد الشقق', 'Apartments'), p.apts]] : []),
    [t('مساحة المبنى', 'Building area'), (p.barea || '–') + t(' م²', ' m²')],
    [t('السكان', 'Residents'), `${p.residents} (${t('أطفال', 'children')} ${p.kids ?? 0}، ${t('بالغين', 'adults')} ${p.adults ?? p.residents})`],
    [t('السيارات', 'Cars'), (p.cars ?? 0) + (+p.cars > 0 ? ` · ${t('غسيل بالبيت', 'washed at home')}: ${yn(p.carWash)}` : '')],
    [t('حديقة', 'Garden'), p.garden ? `${t('نعم', 'Yes')} · ${p.irrArea}${t(' م²', ' m²')}` : t('لا', 'No')], [t('مسبح', 'Pool'), yn(p.pool)],
    ...(p.chip ? [[t('رقم الشريحة', 'Chip number'), p.chip]] : [])];
  $('#view').innerHTML = `
  <div class="card"><div class="row between"><h2>${t('حسابي', 'My account')}</h2><button class="link" style="margin:0" onclick="logout()">${t('تسجيل خروج', 'Log out')}</button></div>
   <div class="small"><b>${esc(CU.name)}</b></div><div class="small muted" dir="ltr" style="text-align:${LANG === 'ar' ? 'right' : 'left'}">${esc(CU.email)} · ${esc(CU.phone)}</div>
   <button class="btn ghost" style="margin-top:10px" onclick="switchLang()">${t('لغة البرنامج: العربية ← English', 'Language: English → العربية')}</button></div>
  <div class="card"><div class="row between"><h2>${esc(p.bname || p.name)}</h2><span class="tag">${esc(p.btype === 'other' ? p.btypeOther : lbl(TYPES, p.btype))}</span></div>
   <table>${rows.map(([k, v]) => `<tr><th style="width:38%">${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
   <button class="btn sec" style="margin-top:12px" onclick="editingBuilding=true;wizStep=1;wizData=null;render()">${t('تعديل المعلومات', 'Edit information')}</button></div>
  <div class="card"><h2>${t('الإشعارات', 'Notifications')}</h2><p class="small muted">${t('ننبهك إذا زاد استهلاكك فجأة أو إذا وفّرت.', 'We alert you if your use jumps or when you save.')}</p>
   <button class="btn sec" style="margin-top:10px" onclick="enablePush()">${t('فعّل إشعارات الجوال', 'Enable phone notifications')}</button></div>`;
}

/* ---------------- meter reading (on-device OCR) ---------------- */
let IMG = null, BOX = null;
function loadImg(file) { return new Promise(ok => { const im = new Image(); im.onload = () => {
  const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = $('#cv'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); IMG = c; BOX = { x: .15, y: .38, w: .7, h: .2 }; drawBox(); bindCrop(); ok(); };
  im.onerror = () => ok(); im.src = URL.createObjectURL(file); }); }
function drawBox() { const b = $('#box'); b.style.left = BOX.x * 100 + '%'; b.style.top = BOX.y * 100 + '%'; b.style.width = BOX.w * 100 + '%'; b.style.height = BOX.h * 100 + '%'; }
function bindCrop() {
  const w = $('#cropWrap'); let st = null;
  const pt = e => { const r = w.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  w.onpointerdown = e => { w.setPointerCapture(e.pointerId); st = pt(e); };
  w.onpointermove = e => { if (!st) return; const p = pt(e); const x = Math.min(st.x, p.x), y = Math.min(st.y, p.y), ww = Math.abs(p.x - st.x), hh = Math.abs(p.y - st.y); if (ww > .04 && hh > .03) { BOX = { x, y, w: ww, h: hh }; drawBox(); } };
  w.onpointerup = () => { st = null; };
}
function cropCanvas(invert) {
  const sx = BOX.x * IMG.width, sy = BOX.y * IMG.height, sw = BOX.w * IMG.width, sh = BOX.h * IMG.height;
  const scale = Math.max(1, 140 / sh), c = document.createElement('canvas'); c.width = Math.round(sw * scale) + 40; c.height = Math.round(sh * scale) + 40;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(IMG, sx, sy, sw, sh, 20, 20, sw * scale, sh * scale);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Array(256).fill(0), gray = new Uint8Array(p.length / 4);
  for (let i = 0; i < gray.length; i++) { const v = Math.round(.299 * p[i * 4] + .587 * p[i * 4 + 1] + .114 * p[i * 4 + 2]); gray[i] = v; hist[v]++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]; let sB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = gray.length - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = i; } }
  for (let i = 0; i < gray.length; i++) { let v = gray[i] > th ? 255 : 0; if (invert) v = 255 - v; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; }
  g.putImageData(d, 0, 0); return c;
}
let tessLoading = null, worker = null;
function loadTess() { if (window.Tesseract) return Promise.resolve(); if (tessLoading) return tessLoading;
  tessLoading = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; sc.onload = ok; sc.onerror = () => { tessLoading = null; no(); }; document.head.appendChild(sc); }); return tessLoading; }
async function getWorker() { await loadTess(); if (worker) return worker;
  worker = await Tesseract.createWorker('eng'); await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' }); return worker; }
function placeDecimal(digits) {
  const prev = sorted().slice(-1)[0]; const n = digits.length; if (!n) return null;
  const opts = []; for (let k = 0; k <= Math.min(3, n - 1); k++) opts.push(parseInt(digits, 10) / Math.pow(10, k));
  if (prev) { const ok = opts.filter(v => v >= prev.value - 0.001); if (ok.length) return ok.reduce((a, b) => Math.abs(a - prev.value) < Math.abs(b - prev.value) ? a : b); }
  return n > 5 ? parseInt(digits.slice(0, 5), 10) + parseInt(digits.slice(5), 10) / Math.pow(10, n - 5) : parseInt(digits, 10);
}
async function readOCR() {
  if (!IMG) return; const b = $('#read'); b.disabled = true; b.innerHTML = '<span class="spin"></span> ' + t('جاري قراءة الأرقام…', 'Reading digits…');
  try {
    const w = await getWorker(); let best = null;
    for (const inv of [false, true]) { const r = await w.recognize(cropCanvas(inv)); const digits = (r.data.text || '').replace(/\D/g, '');
      const conf = (r.data.confidence || 0) / 100; if (digits.length >= 3 && (!best || conf > best.conf)) best = { digits, conf }; }
    if (!best) { confirmBox(null, { note: t('ما قدرنا نقرأ الأرقام. قرّب المربع على الأرقام بس، أو جرّب صورة أوضح.', 'Could not read the digits. Fit the box to the digits only, or try a clearer photo.') }); return; }
    confirmBox({ reading: placeDecimal(best.digits), digits_seen: best.digits, confidence: best.conf });
  } catch (e) { confirmBox(null, { note: t('ما قدرنا نشغّل القراءة. تأكد إنك متصل بالإنترنت أول مرة، أو اكتب الرقم.', 'Could not start the reader. Make sure you are online the first time, or type the number.') }); }
  finally { b.disabled = false; b.textContent = t('اقرأ الأرقام', 'Read digits'); }
}
