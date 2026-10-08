import { initStore, store, resetDemo, isPermissionError } from './store.js';
import { SECTIONS, INFO_SECTIONS, DAY_NAMES, DAY_SHORT, ALL_DAYS, NORMAS, defaultTasks, defaultShiftTypes } from './seed.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');

const S = {
  mode: null,
  ready: false,
  error: null,
  workers: [],
  shiftTypes: [],
  tasks: [],
  settings: {},
  owner: null,
  pins: {},
  checklists: null,
  carry: [],
  alerts: [],
  session: loadSession(),
  route: { path: '', sub: '' },
  modal: null,
  ui: { expanded: new Set(), weekStart: null, report: null, pin: '', pinError: false, pickWorker: null, showAllAlerts: false },
};

// ───────────────────────── utilidades ─────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const weekStartOf = (s) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDate = (s) => parseYmd(s).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (s) => parseYmd(s).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const isShared = (t) => t.shared ?? !INFO_SECTIONS.includes(t.section);
const addMin = (hm, m) => { const [h, mi] = hm.split(':').map(Number); const x = h * 60 + mi + m; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
const sectionName = (id) => SECTIONS.find((s) => s.id === id)?.name || id;
const sectionIdx = (id) => { const i = SECTIONS.findIndex((s) => s.id === id); return i < 0 ? 99 : i; };
const wName = (id, fallback) => S.workers.find((w) => w.id === id)?.name || fallback || 'Alguien';

function loadSession() {
  try { return JSON.parse(localStorage.getItem('heladeria-session')) || null; } catch { return null; }
}
function saveSession(s) {
  S.session = s;
  try { s ? localStorage.setItem('heladeria-session', JSON.stringify(s)) : localStorage.removeItem('heladeria-session'); } catch {}
}
const go = (hash) => { location.hash = hash; };

// Ítems marcables de un checklist (los recordatorios "Durante el día" no cuentan).
function sortedItems(c) {
  return Object.entries(c.items || {})
    .map(([id, it]) => ({ ...it, id }))
    .filter((it) => !INFO_SECTIONS.includes(it.section))
    .sort((a, b) => sectionIdx(a.section) - sectionIdx(b.section) || (a.order || 0) - (b.order || 0));
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $toasts.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.16);
    });
  } catch {}
}

async function showNotification(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, tag, icon: 'icon.svg' });
    else new Notification(title, { body });
  } catch {}
}

// ───────────────────────── arranque ─────────────────────────

boot();

async function boot() {
  try {
    S.mode = await initStore();
    if (S.mode === 'demo') await seedDemo();
    else await checkFirebaseSession();
  } catch (e) {
    console.error(e);
    S.error = e;
    return renderError();
  }
  const onErr = (e) => { S.error = e; render(); };
  store.watch('workers', [], (d) => { S.workers = d.sort((a, b) => a.name.localeCompare(b.name)); render(); }, onErr);
  store.watch('shiftTypes', [], (d) => { S.shiftTypes = d.sort((a, b) => (a.start || '').localeCompare(b.start || '')); render(); }, onErr);
  store.watch('tasks', [], (d) => { S.tasks = d.sort((a, b) => sectionIdx(a.section) - sectionIdx(b.section) || (a.order || 0) - (b.order || 0)); render(); }, onErr);
  if (S.mode === 'demo') store.watch('settings', [], (d) => { S.settings = d.find((x) => x.id === 'app') || {}; render(); }, onErr);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  S.ready = true;
  setInterval(checkAlarms, 30000);
  window.addEventListener('hashchange', route);
  route();
}

async function seedDefaults() {
  if ((await store.list('tasks')).length) return;
  for (const t of defaultTasks()) await store.set('tasks', t.id, t);
  for (const st of defaultShiftTypes()) await store.set('shiftTypes', st.id, st);
}

async function seedDemo() {
  if (await store.get('settings', 'app')) return;
  await seedDefaults();
  await store.set('settings', 'app', { adminPin: '1234', createdAt: Date.now() });
}

const isOwner = () => !!S.owner && S.owner.uid === store.auth.uid();

// Con Firebase: comprueba que la sesión guardada en el dispositivo siga siendo válida.
async function checkFirebaseSession() {
  S.owner = await store.get('settings', 'owner');
  if (S.session?.role === 'admin' && !isOwner()) saveSession(null);
  if (S.session?.role === 'worker') {
    const sess = await store.get('sessions', store.auth.uid()).catch(() => null);
    if (!sess || sess.workerId !== S.session.workerId) saveSession(null);
  }
}

// Si Firebase deja de reconocer la sesión (PIN cambiado, persona desactivada…), vuelve al inicio.
function sessionLost() {
  if (!S.session) return;
  saveSession(null);
  stopAlerts();
  toast('Tu sesión expiró. Vuelve a ingresar.', 'err');
  go('');
}

function route() {
  const [path = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  S.route = { path, sub };
  S.ui.pin = '';
  S.ui.pinError = false;
  if (path !== 'equipo') S.ui.pickWorker = null;
  if (S.session?.role === 'admin') ensureAlerts();
  render();
  window.scrollTo(0, 0);
}

// Suscripción a checklists por rango de fechas (se reutiliza entre renders).
let clSub = { key: null, unsub: null };
function useChecklists(from, to) {
  const key = `${from}|${to}`;
  if (clSub.key === key) return;
  clSub.unsub?.();
  clSub.key = key;
  S.checklists = null;
  clSub.unsub = store.watch('checklists', [['date', '>=', from], ['date', '<=', to]], (docs) => {
    if (clSub.key !== key) return;
    S.checklists = docs;
    render();
  }, (e) => {
    clSub.key = null;
    if (isPermissionError(e)) return sessionLost();
    S.error = e;
    render();
  });
}

// Tareas postergadas para otro día (pendientes arrastrados).
let carryUnsub = null;
function useCarry() {
  if (carryUnsub) return;
  carryUnsub = store.watch('carry', [['done', '==', false]], (d) => {
    S.carry = d.sort((a, b) => a.toDate.localeCompare(b.toDate));
    render();
  }, (e) => { carryUnsub = null; if (isPermissionError(e)) sessionLost(); });
}

// Alarmas de tareas con hora (ej. basura 18:00): 15 min antes y a la hora.
function checkAlarms() {
  if (S.session?.role !== 'worker' || !S.checklists) return;
  const t = today();
  const mine = S.checklists.find((c) => c.date === t && c.workerId === S.session.workerId);
  if (!mine || mine.closedAt) return;
  const now = nowHM();
  for (const it of sortedItems(mine)) {
    if (!it.time || it.done) continue;
    for (const [at, label] of [[addMin(it.time, -15), `En 15 minutos (${it.time})`], [it.time, `Ahora (${it.time})`]]) {
      const key = `alarm-${t}-${it.id}-${at}`;
      if (now < at || now > addMin(at, 30)) continue;
      try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch {}
      toast(`⏰ ${label}: ${it.text}`, 'warn');
      beep();
      showNotification(`⏰ ${label}`, it.text, key);
    }
  }
}

// Alertas para administración (tiempo real + notificación).
let alertsUnsub = null;
let alertsPrimed = false;
const seenAlerts = new Set();
let pinsUnsub = null;
function ensureAlerts() {
  if (alertsUnsub) return;
  pinsUnsub = store.watch('workerPins', [], (d) => {
    S.pins = Object.fromEntries(d.map((x) => [x.id, x.pin]));
    render();
  }, (e) => isPermissionError(e) && sessionLost());
  alertsUnsub = store.watch('alerts', [['at', '>=', Date.now() - 14 * 864e5]], (docs) => {
    docs.sort((a, b) => b.at - a.at);
    if (alertsPrimed) docs.filter((a) => !seenAlerts.has(a.id) && !a.read).forEach(notifyAlert);
    docs.forEach((a) => seenAlerts.add(a.id));
    alertsPrimed = true;
    S.alerts = docs;
    render();
  }, (e) => isPermissionError(e) && sessionLost());
}
function stopAlerts() {
  alertsUnsub?.();
  alertsUnsub = null;
  pinsUnsub?.();
  pinsUnsub = null;
  S.pins = {};
  alertsPrimed = false;
  seenAlerts.clear();
}

function alertText(a) {
  if (a.type === 'cubierta') {
    return `${wName(a.byWorkerId, a.byName)} hizo «${a.text}», que quedó pendiente del turno de ${wName(a.forWorkerId, a.forName)} (${fmtShort(a.date)}).`;
  }
  if (a.type === 'reporte') {
    return `${wName(a.byWorkerId, a.byName)} reportó «${a.text}» del turno de ${wName(a.forWorkerId, a.forName)} (${fmtShort(a.date)})${a.checkedBy ? `, que estaba marcada por ${wName(a.checkedBy)}` : ''}${a.note ? `: “${a.note}”` : '.'}`;
  }
  if (a.type === 'postergada') {
    return `${wName(a.byWorkerId, a.byName)} dejó «${a.text}» para el ${fmtShort(a.toDate)}${a.note ? `: “${a.note}”` : '.'}`;
  }
  if (a.type === 'incompleto') {
    return `${wName(a.forWorkerId, a.forName)} terminó su turno con ${a.count} tarea(s) sin marcar.`;
  }
  return a.text || 'Aviso';
}

async function notifyAlert(a) {
  const msg = alertText(a);
  toast(`🔔 ${msg}`, 'warn');
  beep();
  showNotification('Heladería – aviso', msg, a.id);
}

// ───────────────────────── render ─────────────────────────

function render() {
  if (S.error) return renderError();
  if (!S.ready) return;
  const { path, sub } = S.route;
  let html;
  if (path === 'turno') html = viewWorker();
  else if (path === 'equipo') html = viewPickWorker();
  else if (path === 'admin') html = S.session?.role === 'admin' ? viewAdmin(sub || 'vivo') : viewAdminLogin();
  else html = viewHome();
  $app.innerHTML = html;
}

function renderError() {
  const msg = String(S.error?.message || S.error || '');
  const perm = /permission|insufficient/i.test(msg);
  $app.innerHTML = `
    <div class="page narrow">
      <div class="card">
        <h2>No se pudo conectar</h2>
        <p>${perm
          ? 'Firebase rechazó el acceso. Revisa que hayas activado <b>Authentication → Anónimo</b> y publicado las <b>reglas de Firestore</b> (README, paso 2).'
          : 'Revisa tu conexión a internet y la configuración en <code>js/config.js</code>.'}</p>
        <p class="muted small">${esc(msg)}</p>
        <button class="btn" onclick="location.reload()">Reintentar</button>
      </div>
    </div>`;
}

const demoBanner = () =>
  S.mode === 'demo'
    ? `<div class="demo">Modo demo: los datos se guardan solo en este dispositivo. Configura Firebase para compartirlos con el equipo (ver README).</div>`
    : '';

function topbar(title, right = '') {
  return `<header class="top"><a class="brand" href="#/">🍦</a><div class="top-title">${title}</div><div class="top-right">${right}</div></header>`;
}

function progressBar(done, total) {
  const p = pct(done, total);
  return `<div class="bar"><div class="bar-fill ${p === 100 ? 'full' : ''}" style="width:${p}%"></div></div>`;
}

// ── inicio ──
function viewHome() {
  const w = S.session?.role === 'worker' ? S.workers.find((x) => x.id === S.session.workerId) : null;
  return `
    ${demoBanner()}
    <div class="page narrow home">
      <div class="hero"><div class="hero-icon">🍦</div><h1>Checklist Heladería</h1><p class="muted">${esc(fmtDate(today()))}</p></div>
      ${w ? `<a class="big-btn" href="#/turno">Continuar como ${esc(w.name)}</a>` : ''}
      <a class="big-btn" href="#/equipo">👩‍🍳 Soy del equipo</a>
      <a class="big-btn alt" href="#/admin">📊 Administración</a>
    </div>`;
}

// ── PIN ──
function pinPad(title, subtitle, len = 4) {
  const dots = [...Array(len).keys()].map((i) => `<span class="dot ${i < S.ui.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return `
    <div class="pin">
      <h2>${title}</h2>
      <p class="muted">${subtitle}</p>
      <div class="dots ${S.ui.pinError ? 'shake' : ''}">${dots}</div>
      <p class="err">${S.ui.pinError ? 'PIN incorrecto' : '&nbsp;'}</p>
      <div class="keys">${keys.map((k) => (k ? `<button class="key" data-act="pin" data-k="${k}">${k}</button>` : '<span></span>')).join('')}</div>
    </div>`;
}

function viewPickWorker() {
  const w = S.ui.pickWorker && S.workers.find((x) => x.id === S.ui.pickWorker);
  if (w) {
    return `${topbar('Ingresar', '<button class="link" data-act="pick-back">Volver</button>')}
      <div class="page narrow">${pinPad(`Hola, ${esc(w.name)}`, 'Ingresa tu PIN', w.pinLength || 4)}</div>`;
  }
  const active = S.workers.filter((x) => x.active !== false && !x.noPhone);
  return `${topbar('¿Quién eres?')}
    ${demoBanner()}
    <div class="page narrow">
      ${active.length
        ? `<div class="grid-names">${active.map((x) => `<button class="name-btn" data-act="pick-worker" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`
        : `<div class="empty">Aún no hay trabajadores registrados.<br>Administración debe agregarlos en <b>Equipo</b>.</div>`}
    </div>`;
}

function viewAdminLogin() {
  if (S.mode === 'firebase') {
    return `${topbar('Administración')}
      <div class="page narrow">
        <div class="card center login">
          <div class="hero-icon">🔐</div>
          <h2>Administración</h2>
          ${S.owner
            ? '<p class="muted">Entra con la cuenta de Google de administración.</p>'
            : '<p>Primera vez: la cuenta de Google con la que entres ahora quedará como <b>única administradora</b> de la app.</p>'}
          <button class="btn primary block" data-act="google-login">${store.auth.isGoogle() ? `Continuar como ${esc(store.auth.name())}` : 'Entrar con Google'}</button>
        </div>
      </div>`;
  }
  return `${topbar('Administración')}
    <div class="page narrow">${pinPad('Administración', 'Ingresa el PIN de administración')}
    ${S.settings.adminPin === '1234' ? '<p class="muted center small">PIN inicial: 1234 (cámbialo en Ajustes)</p>' : ''}</div>`;
}

// ── vista trabajador ──
function groupBySection(items, render) {
  const groups = SECTIONS.map((s) => ({ s, items: items.filter((i) => i.section === s.id) })).filter((g) => g.items.length);
  const other = items.filter((i) => !SECTIONS.some((s) => s.id === i.section));
  if (other.length) groups.push({ s: { id: 'otras', name: 'Otras' }, items: other });
  return groups
    .map((g) => {
      const done = g.items.filter((i) => i.done).length;
      return `<section class="sec"><h3>${esc(g.s.name)} <span class="count">${done}/${g.items.length}</span></h3>${g.items.map(render).join('')}</section>`;
    })
    .join('');
}

// Quién hizo una tarea (y quién la marcó, si fue otra persona).
function whoDid(it) {
  if (!it?.done) return '';
  const by = wName(it.doneBy);
  return it.markedBy && it.markedBy !== it.doneBy ? `${by} (marcó ${wName(it.markedBy)})` : by;
}

// Checklists de turnos anteriores (ayer, o antes hoy y ya terminados).
function previousShifts(mine, t) {
  return S.checklists
    .filter((c) => c.id !== mine.id)
    .filter((c) => c.date < t || (c.date === t && (c.start || '') < (mine.start || '') && (c.closedAt || (c.end && c.end <= nowHM()))))
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}

// Fila de tarea con una casilla por persona (yo + compañeras sin celular).
function taskRow(row, cols, me) {
  const boxes = cols.map((col) => {
    const it = row.items[col.c.id];
    if (!it) return '<span class="box ghost"></span>';
    const canUndo = it.doneBy === col.id || it.doneBy === me || it.markedBy === me;
    const locked = col.c.closedAt || (it.done && !canUndo);
    return `<button class="box ${it.done ? 'on' : ''}" data-act="toggle" data-cl="${col.c.id}" data-task="${row.id}" data-as="${col.id}" ${locked ? 'disabled' : ''} title="${esc(col.label)}">${it.done ? '✓' : ''}</button>`;
  }).join('');
  const done = cols.some((col) => row.items[col.c.id]?.done);
  const first = cols.map((col) => row.items[col.c.id]).find((it) => it?.done);
  const mineIt = row.items[cols[0].c.id];
  const postponed = !done && mineIt?.postponed;
  const meta = [
    row.time ? `⏰ ${esc(row.time)}` : '',
    first ? `${fmtTime(first.doneAt)} · ${esc(whoDid(first))}` : '',
    postponed ? `📌 Pasa al ${esc(fmtShort(postponed.to))}${postponed.note ? ` · ${esc(postponed.note)}` : ''}` : '',
  ].filter(Boolean).join(' · ');
  const more = mineIt && !mineIt.done && !postponed && !cols[0].c.closedAt
    ? `<button class="more" data-act="item-menu" data-cl="${cols[0].c.id}" data-task="${row.id}" title="Más opciones">⋯</button>` : '';
  return `
    <div class="trow ${done ? 'done' : ''} ${postponed ? 'postponed' : ''}">
      <div class="boxes">${boxes}</div>
      <div class="txt">${esc(row.text)}${meta ? `<small>${meta}</small>` : ''}</div>
      ${more}
    </div>`;
}

function viewWorker() {
  if (S.session?.role !== 'worker') return viewPickWorker();
  const w = S.workers.find((x) => x.id === S.session.workerId);
  const head = topbar(w ? `Hola, ${esc(w.name)}` : 'Mi turno', '<button class="link" data-act="logout">Salir</button>');
  if (!w) return `${head}<div class="page narrow"><div class="empty">Cargando…</div></div>`;
  const t = today();
  useChecklists(addDays(t, -1), t);
  useCarry();
  if (!S.checklists) return `${head}<div class="page narrow"><div class="empty">Cargando…</div></div>`;
  const mine = S.checklists.find((c) => c.date === t && c.workerId === w.id);
  if (!mine) {
    return `${head}${demoBanner()}<div class="page narrow"><div class="empty">No tienes un turno asignado para hoy<br><b>${esc(fmtDate(t))}</b>.</div></div>`;
  }
  const me = w.id;
  const closed = !!mine.closedAt;
  const myItems = sortedItems(mine);
  const done = myItems.filter((i) => i.done).length;

  // Columnas: yo + compañeras sin celular que tienen turno hoy.
  const partners = S.checklists
    .filter((c) => c.date === t && c.workerId !== me && S.workers.find((x) => x.id === c.workerId)?.noPhone)
    .map((c) => ({ id: c.workerId, c, label: wName(c.workerId, c.workerName) }));
  const cols = [{ id: me, c: mine, label: 'Yo' }, ...partners];
  const rowsById = new Map();
  for (const col of cols) {
    for (const it of sortedItems(col.c)) {
      const row = rowsById.get(it.id) || { id: it.id, text: it.text, section: it.section, order: it.order, time: it.time, items: {} };
      row.items[col.c.id] = it;
      rowsById.set(it.id, row);
    }
  }
  const rows = [...rowsById.values()].map((r) => ({ ...r, done: cols.some((col) => r.items[col.c.id]?.done) }));
  rows.sort((a, b) => sectionIdx(a.section) - sectionIdx(b.section) || (a.order || 0) - (b.order || 0));

  const wd = parseYmd(t).getDay();
  const reminders = S.tasks.filter((x) => INFO_SECTIONS.includes(x.section) && x.active !== false && (x.days || ALL_DAYS).includes(wd));

  const carry = S.carry.filter((x) => x.toDate <= t);
  const prev = previousShifts(mine, t);
  const prevItems = prev.reduce((n, c) => n + sortedItems(c).length, 0);
  const prevPending = prev.reduce((n, c) => n + sortedItems(c).filter((i) => !i.done && !i.postponed).length, 0);
  const prevOpen = S.ui.expanded.has('prev');
  const notifAsk = 'Notification' in window && Notification.permission === 'default' && myItems.some((i) => i.time);

  return `${head}${demoBanner()}
    <div class="page narrow">
      <div class="card shift-head">
        <div><b>Turno ${esc(mine.shiftName)}</b> · ${esc(mine.start || '')}–${esc(mine.end || '')}</div>
        <div class="muted small">${esc(fmtDate(t))}${partners.length ? ` · con ${partners.map((p) => esc(p.label)).join(', ')} (sin celular)` : ''}</div>
        ${progressBar(done, myItems.length)}
        <div class="small">${done} de ${myItems.length} tareas · ${pct(done, myItems.length)}%</div>
        ${closed ? `<div class="chip ok">Turno terminado a las ${fmtTime(mine.closedAt)}</div>` : ''}
      </div>

      ${notifAsk ? '<button class="btn block" data-act="notif">🔔 Activar alarmas de tareas con hora</button>' : ''}

      <details class="card normas"><summary>📋 Normas</summary><ul>${NORMAS.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>
      ${reminders.length ? `<details class="card normas"><summary>🔁 Durante el día (recordatorios)</summary><ul>${reminders.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul></details>` : ''}

      ${carry.length ? `
        <div class="card carry">
          <h3>📌 Pendientes que quedaron para hoy</h3>
          ${carry.map((x) => `
            <div class="trow">
              <div class="boxes"><button class="box" data-act="carry-done" data-id="${x.id}" ${closed ? 'disabled' : ''}></button></div>
              <div class="txt">${esc(x.text)}<small>Desde el ${esc(fmtShort(x.fromDate))} · ${esc(wName(x.by))}${x.note ? ` · “${esc(x.note)}”` : ''}</small></div>
              ${closed ? '' : `<button class="more" data-act="carry-menu" data-id="${x.id}" title="Más opciones">⋯</button>`}
            </div>`).join('')}
        </div>` : ''}

      ${prevItems ? `
        <div class="card prev">
          <button class="prev-head" data-act="expand" data-id="prev">
            <span>🔎 Revisar turno anterior ${prevPending ? `<span class="badge">${prevPending} sin hacer</span>` : ''}</span><span>${prevOpen ? '▲' : '▼'}</span>
          </button>
          ${prevOpen ? `<p class="muted small">Si una tarea quedó sin hacer y la hiciste tú, presiona <b>Lo hice</b>. Si quedó mal hecha (ej. el agua quedó corriendo), presiona <b>Reportar</b>. Administración recibe un aviso.</p>
            ${prev.map((c) => `
              <div class="prev-group">
                <div class="prev-who">${esc(wName(c.workerId, c.workerName))} · ${esc(c.shiftName)} · ${esc(fmtShort(c.date))}</div>
                ${sortedItems(c).map((it) => `
                  <div class="prow ${it.done ? 'done' : ''}">
                    <span>${it.reported ? '⚠️' : it.done ? '✅' : it.postponed ? '📌' : '⬜'}</span>
                    <div class="txt">${esc(it.text)}<small>${it.reported ? `Reportado por ${esc(wName(it.reported.by))}${it.reported.note ? `: “${esc(it.reported.note)}”` : ''}` : it.done ? esc(whoDid(it)) : it.postponed ? `Pasa al ${esc(fmtShort(it.postponed.to))}` : 'Sin hacer'}</small></div>
                    <div class="pbtns">
                      ${!it.done && !it.postponed ? `<button class="btn small" data-act="cover" data-cl="${c.id}" data-task="${it.id}">Lo hice</button>` : ''}
                      ${it.reported ? '' : `<button class="btn small danger" data-act="report-item" data-cl="${c.id}" data-task="${it.id}">Reportar</button>`}
                    </div>
                  </div>`).join('')}
              </div>`).join('')}` : ''}
        </div>` : ''}

      ${partners.length ? `<div class="cols-head"><div class="boxes">${cols.map((c) => `<span>${esc(c.label)}</span>`).join('')}</div><div class="small muted">Marca en la columna de quien hizo la tarea</div></div>` : ''}
      ${groupBySection(rows, (r) => taskRow(r, cols, me))}

      ${closed ? '' : `<button class="btn block primary" data-act="finish" data-cl="${mine.id}">Terminar mi turno</button>`}
      ${partners.filter((p) => !p.c.closedAt).map((p) => `<button class="btn block" data-act="finish" data-cl="${p.c.id}">Terminar turno de ${esc(p.label)}</button>`).join('')}
    </div>`;
}

// ── administración ──
const TABS = [
  ['vivo', 'En vivo'],
  ['turnos', 'Turnos'],
  ['reportes', 'Reportes'],
  ['tareas', 'Tareas'],
  ['equipo', 'Equipo'],
  ['ajustes', 'Ajustes'],
];

function viewAdmin(tab) {
  const unread = S.alerts.filter((a) => !a.read).length;
  const right = `<a class="bell" href="#/admin/vivo" title="Avisos">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</a><button class="link" data-act="logout">Salir</button>`;
  const nav = `<nav class="tabs">${TABS.map(([id, n]) => `<a href="#/admin/${id}" class="${id === tab ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
  const body = { vivo: adminLive, turnos: adminShifts, reportes: adminReports, tareas: adminTasks, equipo: adminTeam, ajustes: adminSettings }[tab] || adminLive;
  return `${topbar('Administración', right)}${nav}${demoBanner()}<div class="page">${body()}</div>`;
}

function statusOf(c) {
  if (c.closedAt) return ['Terminado', 'ok'];
  if (c.end && c.date === today() && c.end < nowHM()) return ['Fuera de horario', 'bad'];
  if (c.startedAt) return ['En curso', 'live'];
  return ['Sin iniciar', ''];
}

// Cuántas tareas distintas hizo cada persona (las compartidas cuentan una vez).
function tasksDoneBy(cls) {
  const sets = {};
  for (const c of cls) for (const it of sortedItems(c)) if (it.done && it.doneBy) (sets[it.doneBy] ||= new Set()).add(`${c.date}|${it.id}`);
  return Object.entries(sets).map(([id, set]) => ({ id, n: set.size })).sort((a, b) => b.n - a.n);
}

function itemDetail(it) {
  const icon = it.reported ? '⚠️' : it.done ? '✅' : it.postponed ? '📌' : '⬜';
  const meta = [
    it.done ? `${fmtTime(it.doneAt)} · ${whoDid(it)}` : '',
    it.postponed && !it.done ? `pasa al ${fmtShort(it.postponed.to)}${it.postponed.note ? ` · ${it.postponed.note}` : ''}` : '',
    it.reported ? `reportada por ${wName(it.reported.by)}${it.reported.note ? `: “${it.reported.note}”` : ''}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="drow ${it.done ? 'done' : ''}"><span>${icon}</span><span>${esc(it.text)}</span><span class="muted small">${esc(meta)}</span></div>`;
}

function adminLive() {
  const t = today();
  useChecklists(addDays(t, -1), t);
  useCarry();
  const unread = S.alerts.filter((a) => !a.read);
  const shown = S.ui.showAllAlerts ? S.alerts.slice(0, 50) : unread;
  const alertsHtml = `
    <div class="card">
      <div class="row-between"><h3>🔔 Avisos ${unread.length ? `<span class="badge">${unread.length}</span>` : ''}</h3>
        <div>${unread.length ? '<button class="link" data-act="alerts-read-all">Marcar leídos</button>' : ''}
        <button class="link" data-act="alerts-toggle">${S.ui.showAllAlerts ? 'Solo nuevos' : 'Ver historial'}</button></div></div>
      ${shown.length
        ? shown.map((a) => `<div class="alert ${a.read ? 'read' : ''}"><div>${esc(alertText(a))}<div class="muted small">${fmtShort(ymd(new Date(a.at)))} ${fmtTime(a.at)}</div></div>${a.read ? '' : `<button class="link" data-act="alert-read" data-id="${a.id}">OK</button>`}</div>`).join('')
        : '<p class="muted small">Sin avisos nuevos.</p>'}
    </div>`;
  if (!S.checklists) return alertsHtml + '<div class="empty">Cargando…</div>';
  const todays = S.checklists.filter((c) => c.date === t).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const cards = todays.map((c) => {
    const items = sortedItems(c);
    const done = items.filter((i) => i.done).length;
    const [st, cls] = statusOf(c);
    const open = S.ui.expanded.has(c.id);
    return `
      <div class="card live-card">
        <button class="live-head" data-act="expand" data-id="${c.id}">
          <div><b>${esc(wName(c.workerId, c.workerName))}</b> <span class="muted">· ${esc(c.shiftName)} ${esc(c.start || '')}–${esc(c.end || '')}</span></div>
          <span class="chip ${cls}">${st}</span>
        </button>
        ${progressBar(done, items.length)}
        <div class="row-between small"><span>${done}/${items.length} · ${pct(done, items.length)}%</span><span class="muted">${c.lastActivity ? `Última marca ${fmtTime(c.lastActivity)}` : ''}</span></div>
        ${open ? `<div class="detail">${groupBySection(items, itemDetail)}
          ${c.closedAt ? `<button class="btn small" data-act="reopen" data-cl="${c.id}">Reabrir turno</button>` : ''}</div>` : ''}
      </div>`;
  });
  const reparto = tasksDoneBy(todays);
  const carry = S.carry;
  return `${alertsHtml}<h2>Hoy · ${esc(fmtDate(t))}</h2>
    ${reparto.length ? `<div class="card"><h3>👥 Quién hizo las tareas hoy</h3>${reparto.map((r) => `<div class="dbar"><span class="dlabel">${esc(wName(r.id))}</span>${progressBar(r.n, reparto[0].n)}<span class="dval">${r.n}</span></div>`).join('')}</div>` : ''}
    ${cards.length ? cards.join('') : '<div class="empty">No hay turnos asignados hoy. Asígnalos en <a href="#/admin/turnos">Turnos</a>.</div>'}
    ${carry.length ? `<h3>📌 Pendientes postergados</h3><div class="card">${carry.map((x) => `<div class="drow"><span>📌</span><span>${esc(x.text)}</span><span class="muted small">del ${esc(fmtShort(x.fromDate))} → ${esc(fmtShort(x.toDate))} · ${esc(wName(x.by))}${x.note ? ` · “${esc(x.note)}”` : ''}</span></div>`).join('')}</div>` : ''}`;
}

function adminShifts() {
  const ws = S.ui.weekStart || weekStartOf(today());
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));
  useChecklists(ws, days[6]);
  const t = today();
  const byKey = new Map((S.checklists || []).map((c) => [c.id, c]));
  const workers = S.workers.filter((w) => w.active !== false || (S.checklists || []).some((c) => c.workerId === w.id));
  const opts = (sel) => `<option value="">—</option>${S.shiftTypes.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
  const grid = !S.checklists
    ? '<div class="empty">Cargando…</div>'
    : !workers.length
      ? '<div class="empty">Primero agrega trabajadores en <a href="#/admin/equipo">Equipo</a>.</div>'
      : `<div class="table-wrap"><table class="week">
          <thead><tr><th></th>${days.map((d) => `<th class="${d === t ? 'today' : ''}">${DAY_SHORT[parseYmd(d).getDay()]}<br><span class="small">${parseYmd(d).getDate()}</span></th>`).join('')}</tr></thead>
          <tbody>${workers.map((w) => `<tr><th class="wname">${esc(w.name)}</th>${days.map((d) => {
            const c = byKey.get(`${d}_${w.id}`);
            const its = c ? sortedItems(c) : [];
            const done = its.filter((i) => i.done).length;
            return `<td class="${d === t ? 'today' : ''}"><select data-change="assign" data-w="${w.id}" data-d="${d}">${opts(c?.shiftTypeId)}</select>${c && d <= t ? `<div class="mini ${pct(done, its.length) === 100 ? 'ok' : ''}">${pct(done, its.length)}%</div>` : ''}</td>`;
          }).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `
    <div class="row-between wrap">
      <h2>Semana del ${esc(fmtShort(ws))}</h2>
      <div class="btn-row">
        <button class="btn small" data-act="week" data-n="-7">‹</button>
        <button class="btn small" data-act="week" data-n="0">Esta semana</button>
        <button class="btn small" data-act="week" data-n="7">›</button>
      </div>
    </div>
    <p class="muted small">Elige el turno de cada persona por día. Su checklist se crea automáticamente con las tareas que correspondan al turno y al día.</p>
    ${grid}
    <button class="btn small" data-act="copy-week">Copiar turnos de la semana anterior</button>

    <h2>Tipos de turno</h2>
    <div class="card list">
      ${S.shiftTypes.map((s) => `<button class="list-row" data-act="edit-shift" data-id="${s.id}"><div><b>${esc(s.name)}</b> <span class="muted">${esc(s.start)}–${esc(s.end)}</span><div class="small muted">${(s.sections || []).map(sectionName).join(' · ')}</div></div><span>✎</span></button>`).join('')}
      <button class="list-row add" data-act="edit-shift">＋ Nuevo tipo de turno</button>
    </div>`;
}

function adminTasks() {
  const groups = SECTIONS.map((s) => {
    const ts = S.tasks.filter((t) => t.section === s.id);
    return `
      <h3>${esc(s.name)} <span class="count">${ts.length}</span></h3>
      ${s.info ? '<p class="small muted">Recordatorios: se muestran como lista desplegable y no se marcan.</p>' : ''}
      <div class="card list">
        ${ts.map((t) => {
          const days = t.days && t.days.length < 7 ? t.days.map((d) => DAY_NAMES[d]).join(', ') : '';
          return `<button class="list-row ${t.active === false ? 'inactive' : ''}" data-act="edit-task" data-id="${t.id}"><div>${esc(t.text)}${days ? `<div class="small muted">Solo: ${esc(days)}</div>` : ''}${t.time ? `<div class="small muted">⏰ ${esc(t.time)} (alarma 15 min antes y a la hora)</div>` : ''}${!s.info && isShared(t) ? '<div class="small muted">👥 Compartida</div>' : ''}${t.active === false ? '<div class="small muted">Desactivada</div>' : ''}</div><span>✎</span></button>`;
        }).join('')}
        <button class="list-row add" data-act="edit-task" data-section="${s.id}">＋ Agregar tarea</button>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <p class="small">Los cambios en tareas se aplican a los turnos que asignes desde ahora. Para actualizar los turnos ya asignados (de hoy en adelante), usa este botón. Lo ya marcado se conserva.</p>
      <button class="btn small" data-act="apply-tasks">Aplicar cambios a turnos de hoy en adelante</button>
    </div>
    ${groups}`;
}

function adminTeam() {
  const url = location.href.split('#')[0];
  return `
    <div class="card">
      <h3>Link para el equipo</h3>
      <p class="small">Envía este link por WhatsApp. Cada persona lo abre en su celular, elige su nombre e ingresa su PIN. Pueden “Agregar a pantalla de inicio” para usarlo como app.</p>
      <div class="copy"><code>${esc(url)}</code><button class="btn small" data-act="share" data-url="${esc(url)}">Copiar / compartir</button></div>
    </div>
    <h2>Equipo</h2>
    <div class="card list">
      ${S.workers.map((w) => `<button class="list-row ${w.active === false ? 'inactive' : ''}" data-act="edit-worker" data-id="${w.id}"><div><b>${esc(w.name)}</b><div class="small muted">PIN ${esc(S.pins[w.id] ?? '··')}${w.noPhone ? ' · 📵 Sin celular' : ''}${w.active === false ? ' · Inactivo' : ''}</div></div><span>✎</span></button>`).join('')}
      <button class="list-row add" data-act="edit-worker">＋ Agregar persona</button>
    </div>`;
}

function adminSettings() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
    <div class="card">
      <h3>Notificaciones</h3>
      <p class="small">Recibirás un aviso (sonido + notificación) cuando alguien marque una tarea pendiente de otro turno o termine su turno con tareas sin hacer. Funciona mientras tengas la app abierta en tu celular o computador (puede estar en segundo plano).</p>
      ${perm === 'granted' ? '<div class="chip ok">Notificaciones activadas</div>'
        : perm === 'unsupported' ? '<div class="chip">Este navegador no soporta notificaciones</div>'
        : `<button class="btn small" data-act="notif">Activar notificaciones</button>${perm === 'denied' ? '<p class="small err">Están bloqueadas: habilítalas en la configuración del navegador.</p>' : ''}`}
    </div>
    ${S.mode === 'demo' ? `<div class="card">
      <h3>PIN de administración</h3>
      <button class="btn small" data-act="admin-pin">Cambiar PIN</button>
    </div>` : `<div class="card"><h3>Cuenta de administración</h3><p class="small">${esc(store.auth.name())} (Google)</p></div>`}
    <div class="card">
      <h3>Datos</h3>
      <p class="small">Modo: <b>${S.mode === 'firebase' ? 'Firebase (compartido en tiempo real)' : 'Demo (solo este dispositivo)'}</b></p>
      <div class="btn-row">
        <button class="btn small" data-act="backup">Descargar respaldo</button>
        ${S.mode === 'demo' ? '<button class="btn small danger" data-act="reset-demo">Borrar datos demo</button>' : ''}
      </div>
    </div>`;
}

// ── reportes ──
function reportRange(preset) {
  const t = today();
  const ws = weekStartOf(t);
  const d = parseYmd(t);
  switch (preset) {
    case 'hoy': return [t, t];
    case 'ayer': return [addDays(t, -1), addDays(t, -1)];
    case 'semana': return [ws, addDays(ws, 6)];
    case 'semana-ant': return [addDays(ws, -7), addDays(ws, -1)];
    case 'mes': return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    default: return [S.ui.report?.from || ws, S.ui.report?.to || t];
  }
}

async function loadReport(preset, from, to) {
  if (!from) [from, to] = reportRange(preset);
  S.ui.report = { preset, from, to, data: null };
  render();
  try {
    const cls = await store.list('checklists', [['date', '>=', from], ['date', '<=', to]]);
    if (S.ui.report?.from !== from || S.ui.report?.to !== to) return;
    S.ui.report.data = computeReport(cls.filter((c) => c.date <= today()));
  } catch (e) {
    S.ui.report.data = { error: String(e.message || e) };
  }
  render();
}

function computeReport(cls) {
  const t = today();
  const per = {};
  const ensure = (id, name) => per[id] || (per[id] = { id, name, shifts: 0, total: 0, done: 0, coveredByOthers: 0, missed: 0, pending: 0, coveredOthers: 0, reported: 0, postponed: 0, did: 0 });
  const byDay = {};
  const missedTasks = {};
  const missedList = [];
  const covers = [];
  const reports = [];
  const postponedList = [];
  for (const c of cls) {
    const s = ensure(c.workerId, c.workerName);
    s.shifts++;
    const day = byDay[c.date] || (byDay[c.date] = { total: 0, done: 0 });
    const open = c.date === t && !c.closedAt;
    for (const it of sortedItems(c)) {
      if (it.postponed && !it.done) {
        s.postponed++;
        postponedList.push({ date: c.date, workerId: c.workerId, workerName: c.workerName, text: it.text, ...it.postponed });
        continue;
      }
      s.total++;
      day.total++;
      if (it.reported) {
        s.reported++;
        reports.push({ date: c.date, workerId: c.workerId, workerName: c.workerName, shift: c.shiftName, text: it.text, checkedBy: it.done ? it.doneBy : null, ...it.reported });
      } else if (it.done) {
        if (it.doneBy && it.doneBy !== c.workerId && (it.covered || !it.shared)) {
          s.coveredByOthers++;
          ensure(it.doneBy).coveredOthers++;
          covers.push({ date: c.date, text: it.text, owner: c.workerId, ownerName: c.workerName, by: it.doneBy, at: it.doneAt });
        } else {
          s.done++;
          day.done++;
        }
      } else if (open) {
        s.pending++;
      } else {
        s.missed++;
        missedTasks[it.text] = (missedTasks[it.text] || 0) + 1;
        missedList.push({ date: c.date, workerId: c.workerId, workerName: c.workerName, shift: c.shiftName, text: it.text, section: it.section });
      }
    }
  }
  const total = Object.values(per).reduce((a, s) => ({ total: a.total + s.total, done: a.done + s.done, missed: a.missed + s.missed, covered: a.covered + s.coveredByOthers }), { total: 0, done: 0, missed: 0, covered: 0 });
  for (const { id, n } of tasksDoneBy(cls)) ensure(id).did = n;
  total.reported = reports.length;
  return { cls, per: Object.values(per).filter((s) => s.shifts || s.coveredOthers), byDay, missedTasks, missedList, covers, reports, postponedList, total };
}

function adminReports() {
  const r = S.ui.report;
  if (!r) { setTimeout(() => loadReport('semana'), 0); return '<div class="empty">Cargando…</div>'; }
  const presets = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['semana-ant', 'Semana pasada'], ['mes', 'Este mes']];
  const head = `
    <div class="chips">${presets.map(([id, n]) => `<button class="chip-btn ${r.preset === id ? 'on' : ''}" data-act="report" data-preset="${id}">${n}</button>`).join('')}</div>
    <div class="range"><label>Desde <input type="date" data-change="report-range" data-k="from" value="${r.from}"></label><label>Hasta <input type="date" data-change="report-range" data-k="to" value="${r.to}"></label></div>`;
  const d = r.data;
  if (!d) return head + '<div class="empty">Calculando…</div>';
  if (d.error) return head + `<div class="empty err">${esc(d.error)}</div>`;
  if (!d.cls.length) return head + '<div class="empty">No hay turnos en este período.</div>';

  const rows = d.per.sort((a, b) => pct(b.done, b.total) - pct(a.done, a.total)).map((s) => `
    <tr><td><b>${esc(wName(s.id, s.name))}</b></td><td>${s.shifts}</td>
    <td class="pctcell">${progressBar(s.done, s.total)}<span>${pct(s.done, s.total)}%</span></td>
    <td class="${s.missed ? 'bad-t' : ''}">${s.missed}</td><td class="${s.reported ? 'bad-t' : ''}">${s.reported}</td><td>${s.postponed}</td><td><b>${s.did}</b></td><td>${s.coveredByOthers}</td><td>${s.coveredOthers}</td>${s.pending ? `<td class="muted">${s.pending} en curso</td>` : '<td></td>'}</tr>`).join('');

  const dayBars = Object.entries(d.byDay).sort().map(([date, v]) => `
    <div class="dbar"><span class="dlabel">${esc(fmtShort(date))}</span>${progressBar(v.done, v.total)}<span class="dval">${pct(v.done, v.total)}%</span></div>`).join('');

  const top = Object.entries(d.missedTasks).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const missedByDate = {};
  d.missedList.forEach((m) => (missedByDate[m.date] ||= []).push(m));

  return `${head}
    <div class="stats">
      <div class="stat"><div class="sv">${d.cls.length}</div><div class="sl">Turnos</div></div>
      <div class="stat"><div class="sv">${pct(d.total.done, d.total.total)}%</div><div class="sl">Cumplimiento</div></div>
      <div class="stat"><div class="sv ${d.total.missed ? 'bad-t' : ''}">${d.total.missed}</div><div class="sl">No hechas</div></div>
      <div class="stat"><div class="sv">${d.total.covered}</div><div class="sl">Cubiertas por otro</div></div>
      <div class="stat"><div class="sv ${d.total.reported ? 'bad-t' : ''}">${d.total.reported}</div><div class="sl">Reportadas</div></div>
    </div>

    <h3>Por persona</h3>
    <div class="table-wrap card"><table class="rep">
      <thead><tr><th>Persona</th><th>Turnos</th><th>Cumplimiento</th><th>No hechas</th><th>Reportadas</th><th>Postergadas</th><th>Tareas que hizo</th><th>Se las cubrieron</th><th>Cubrió a otros</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="small muted">“Tareas que hizo” cuenta cada tarea una sola vez aunque sea compartida: sirve para ver quién trabajó más en un turno compartido.</p>

    <h3>Cumplimiento por día</h3>
    <div class="card">${dayBars}</div>

    ${top.length ? `<h3>Tareas que más se olvidan</h3><div class="card list">${top.map(([text, n]) => `<div class="list-row static"><div>${esc(text)}</div><span class="badge">${n}</span></div>`).join('')}</div>` : ''}

    ${d.missedList.length ? `<h3>Detalle de tareas no hechas</h3>
      ${Object.entries(missedByDate).sort().reverse().map(([date, ms]) => `<div class="card"><b>${esc(fmtDate(date))}</b>${ms.map((m) => `<div class="drow"><span>❌</span><span>${esc(m.text)}</span><span class="muted small">${esc(wName(m.workerId, m.workerName))} · ${esc(m.shift)}</span></div>`).join('')}</div>`).join('')}` : ''}

    ${d.reports.length ? `<h3>⚠️ Reportadas por el turno siguiente</h3><div class="card">${d.reports.map((r) => `<div class="drow"><span>⚠️</span><span>${esc(r.text)}${r.note ? ` — “${esc(r.note)}”` : ''}</span><span class="muted small">${esc(fmtShort(r.date))} · turno de ${esc(wName(r.workerId, r.workerName))}${r.checkedBy ? ` · marcada por ${esc(wName(r.checkedBy))}` : ''} · reportó ${esc(wName(r.by))}</span></div>`).join('')}</div>` : ''}

    ${d.postponedList.length ? `<h3>📌 Postergadas</h3><div class="card">${d.postponedList.map((r) => `<div class="drow"><span>📌</span><span>${esc(r.text)}${r.note ? ` — “${esc(r.note)}”` : ''}</span><span class="muted small">${esc(fmtShort(r.date))} → ${esc(fmtShort(r.to))} · ${esc(wName(r.by))}</span></div>`).join('')}</div>` : ''}

    ${d.covers.length ? `<h3>Tareas cubiertas por otra persona</h3><div class="card">${d.covers.map((c) => `<div class="drow"><span>🔁</span><span>${esc(c.text)}</span><span class="muted small">de ${esc(wName(c.owner, c.ownerName))} → hecha por ${esc(wName(c.by))} · ${esc(fmtShort(c.date))}</span></div>`).join('')}</div>` : ''}

    <button class="btn" data-act="csv">Descargar Excel (CSV)</button>`;
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ───────────────────────── modales ─────────────────────────

function openModal(title, body, { onSubmit, onDelete, submitLabel = 'Guardar' } = {}) {
  S.modal = { onSubmit, onDelete };
  $modal.innerHTML = `
    <div class="backdrop" data-act="close-modal"></div>
    <form class="sheet" id="modal-form">
      <div class="row-between"><h2>${title}</h2><button type="button" class="link" data-act="close-modal">✕</button></div>
      ${body}
      <div class="btn-row end">
        ${onDelete ? '<button type="button" class="btn danger" data-act="modal-delete">Eliminar</button>' : ''}
        <button type="submit" class="btn primary">${submitLabel}</button>
      </div>
    </form>`;
  $modal.classList.add('open');
  $modal.querySelector('input:not([type=checkbox]),textarea')?.focus();
}
function closeModal() {
  $modal.classList.remove('open');
  $modal.innerHTML = '';
  S.modal = null;
}

function editWorker(id) {
  const w = S.workers.find((x) => x.id === id) || { name: '', active: true };
  const curPin = id ? S.pins[id] ?? '' : String(Math.floor(10 + Math.random() * 90));
  openModal(id ? 'Editar persona' : 'Nueva persona', `
    <label>Nombre<input name="name" required maxlength="40" value="${esc(w.name)}"></label>
    <label>PIN (2 a 6 dígitos)<input name="pin" required inputmode="numeric" pattern="[0-9]{2,6}" maxlength="6" value="${esc(curPin)}"></label>
    <label class="check"><input type="checkbox" name="noPhone" ${w.noPhone ? 'checked' : ''}> Sin celular: sus compañeros marcan sus tareas en una columna extra</label>
    <label class="check"><input type="checkbox" name="active" ${w.active !== false ? 'checked' : ''}> Activo</label>`, {
    async onSubmit(f) {
      const name = f.get('name').trim();
      const pin = f.get('pin').trim();
      if (S.workers.some((x) => x.id !== id && x.active !== false && String(S.pins[x.id]) === pin)) return toast('Ese PIN ya lo usa otra persona', 'err');
      const wid = id || uid();
      await store.set('workerPins', wid, { pin });
      await store.set('workers', wid, { name, pinLength: pin.length, noPhone: f.get('noPhone') === 'on', active: f.get('active') === 'on' });
      closeModal();
    },
    onDelete: id && (async () => {
      if (!confirm(`¿Eliminar a ${w.name}? Su historial se conserva en los reportes. Si solo dejó de trabajar, mejor márcalo como inactivo.`)) return;
      await store.remove('workers', id);
      await store.remove('workerPins', id);
      closeModal();
    }),
  });
}

function editShift(id) {
  const s = S.shiftTypes.find((x) => x.id === id) || { name: '', start: '10:00', end: '15:00', sections: ['durante'] };
  openModal(id ? 'Editar turno' : 'Nuevo tipo de turno', `
    <label>Nombre<input name="name" required maxlength="30" value="${esc(s.name)}"></label>
    <div class="two"><label>Desde<input type="time" name="start" required value="${esc(s.start)}"></label><label>Hasta<input type="time" name="end" required value="${esc(s.end)}"></label></div>
    <fieldset><legend>Tareas que incluye</legend>
    ${SECTIONS.map((x) => `<label class="check"><input type="checkbox" name="sections" value="${x.id}" ${(s.sections || []).includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</fieldset>`, {
    async onSubmit(f) {
      const sections = f.getAll('sections');
      if (!sections.length) return toast('Elige al menos un grupo de tareas', 'err');
      await store.set('shiftTypes', id || uid(), { name: f.get('name').trim(), start: f.get('start'), end: f.get('end'), sections });
      closeModal();
    },
    onDelete: id && (async () => {
      if (!confirm(`¿Eliminar el turno «${s.name}»? Los turnos ya asignados no se borran.`)) return;
      await store.remove('shiftTypes', id);
      closeModal();
    }),
  });
}

function editTask(id, section) {
  const t = S.tasks.find((x) => x.id === id) || { text: '', section: section || 'apertura', days: ALL_DAYS, active: true };
  const days = t.days || ALL_DAYS;
  openModal(id ? 'Editar tarea' : 'Nueva tarea', `
    <label>Tarea<textarea name="text" required rows="3" maxlength="300">${esc(t.text)}</textarea></label>
    <label>Grupo<select name="section">${SECTIONS.map((x) => `<option value="${x.id}" ${x.id === t.section ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <fieldset><legend>Días</legend><div class="days">
    ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day"><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${DAY_SHORT[d]}</span></label>`).join('')}
    </div></fieldset>
    <label>Hora con alarma (opcional)<input type="time" name="time" value="${esc(t.time || '')}"></label>
    <p class="small muted">Si tiene hora, la tarea va a quien esté en turno a esa hora y suena una alarma 15 min antes y a la hora.</p>
    <label class="check"><input type="checkbox" name="shared" ${isShared(t) ? 'checked' : ''}> 👥 Compartida: si varias personas coinciden ese día, cuando una la marca queda lista para todas</label>
    <label class="check"><input type="checkbox" name="active" ${t.active !== false ? 'checked' : ''}> Activa</label>`, {
    async onSubmit(f) {
      const d = f.getAll('days').map(Number).sort();
      if (!d.length) return toast('Elige al menos un día', 'err');
      const sec = f.get('section');
      const order = id && t.section === sec ? t.order : Math.max(0, ...S.tasks.filter((x) => x.section === sec).map((x) => x.order || 0)) + 1;
      await store.set('tasks', id || uid(), { text: f.get('text').trim(), section: sec, days: d, order, time: f.get('time') || null, shared: f.get('shared') === 'on', active: f.get('active') === 'on' });
      closeModal();
    },
    onDelete: id && (async () => {
      if (!confirm('¿Eliminar esta tarea?')) return;
      await store.remove('tasks', id);
      closeModal();
    }),
  });
}

function changeAdminPin() {
  openModal('Cambiar PIN de administración', `
    <label>Nuevo PIN (4 dígitos)<input name="pin" required inputmode="numeric" pattern="[0-9]{4}" maxlength="4"></label>`, {
    async onSubmit(f) {
      await store.update('settings', 'app', { adminPin: f.get('pin') });
      closeModal();
      toast('PIN actualizado');
    },
  });
}

// ───────────────────────── acciones ─────────────────────────

// Estado actual de una tarea compartida en otros turnos del mismo día (si alguien ya la hizo).
function sharedDoneElsewhere(date, tid, exceptId) {
  for (const c of S.checklists || []) {
    const it = c.date === date && c.id !== exceptId ? c.items?.[tid] : null;
    if (it?.shared && it.done) return it;
  }
  return null;
}

function buildItems(st, date, prev, selfId) {
  const wd = parseYmd(date).getDay();
  const out = {};
  S.tasks
    .filter((t) => t.active !== false && !INFO_SECTIONS.includes(t.section) && (t.days || ALL_DAYS).includes(wd))
    // Tareas con hora: van en los turnos que están trabajando a esa hora.
    .filter((t) => (t.time ? (st.start || '') <= t.time && t.time < (st.end || '') : (st.sections || []).includes(t.section)))
    .forEach((t) => {
      const shared = isShared(t);
      const p = prev?.[t.id]?.done ? prev[t.id] : shared ? sharedDoneElsewhere(date, t.id, selfId) : null;
      const prevIt = prev?.[t.id];
      out[t.id] = {
        text: t.text, section: t.section, order: t.order || 0, time: t.time || null, shared,
        done: !!p?.done, doneAt: p?.doneAt || null, doneBy: p?.doneBy || null, markedBy: p?.markedBy || null, covered: !!p?.covered,
        postponed: prevIt?.postponed || null, reported: prevIt?.reported || null,
      };
    });
  // Conserva tareas ya marcadas aunque hayan sido quitadas del turno.
  Object.entries(prev || {}).forEach(([k, p]) => { if (p.done && !out[k]) out[k] = p; });
  return out;
}

async function assign(workerId, date, shiftTypeId, existing) {
  const id = `${date}_${workerId}`;
  if (!shiftTypeId) {
    if (existing) {
      const n = sortedItems(existing).filter((i) => i.done).length;
      if (n && !confirm(`Este turno ya tiene ${n} tarea(s) marcadas. ¿Quitarlo igual?`)) return render();
      await store.remove('checklists', id);
    }
    return;
  }
  const st = S.shiftTypes.find((s) => s.id === shiftTypeId);
  const w = S.workers.find((x) => x.id === workerId);
  await store.set('checklists', id, {
    date,
    workerId,
    workerName: w?.name || existing?.workerName || '',
    shiftTypeId: st.id,
    shiftName: st.name,
    start: st.start,
    end: st.end,
    items: buildItems(st, date, existing?.items, id),
    createdAt: existing?.createdAt || Date.now(),
    startedAt: existing?.startedAt || null,
    lastActivity: existing?.lastActivity || null,
    closedAt: existing?.closedAt || null,
  });
}

function findChecklist(id) {
  return S.checklists?.find((c) => c.id === id);
}

async function workerLogin(w, pin) {
  let ok = false;
  if (w) {
    if (S.mode === 'demo') {
      ok = (await store.get('workerPins', w.id))?.pin === pin;
    } else {
      try {
        await store.set('sessions', store.auth.uid(), { workerId: w.id, pin, at: Date.now() });
        ok = true;
      } catch (e) {
        if (!isPermissionError(e)) throw e;
      }
    }
  }
  if (ok) {
    saveSession({ role: 'worker', workerId: w.id });
    return go('turno');
  }
  S.ui.pinError = true;
  render();
}

function markPatch(tid, done, by, now, covered = false, marker = by) {
  return {
    [`items.${tid}.done`]: done,
    [`items.${tid}.doneAt`]: done ? now : null,
    [`items.${tid}.doneBy`]: done ? by : null,
    [`items.${tid}.markedBy`]: done ? marker : null,
    [`items.${tid}.covered`]: done && covered,
  };
}

// Aplica un cambio a la misma tarea compartida en los demás turnos del mismo día.
async function applyShared(c, tid, patch) {
  for (const o of (S.checklists || []).filter((o) => o.id !== c.id && o.date === c.date && o.items?.[tid]?.shared)) {
    await store.update('checklists', o.id, patch);
  }
}

// Tarea compartida: replica la marca en los turnos del mismo día que tienen esa tarea.
async function syncShared(c, tid, done, by, now, covered = false, marker = by) {
  const others = (S.checklists || []).filter((o) => o.id !== c.id && o.date === c.date && o.items?.[tid]?.shared);
  for (const o of others) {
    const oi = o.items[tid];
    // Al desmarcar, solo se quita en los turnos donde la marca era de esta misma persona.
    if (done ? oi.done : !oi.done || oi.doneBy !== by) continue;
    await store.update('checklists', o.id, markPatch(tid, done, by, now, covered, marker));
  }
}

const ACTIONS = {
  pin(el) {
    const k = el.dataset.k;
    S.ui.pinError = false;
    const w = S.route.path === 'admin' ? null : S.workers.find((x) => x.id === S.ui.pickWorker);
    const len = w ? w.pinLength || 4 : 4;
    S.ui.pin = k === '⌫' ? S.ui.pin.slice(0, -1) : (S.ui.pin + k).slice(0, len);
    if (S.ui.pin.length === len) {
      const pin = S.ui.pin;
      S.ui.pin = '';
      if (S.route.path === 'admin') {
        if (pin === String(S.settings.adminPin || '1234')) {
          saveSession({ role: 'admin' });
          ensureAlerts();
        } else S.ui.pinError = true;
      } else {
        return workerLogin(w, pin);
      }
    }
    render();
  },
  'pick-worker'(el) { S.ui.pickWorker = el.dataset.id; S.ui.pin = ''; render(); },
  'pick-back'() { S.ui.pickWorker = null; render(); },
  async logout() {
    const role = S.session?.role;
    saveSession(null);
    stopAlerts();
    if (S.mode === 'firebase') {
      if (role === 'worker') await store.remove('sessions', store.auth.uid()).catch(() => {});
      if (store.auth.isGoogle()) await store.auth.anon();
      location.hash = '';
      return location.reload();
    }
    go('');
  },
  async 'google-login'() {
    if (!store.auth.isGoogle()) await store.auth.google();
    if (!store.auth.isGoogle()) return;
    S.owner = await store.get('settings', 'owner');
    if (!S.owner) {
      if (!confirm(`¿Registrar a ${store.auth.name()} como administradora de la app? Solo esta cuenta podrá administrar.`)) return store.auth.anon();
      await store.set('settings', 'owner', { uid: store.auth.uid(), at: Date.now() });
      S.owner = await store.get('settings', 'owner');
      await seedDefaults();
    }
    if (!isOwner()) {
      await store.auth.anon();
      return toast('Esta cuenta de Google no es la administradora de la app.', 'err');
    }
    saveSession({ role: 'admin' });
    location.reload();
  },
  expand(el) {
    const id = el.dataset.id;
    S.ui.expanded.has(id) ? S.ui.expanded.delete(id) : S.ui.expanded.add(id);
    render();
  },
  async toggle(el) {
    const c = findChecklist(el.dataset.cl);
    const tid = el.dataset.task;
    if (!c || c.closedAt) return;
    const it = c.items[tid];
    const me = S.session.workerId;
    const as = el.dataset.as || me;
    const done = !it.done;
    const now = Date.now();
    await store.update('checklists', c.id, {
      ...markPatch(tid, done, as, now, false, me),
      [`items.${tid}.postponed`]: null,
      lastActivity: now,
      startedAt: c.startedAt || now,
    });
    if (it.shared) await syncShared(c, tid, done, as, now, false, me);
    // Si estaba postergada y al final se hizo, se cierra el pendiente.
    if (done && it.postponed) await store.update('carry', `${c.date}_${tid}`, { done: true, doneBy: as, doneAt: now, markedBy: me }).catch(() => {});
  },
  async cover(el) {
    const c = findChecklist(el.dataset.cl);
    const tid = el.dataset.task;
    if (!c) return;
    const it = c.items[tid];
    if (it.done) return;
    const owner = wName(c.workerId, c.workerName);
    if (!confirm(`¿Confirmas que hiciste «${it.text}», que quedó pendiente del turno de ${owner}?`)) return;
    const me = S.session.workerId;
    const now = Date.now();
    await store.update('checklists', c.id, { ...markPatch(tid, true, me, now, true), [`items.${tid}.postponed`]: null });
    if (it.shared) await syncShared(c, tid, true, me, now, true);
    await store.set('alerts', uid(), {
      type: 'cubierta', at: now, date: c.date, read: false, text: it.text, taskId: tid, checklistId: c.id,
      byWorkerId: me, byName: wName(me), forWorkerId: c.workerId, forName: owner,
    });
    toast('Listo, se avisó a administración');
  },
  async finish(el) {
    const c = findChecklist(el.dataset.cl);
    if (!c) return;
    const pending = sortedItems(c).filter((i) => !i.done && !i.postponed);
    const whose = c.workerId === S.session.workerId ? 'el turno' : `el turno de ${wName(c.workerId)}`;
    if (pending.length && !confirm(`Quedan ${pending.length} tarea(s) sin marcar. ¿Terminar ${whose} igual? Se avisará a administración.`)) return;
    if (!pending.length && !confirm(`¿Terminar ${whose}?`)) return;
    const now = Date.now();
    await store.update('checklists', c.id, { closedAt: now, lastActivity: now, startedAt: c.startedAt || now });
    if (pending.length) {
      await store.set('alerts', uid(), {
        type: 'incompleto', at: now, date: c.date, read: false, checklistId: c.id, count: pending.length, byWorkerId: S.session.workerId,
        forWorkerId: c.workerId, forName: wName(c.workerId, c.workerName), tasks: pending.map((p) => p.text),
      });
    }
    toast('¡Turno terminado! Gracias 🍦');
  },
  'item-menu'(el) {
    const c = findChecklist(el.dataset.cl);
    const it = c?.items[el.dataset.task];
    if (!it) return;
    const tomorrow = addDays(c.date, 1);
    openModal('Dejar para otro día', `
      <p>${esc(it.text)}</p>
      <p class="small muted">Si no alcanzaste a hacerla (o la hiciste a medias), déjala pendiente: aparecerá a quien tenga turno ese día.</p>
      <label>Para el día<input type="date" name="to" required min="${tomorrow}" value="${tomorrow}"></label>
      <label>Nota (opcional)<textarea name="note" rows="2" maxlength="200" placeholder="Ej: se limpió 1 de los 3 refris"></textarea></label>`, {
      submitLabel: 'Dejar pendiente',
      async onSubmit(f) {
        const me = S.session.workerId;
        const now = Date.now();
        const to = f.get('to');
        const note = f.get('note').trim();
        const postponed = { to, by: me, at: now, note };
        await store.update('checklists', c.id, { [`items.${el.dataset.task}.postponed`]: postponed, lastActivity: now });
        if (it.shared) await applyShared(c, el.dataset.task, { [`items.${el.dataset.task}.postponed`]: postponed });
        await store.set('carry', `${c.date}_${el.dataset.task}`, {
          taskId: el.dataset.task, text: it.text, section: it.section, fromDate: c.date, fromChecklistId: c.id,
          toDate: to, note, by: me, at: now, done: false, doneBy: null, doneAt: null, markedBy: null,
        });
        await store.set('alerts', uid(), { type: 'postergada', at: now, date: c.date, read: false, text: it.text, toDate: to, note, byWorkerId: me, byName: wName(me) });
        closeModal();
        toast('Quedó pendiente para el ' + fmtShort(to));
      },
    });
  },
  async 'carry-done'(el) {
    const x = S.carry.find((y) => y.id === el.dataset.id);
    if (!x || !confirm(`¿Marcar como hecha «${x.text}»?`)) return;
    const me = S.session.workerId;
    await store.update('carry', x.id, { done: true, doneBy: me, doneAt: Date.now(), markedBy: me });
    toast('¡Listo!');
  },
  'carry-menu'(el) {
    const x = S.carry.find((y) => y.id === el.dataset.id);
    if (!x) return;
    const tomorrow = addDays(today(), 1);
    openModal('Volver a dejar pendiente', `
      <p>${esc(x.text)}</p>
      <label>Para el día<input type="date" name="to" required min="${tomorrow}" value="${tomorrow}"></label>
      <label>Nota (opcional)<textarea name="note" rows="2" maxlength="200">${esc(x.note || '')}</textarea></label>`, {
      submitLabel: 'Dejar pendiente',
      async onSubmit(f) {
        await store.update('carry', x.id, { toDate: f.get('to'), note: f.get('note').trim() });
        closeModal();
      },
    });
  },
  'report-item'(el) {
    const c = findChecklist(el.dataset.cl);
    const tid = el.dataset.task;
    const it = c?.items[tid];
    if (!it) return;
    openModal('Reportar tarea', `
      <p><b>${esc(it.text)}</b><br><span class="small muted">Turno de ${esc(wName(c.workerId, c.workerName))} · ${esc(fmtShort(c.date))}${it.done ? ` · marcada por ${esc(whoDid(it))}` : ''}</span></p>
      <label>¿Qué encontraste?<textarea name="note" rows="3" maxlength="300" placeholder="Ej: el agua quedó corriendo / no hicieron potes con las bachas"></textarea></label>`, {
      submitLabel: 'Reportar',
      async onSubmit(f) {
        const me = S.session.workerId;
        const now = Date.now();
        const reported = { by: me, at: now, note: f.get('note').trim() };
        await store.update('checklists', c.id, { [`items.${tid}.reported`]: reported });
        if (it.shared) await applyShared(c, tid, { [`items.${tid}.reported`]: reported });
        await store.set('alerts', uid(), {
          type: 'reporte', at: now, date: c.date, read: false, text: it.text, taskId: tid, checklistId: c.id, note: reported.note,
          byWorkerId: me, byName: wName(me), forWorkerId: c.workerId, forName: wName(c.workerId, c.workerName), checkedBy: it.done ? it.doneBy : null,
        });
        closeModal();
        toast('Reporte enviado a administración');
      },
    });
  },
  async reopen(el) {
    if (!confirm('¿Reabrir este turno para que se puedan seguir marcando tareas?')) return;
    await store.update('checklists', el.dataset.cl, { closedAt: null });
  },
  async 'alert-read'(el) { await store.update('alerts', el.dataset.id, { read: true }); },
  async 'alerts-read-all'() {
    for (const a of S.alerts.filter((x) => !x.read)) await store.update('alerts', a.id, { read: true });
  },
  'alerts-toggle'() { S.ui.showAllAlerts = !S.ui.showAllAlerts; render(); },
  week(el) {
    const n = Number(el.dataset.n);
    S.ui.weekStart = n === 0 ? weekStartOf(today()) : addDays(S.ui.weekStart || weekStartOf(today()), n);
    render();
  },
  async 'copy-week'() {
    const ws = S.ui.weekStart || weekStartOf(today());
    const prev = await store.list('checklists', [['date', '>=', addDays(ws, -7)], ['date', '<=', addDays(ws, -1)]]);
    if (!prev.length) return toast('La semana anterior no tiene turnos', 'err');
    if (!confirm(`¿Copiar ${prev.length} turno(s) de la semana anterior a esta semana? No se modifican los que ya estén asignados.`)) return;
    const existing = new Set((S.checklists || []).map((c) => c.id));
    let n = 0;
    for (const c of prev) {
      const date = addDays(c.date, 7);
      if (existing.has(`${date}_${c.workerId}`) || !S.shiftTypes.some((s) => s.id === c.shiftTypeId)) continue;
      if (!S.workers.some((w) => w.id === c.workerId && w.active !== false)) continue;
      await assign(c.workerId, date, c.shiftTypeId);
      n++;
    }
    toast(`${n} turno(s) copiados`);
  },
  'edit-shift'(el) { editShift(el.dataset.id); },
  'edit-task'(el) { editTask(el.dataset.id, el.dataset.section); },
  'edit-worker'(el) { editWorker(el.dataset.id); },
  async 'apply-tasks'() {
    const cls = await store.list('checklists', [['date', '>=', today()]]);
    if (!cls.length) return toast('No hay turnos asignados desde hoy');
    if (!confirm(`¿Actualizar ${cls.length} turno(s) con la lista de tareas actual?`)) return;
    for (const c of cls) {
      const st = S.shiftTypes.find((s) => s.id === c.shiftTypeId);
      if (!st) continue;
      await store.update('checklists', c.id, { items: buildItems(st, c.date, c.items, c.id) });
    }
    toast('Turnos actualizados');
  },
  async share(el) {
    const url = el.dataset.url;
    try {
      if (navigator.share) await navigator.share({ title: 'Checklist Heladería', text: 'Abre este link para ver tus tareas del turno:', url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado'); }
    } catch {}
  },
  async notif() {
    try { await Notification.requestPermission(); } catch {}
    render();
  },
  'admin-pin'() { changeAdminPin(); },
  async backup() {
    const data = await store.exportAll();
    downloadFile(`respaldo-heladeria-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  },
  'reset-demo'() {
    if (!confirm('¿Borrar todos los datos de demo de este dispositivo?')) return;
    resetDemo();
    saveSession(null);
    location.hash = '';
    location.reload();
  },
  report(el) { loadReport(el.dataset.preset); },
  csv() {
    const d = S.ui.report?.data;
    if (!d?.cls) return;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Fecha', 'Persona', 'Turno', 'Grupo', 'Tarea', 'Estado', 'Hora', 'Hecha por', 'Marcada por', 'Nota']];
    for (const c of d.cls.sort((a, b) => a.date.localeCompare(b.date))) {
      for (const it of sortedItems(c)) {
        const estado = it.reported ? 'Reportada' : it.done ? (it.covered ? 'Cubierta por otro' : 'Hecha') : it.postponed ? 'Postergada' : c.date === today() && !c.closedAt ? 'Pendiente' : 'No hecha';
        rows.push([c.date, wName(c.workerId, c.workerName), c.shiftName, sectionName(it.section), it.text, estado, fmtTime(it.doneAt), it.doneBy ? wName(it.doneBy) : '', it.markedBy && it.markedBy !== it.doneBy ? wName(it.markedBy) : '', it.reported?.note || it.postponed?.note || '']);
      }
    }
    downloadFile(`reporte-${S.ui.report.from}_${S.ui.report.to}.csv`, '﻿' + rows.map((r) => r.map(q).join(';')).join('\n'), 'text/csv');
  },
  'close-modal'() { closeModal(); },
  async 'modal-delete'() { await S.modal?.onDelete?.(); },
};

const CHANGES = {
  async assign(el) {
    const { w, d } = el.dataset;
    await assign(w, d, el.value, findChecklist(`${d}_${w}`));
  },
  'report-range'(el) {
    const r = S.ui.report || {};
    const from = el.dataset.k === 'from' ? el.value : r.from;
    const to = el.dataset.k === 'to' ? el.value : r.to;
    if (from && to && from <= to) loadReport('custom', from, to);
  },
};

async function run(fn, ...args) {
  try {
    await fn(...args);
  } catch (e) {
    console.error(e);
    toast(`Error: ${e.message || e}`, 'err');
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  run(fn, el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) run(CHANGES[el.dataset.change], el);
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'modal-form') return;
  e.preventDefault();
  run(S.modal.onSubmit, new FormData(e.target));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) closeModal();
  const pinView = (S.route.path === 'admin' && S.mode === 'demo' && S.session?.role !== 'admin') || (S.route.path === 'equipo' && S.ui.pickWorker);
  if (pinView && !S.modal && (/^[0-9]$/.test(e.key) || e.key === 'Backspace')) {
    ACTIONS.pin({ dataset: { k: e.key === 'Backspace' ? '⌫' : e.key } });
  }
});
