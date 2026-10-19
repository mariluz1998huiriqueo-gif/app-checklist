// App de compras: administración arma la lista, quien compra la ve y marca.
// Usa el mismo Firebase (y la misma cuenta de administración) que el checklist.

import { initStore, store, resetDemo, isPermissionError } from '../js/store.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toasts = document.getElementById('toasts');
const SESSION_KEY = 'compras-session';

const DEFAULT_CATEGORIES = [
  { id: 'alimentos', name: 'Alimentos', icon: '🥛', order: 1 },
  { id: 'limpieza', name: 'Limpieza', icon: '🧴', order: 2 },
  { id: 'desechables', name: 'Desechables', icon: '🥤', order: 3 },
  { id: 'otros', name: 'Otros', icon: '📦', order: 4 },
];
const DEFAULT_PRODUCTS = {
  alimentos: ['Leche', 'Crema', 'Galletas', 'Baño de chocolate', 'Café', 'Azúcar'],
  limpieza: ['Nova para limpiar vidrios', 'Nova para dispensador', 'Limpiavidrios', 'Cloro', 'Lavaloza', 'Bolsas de basura', 'Papel higiénico'],
  desechables: ['Servilletas', 'Vasos', 'Cucharitas', 'Potes', 'Tapas de potes'],
  otros: [],
};

const S = {
  mode: null,
  ready: false,
  error: null,
  owner: null,
  settings: {},
  buyers: [],
  pins: {},
  cats: [],
  products: [],
  items: null,
  requests: [],
  alerts: [],
  session: loadSession(),
  route: '',
  modal: null,
  ui: { pin: '', pinError: false, pick: null, q: '', history: null, showBought: false },
};

// ───────────────────────── utilidades ─────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDay = (ms) => new Date(ms).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (ms) => new Date(ms).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const bName = (id) => S.buyers.find((b) => b.id === id)?.name || 'Compras';
const catOf = (id) => S.cats.find((c) => c.id === id) || { id: 'otros', name: 'Otros', icon: '📦', order: 99 };
const isAdmin = () => S.session?.role === 'admin';
const isBuyer = () => S.session?.role === 'buyer';
const go = (hash) => { location.hash = hash; };

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function saveSession(s) {
  S.session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
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

// ───────────────────────── arranque y datos ─────────────────────────

boot();

async function boot() {
  try {
    S.mode = await initStore();
    if (S.mode === 'demo') {
      S.settings = (await store.get('settings', 'app')) || { adminPin: '1234' };
      await seedShop();
    } else {
      S.owner = await store.get('settings', 'owner');
      if (isAdmin() && S.owner?.uid !== store.auth.uid()) saveSession(null);
      if (isBuyer()) {
        const sess = await store.get('buyerSessions', store.auth.uid()).catch(() => null);
        if (!sess || sess.buyerId !== S.session.buyerId) saveSession(null);
      }
    }
  } catch (e) {
    console.error(e);
    S.error = e;
    return render();
  }
  store.watch('buyers', [], (d) => { S.buyers = d.sort((a, b) => a.name.localeCompare(b.name)); render(); }, (e) => { S.error = e; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
  S.ready = true;
  startSubs();
  window.addEventListener('hashchange', route);
  route();
}

async function seedShop() {
  if ((await store.list('shopCategories')).length) return;
  for (const c of DEFAULT_CATEGORIES) await store.set('shopCategories', c.id, c);
  for (const [cat, names] of Object.entries(DEFAULT_PRODUCTS)) {
    for (const name of names) await store.set('shopProducts', uid(), { name, categoryId: cat, active: true });
  }
}

let subs = [];
const alertsSeen = new Set();
let alertsPrimed = false;
function startSubs() {
  subs.forEach((u) => u());
  subs = [];
  if (!isAdmin() && !isBuyer()) return;
  const lost = (e) => { if (isPermissionError(e)) sessionLost(); else { S.error = e; render(); } };
  subs.push(store.watch('shopCategories', [], (d) => { S.cats = d.sort((a, b) => (a.order || 0) - (b.order || 0)); render(); }, lost));
  subs.push(store.watch('shopProducts', [], (d) => { S.products = d.sort((a, b) => a.name.localeCompare(b.name)); render(); }, lost));
  subs.push(store.watch('shopItems', [['archived', '==', false]], (d) => { S.items = d; render(); }, lost));
  if (isAdmin()) {
    subs.push(store.watch('buyerPins', [], (d) => { S.pins = Object.fromEntries(d.map((x) => [x.id, x.pin])); render(); }, lost));
    subs.push(store.watch('shopRequests', [['status', '==', 'nuevo']], (d) => {
      S.requests = d.sort((a, b) => b.at - a.at);
      render();
    }, lost));
    subs.push(store.watch('alerts', [['at', '>=', Date.now() - 14 * 864e5]], (d) => {
      const mine = d.filter((a) => /^compra|^falta/.test(a.type)).sort((a, b) => b.at - a.at);
      if (alertsPrimed) {
        for (const a of mine.filter((x) => !alertsSeen.has(x.id) && !x.read)) {
          toast(`🔔 ${alertText(a)}`, 'warn');
          beep();
          showNotification('Compras – aviso', alertText(a), a.id);
        }
      }
      mine.forEach((a) => alertsSeen.add(a.id));
      alertsPrimed = true;
      S.alerts = mine;
      render();
    }, lost));
  }
}

function sessionLost() {
  if (!S.session) return;
  saveSession(null);
  startSubs();
  toast('Tu sesión expiró. Vuelve a ingresar.', 'err');
  go('');
}

function route() {
  S.route = location.hash.replace(/^#\/?/, '');
  S.ui.pin = '';
  S.ui.pinError = false;
  render();
  window.scrollTo(0, 0);
}

function alertText(a) {
  if (a.type === 'falta') return `${a.byName || 'Alguien del equipo'} avisa que falta: «${a.text}»${a.urgent ? ' (urgente)' : ''}.`;
  if (a.type === 'compra-no') return `${bName(a.byBuyerId)} no pudo comprar «${a.text}»${a.note ? `: “${a.note}”` : '.'}`;
  if (a.type === 'compra-msg') return `${bName(a.byBuyerId)}: “${a.note}”`;
  if (a.type === 'compra-fin') return `${bName(a.byBuyerId)} terminó de comprar: ${a.bought} comprado(s)${a.notBought ? `, ${a.notBought} no se pudo` : ''}${a.pending ? `, ${a.pending} pendiente(s)` : ''}.`;
  return a.text || 'Aviso';
}

// ───────────────────────── render ─────────────────────────

function render() {
  if (S.error) return renderError();
  if (!S.ready) return;
  let html;
  if (S.route.startsWith('admin')) html = isAdmin() ? viewAdmin(S.route.split('/')[1] || 'lista') : viewAdminLogin();
  else if (S.route === 'comprar') html = isBuyer() ? viewBuyer() : viewBuyerLogin();
  else html = viewHome();
  $app.innerHTML = html;
}

function renderError() {
  const msg = String(S.error?.message || S.error || '');
  $app.innerHTML = `
    <div class="page narrow"><div class="card">
      <h2>No se pudo conectar</h2>
      <p>${isPermissionError(S.error) ? 'Firebase rechazó el acceso. Revisa que las <b>reglas de Firestore</b> estén actualizadas (README).' : 'Revisa tu conexión a internet.'}</p>
      <p class="muted small">${esc(msg)}</p>
      <button class="btn" onclick="location.reload()">Reintentar</button>
    </div></div>`;
}

const demoBanner = () => (S.mode === 'demo' ? '<div class="demo">Modo demo: los datos se guardan solo en este dispositivo.</div>' : '');
const topbar = (title, right = '') =>
  `<header class="top"><a class="brand" href="#/">🛒</a><div class="top-title">${title}</div><div class="top-right">${right}</div></header>`;

function viewHome() {
  return `${demoBanner()}
    <div class="page narrow home">
      <div class="hero"><div class="hero-icon">🛒</div><h1>Compras Heladería</h1></div>
      <a class="big-btn" href="#/comprar">🛍️ Soy quien compra</a>
      <a class="big-btn alt" href="#/admin">🔐 Administración</a>
    </div>`;
}

function pinPad(title, subtitle, len) {
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

function viewBuyerLogin() {
  const b = S.ui.pick && S.buyers.find((x) => x.id === S.ui.pick);
  if (b) {
    return `${topbar('Ingresar', '<button class="link" data-act="pick-back">Volver</button>')}
      <div class="page narrow">${pinPad(`Hola, ${esc(b.name)}`, 'Ingresa tu PIN', b.pinLength || 2)}</div>`;
  }
  const active = S.buyers.filter((x) => x.active !== false);
  return `${topbar('¿Quién eres?')}${demoBanner()}
    <div class="page narrow">
      ${active.length
        ? `<div class="grid-names">${active.map((x) => `<button class="name-btn" data-act="pick" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`
        : '<div class="empty">Aún no hay personas de compras registradas.<br>Administración debe agregarlas en <b>Compradores</b>.</div>'}
    </div>`;
}

function viewAdminLogin() {
  if (S.mode === 'demo') {
    return `${topbar('Administración')}<div class="page narrow">${pinPad('Administración', 'Ingresa el PIN de administración', 4)}</div>`;
  }
  return `${topbar('Administración')}
    <div class="page narrow"><div class="card center">
      <div class="hero-icon">🔐</div>
      <h2>Administración de compras</h2>
      ${S.owner
        ? '<p class="muted">Entra con la misma cuenta de Google que usas en el checklist.</p>'
        : '<p>Primero entra como administradora en la app del checklist; después vuelve aquí.</p>'}
      ${S.owner ? `<button class="btn primary block" data-act="google-login">${store.auth.isGoogle() ? `Continuar como ${esc(store.auth.name())}` : 'Entrar con Google'}</button>` : '<a class="btn block" href="../">Ir al checklist</a>'}
    </div></div>`;
}

// ── listas agrupadas por categoría ──
function groupByCat(items, rowFn) {
  const groups = new Map();
  for (const it of items) {
    const c = catOf(it.categoryId);
    if (!groups.has(c.id)) groups.set(c.id, { c, items: [] });
    groups.get(c.id).items.push(it);
  }
  return [...groups.values()]
    .sort((a, b) => (a.c.order || 0) - (b.c.order || 0))
    .map((g) => `<section class="sec"><h3>${esc(g.c.icon || '')} ${esc(g.c.name)} <span class="count">${g.items.length}</span></h3>${g.items
      .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.name.localeCompare(b.name))
      .map(rowFn).join('')}</section>`)
    .join('');
}

function itemMeta(it) {
  return [
    it.qty ? `<b>${esc(it.qty)}</b>` : '',
    it.urgent ? '<span class="chip bad">Urgente</span>' : '',
    it.note ? `📝 ${esc(it.note)}` : '',
    it.status === 'no_comprado' ? `<span class="chip bad">No se pudo</span>${it.buyerComment ? ` “${esc(it.buyerComment)}”` : ''}` : '',
    it.status === 'comprado' ? `✓ ${esc(bName(it.buyerId))} · ${esc(fmtShort(it.boughtAt))} ${fmtTime(it.boughtAt)}` : '',
  ].filter(Boolean).join(' · ');
}

// ── quien compra ──
function viewBuyer() {
  const b = S.buyers.find((x) => x.id === S.session.buyerId);
  const head = topbar(b ? `Hola, ${esc(b.name)}` : 'Compras', '<button class="link" data-act="logout">Salir</button>');
  if (!S.items) return `${head}<div class="empty">Cargando…</div>`;
  const toBuy = S.items.filter((i) => i.status !== 'comprado');
  const bought = S.items.filter((i) => i.status === 'comprado');
  const urgent = toBuy.filter((i) => i.urgent).length;
  const row = (it) => `
    <div class="trow ${it.status === 'comprado' ? 'done' : ''} ${it.status === 'no_comprado' ? 'postponed' : ''}">
      <div class="boxes"><button class="box ${it.status === 'comprado' ? 'on' : ''}" data-act="buy" data-id="${it.id}">${it.status === 'comprado' ? '✓' : ''}</button></div>
      <div class="txt">${esc(it.name)}<small>${itemMeta(it)}</small></div>
      ${it.status === 'comprado' ? '' : `<button class="more" data-act="not-bought" data-id="${it.id}" title="No se pudo comprar">⋯</button>`}
    </div>`;
  return `${head}${demoBanner()}
    <div class="page narrow">
      <div class="card">
        <b>${toBuy.length ? `${toBuy.length} por comprar` : '¡Nada pendiente! 🎉'}</b>${urgent ? ` · <span class="bad-t">${urgent} urgente(s)</span>` : ''}
        <p class="small muted">Toca la casilla al comprar. Si algo no se pudo comprar, toca <b>⋯</b> y deja un comentario.</p>
      </div>
      ${groupByCat(toBuy, row)}
      ${bought.length ? `
        <div class="card">
          <button class="prev-head" data-act="toggle-bought"><span>✓ Comprado <span class="count">${bought.length}</span></span><span>${S.ui.showBought ? '▲' : '▼'}</span></button>
          ${S.ui.showBought ? groupByCat(bought, row) : ''}
        </div>` : ''}
      <button class="btn block" data-act="msg">💬 Enviar un mensaje a administración</button>
      <button class="btn block primary" data-act="finish">✅ Terminé de comprar</button>
    </div>`;
}

// ── administración ──
const TABS = [
  ['lista', 'Lista'],
  ['agregar', '＋ Agregar'],
  ['catalogo', 'Catálogo'],
  ['historial', 'Historial'],
  ['compradores', 'Compradores'],
];

function viewAdmin(tab) {
  const unread = S.alerts.filter((a) => !a.read).length + S.requests.length;
  const right = `<a class="bell" href="#/admin/lista">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</a><a href="../#/admin">Checklist</a><button class="link" data-act="logout">Salir</button>`;
  const nav = `<nav class="tabs">${TABS.map(([id, n]) => `<a href="#/admin/${id}" class="${id === tab ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
  const body = { lista: adminList, agregar: adminAdd, catalogo: adminCatalog, historial: adminHistory, compradores: adminBuyers }[tab] || adminList;
  return `${topbar('Compras', right)}${nav}${demoBanner()}<div class="page narrow">${body()}</div>`;
}

function adminList() {
  if (!S.items) return '<div class="empty">Cargando…</div>';
  const unread = S.alerts.filter((a) => !a.read);
  const toBuy = S.items.filter((i) => i.status !== 'comprado');
  const bought = S.items.filter((i) => i.status === 'comprado');
  const row = (it) => `
    <button class="list-row ${it.status === 'comprado' ? 'inactive' : ''}" data-act="edit-item" data-id="${it.id}">
      <div>${esc(it.name)}<div class="small muted">${itemMeta(it)}</div></div><span>✎</span>
    </button>`;
  return `
    ${S.requests.length ? `
      <div class="card prev">
        <h3>⚠️ El equipo avisa que falta</h3>
        ${S.requests.map((r) => `
          <div class="prow">
            <span>${r.urgent ? '🔴' : '•'}</span>
            <div class="txt">${esc(r.text)}<small>${esc(r.byName || '')} · ${esc(fmtShort(r.at))} ${fmtTime(r.at)}</small></div>
            <div class="pbtns">
              <button class="btn small primary" data-act="req-add" data-id="${r.id}">Agregar a la lista</button>
              <button class="btn small" data-act="req-discard" data-id="${r.id}">Descartar</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
    ${unread.length ? `
      <div class="card">
        <div class="row-between"><h3>🔔 Avisos</h3><button class="link" data-act="alerts-read">Marcar leídos</button></div>
        ${unread.map((a) => `<div class="alert"><div>${esc(alertText(a))}<div class="muted small">${esc(fmtShort(a.at))} ${fmtTime(a.at)}</div></div></div>`).join('')}
      </div>` : ''}
    <div class="row-between"><h2>Por comprar <span class="count">${toBuy.length}</span></h2><a class="btn small primary" href="#/admin/agregar">＋ Agregar</a></div>
    ${toBuy.length ? `<div class="card list">${groupByCat(toBuy, row)}</div>` : '<div class="empty">La lista está vacía.</div>'}
    ${bought.length ? `
      <div class="row-between"><h2>Comprado <span class="count">${bought.length}</span></h2><button class="btn small" data-act="archive">Pasar al historial</button></div>
      <div class="card list">${groupByCat(bought, row)}</div>` : ''}`;
}

function adminAdd() {
  const q = norm(S.ui.q);
  const inList = new Set((S.items || []).filter((i) => i.status !== 'comprado').map((i) => i.productId));
  const prods = S.products.filter((p) => p.active !== false && (!q || norm(p.name).includes(q)));
  return `
    <p class="small muted">Toca un producto para agregarlo a la lista. Si no está, créalo con “Producto nuevo”.</p>
    <input class="search" type="search" placeholder="Buscar producto…" value="${esc(S.ui.q)}" data-input="q">
    <button class="btn block" data-act="new-product">＋ Producto nuevo${S.ui.q ? `: «${esc(S.ui.q)}»` : ''}</button>
    ${groupByCat(prods, (p) => `
      <div class="prod-row">
        <button class="list-row ${inList.has(p.id) ? 'inactive' : ''}" data-act="add-item" data-id="${p.id}">
          <div>${esc(p.name)}${inList.has(p.id) ? '<div class="small muted">Ya está en la lista</div>' : ''}</div><span>${inList.has(p.id) ? '✓' : '＋'}</span>
        </button>
        <button class="edit-btn" data-act="edit-product" data-id="${p.id}" title="Editar producto">✎</button>
      </div>`)}
    ${!prods.length ? '<div class="empty">No hay productos que coincidan.</div>' : ''}`;
}

function adminCatalog() {
  return `
    <p class="small muted">Toca un producto para cambiarle el nombre o la categoría. Si ya estaba en la lista, se actualiza ahí también.</p>
    ${S.cats.map((c) => {
      const ps = S.products.filter((p) => p.categoryId === c.id);
      return `
        <div class="row-between"><h3>${esc(c.icon || '')} ${esc(c.name)} <span class="count">${ps.length}</span></h3><button class="link" data-act="edit-cat" data-id="${c.id}">Editar</button></div>
        <div class="card list">
          ${ps.map((p) => `<button class="list-row ${p.active === false ? 'inactive' : ''}" data-act="edit-product" data-id="${p.id}"><div>${esc(p.name)}${p.active === false ? '<div class="small muted">Desactivado</div>' : ''}</div><span>✎</span></button>`).join('')}
          <button class="list-row add" data-act="new-product" data-cat="${c.id}">＋ Agregar producto</button>
        </div>`;
    }).join('')}
    <button class="btn block" data-act="edit-cat">＋ Nueva categoría</button>`;
}

function adminHistory() {
  const h = S.ui.history;
  if (!h) { setTimeout(loadHistory, 0); return '<div class="empty">Cargando…</div>'; }
  if (!h.length) return '<div class="empty">Aún no hay compras en el historial.</div>';
  const byDay = {};
  for (const it of h) (byDay[ymd(new Date(it.boughtAt || it.updatedAt || it.createdAt))] ||= []).push(it);
  return Object.entries(byDay).sort().reverse().map(([day, its]) => `
    <h3>${esc(fmtDay(its[0].boughtAt || its[0].updatedAt || its[0].createdAt))}</h3>
    <div class="card">${its.map((it) => `<div class="drow ${it.status === 'comprado' ? 'done' : ''}"><span>${it.status === 'comprado' ? '✅' : '❌'}</span><span>${esc(it.name)}${it.qty ? ` · ${esc(it.qty)}` : ''}</span><span class="muted small">${esc(catOf(it.categoryId).name)}${it.buyerId ? ` · ${esc(bName(it.buyerId))}` : ''}${it.buyerComment ? ` · “${esc(it.buyerComment)}”` : ''}</span></div>`).join('')}</div>`).join('');
}

async function loadHistory() {
  try {
    const all = await store.list('shopItems', [['archived', '==', true]]);
    const since = Date.now() - 60 * 864e5;
    S.ui.history = all.filter((i) => (i.boughtAt || i.updatedAt || i.createdAt) >= since).sort((a, b) => (b.boughtAt || 0) - (a.boughtAt || 0));
  } catch (e) {
    S.ui.history = [];
    toast(`Error: ${e.message || e}`, 'err');
  }
  render();
}

function adminBuyers() {
  const url = location.href.split('#')[0];
  return `
    <div class="card">
      <h3>Link para quien compra</h3>
      <p class="small">Envíale este link. Elige su nombre, ingresa su PIN y solo verá la lista de compras.</p>
      <div class="copy"><code>${esc(url)}</code><button class="btn small" data-act="share" data-url="${esc(url)}">Copiar / compartir</button></div>
    </div>
    <h2>Personas que compran</h2>
    <div class="card list">
      ${S.buyers.map((b) => `<button class="list-row ${b.active === false ? 'inactive' : ''}" data-act="edit-buyer" data-id="${b.id}"><div><b>${esc(b.name)}</b><div class="small muted">PIN ${esc(S.pins[b.id] ?? '··')}${b.active === false ? ' · Inactivo' : ''}</div></div><span>✎</span></button>`).join('')}
      <button class="list-row add" data-act="edit-buyer">＋ Agregar persona</button>
    </div>
    <div class="card">
      <h3>Notificaciones</h3>
      <p class="small">Te avisa cuando el equipo dice que falta algo, cuando algo no se pudo comprar o cuando terminan de comprar (con la app abierta).</p>
      ${'Notification' in window && Notification.permission === 'granted' ? '<div class="chip ok">Activadas</div>' : '<button class="btn small" data-act="notif">Activar notificaciones</button>'}
    </div>
    ${S.mode === 'demo' ? '<button class="btn small danger" data-act="reset-demo">Borrar datos demo</button>' : ''}`;
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

const catSelect = (sel) => `<select name="cat">${S.cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}</select>`;
const itemFields = (it = {}) => `
  <label>Cantidad (opcional)<input name="qty" maxlength="40" placeholder="Ej: 6 litros, 2 paquetes" value="${esc(it.qty || '')}"></label>
  <label class="check"><input type="checkbox" name="urgent" ${it.urgent ? 'checked' : ''}> 🔴 Urgente</label>
  <label>Nota para quien compra (opcional)<input name="note" maxlength="150" placeholder="Ej: marca Colun, la de 1 litro" value="${esc(it.note || '')}"></label>`;

async function createItem(p, f, extra = {}) {
  await store.set('shopItems', uid(), {
    productId: p.id, name: p.name, categoryId: p.categoryId,
    qty: f.get('qty').trim(), urgent: f.get('urgent') === 'on', note: f.get('note').trim(),
    status: 'pendiente', archived: false, createdAt: Date.now(), updatedAt: Date.now(),
    boughtAt: null, buyerId: null, buyerComment: '', ...extra,
  });
}

function addItemModal(p) {
  const existing = (S.items || []).find((i) => i.productId === p.id && i.status !== 'comprado');
  if (existing) return editItem(existing.id);
  openModal(`Agregar: ${esc(p.name)}`, itemFields(), {
    submitLabel: 'Agregar a la lista',
    async onSubmit(f) {
      await createItem(p, f);
      closeModal();
      S.ui.q = '';
      toast(`${p.name} agregado a la lista`);
      render();
    },
  });
}

function editItem(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  openModal(esc(it.name), `
    ${itemFields(it)}
    <label>Estado<select name="status">
      <option value="pendiente" ${it.status === 'pendiente' ? 'selected' : ''}>Por comprar</option>
      <option value="no_comprado" ${it.status === 'no_comprado' ? 'selected' : ''}>No se pudo comprar</option>
      <option value="comprado" ${it.status === 'comprado' ? 'selected' : ''}>Comprado</option>
    </select></label>
    ${it.buyerComment ? `<p class="small">Comentario de compras: “${esc(it.buyerComment)}”</p>` : ''}`, {
    async onSubmit(f) {
      const status = f.get('status');
      await store.update('shopItems', id, {
        qty: f.get('qty').trim(), urgent: f.get('urgent') === 'on', note: f.get('note').trim(), status, updatedAt: Date.now(),
        boughtAt: status === 'comprado' ? it.boughtAt || Date.now() : null,
      });
      closeModal();
    },
    onDelete: async () => {
      if (!confirm(`¿Quitar «${it.name}» de la lista?`)) return;
      await store.remove('shopItems', id);
      closeModal();
    },
  });
}

function productModal(id, { cat, name = '', addToList = false, onDone } = {}) {
  const p = S.products.find((x) => x.id === id) || { name, categoryId: cat || S.cats[0]?.id, active: true };
  openModal(id ? 'Editar producto' : 'Producto nuevo', `
    <label>Nombre<input name="name" required maxlength="60" value="${esc(p.name)}"></label>
    <label>Categoría${catSelect(p.categoryId)}</label>
    ${id ? `<label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Activo (aparece para agregar)</label>` : `
      <label class="check"><input type="checkbox" name="addNow" ${addToList ? 'checked' : ''}> Agregarlo también a la lista ahora</label>
      ${itemFields()}`}`, {
    async onSubmit(f) {
      const pname = f.get('name').trim();
      const dup = S.products.find((x) => x.id !== id && norm(x.name) === norm(pname));
      if (dup) return toast(`Ya existe «${dup.name}» en el catálogo`, 'err');
      const pid = id || uid();
      const data = { name: pname, categoryId: f.get('cat'), active: id ? f.get('active') === 'on' : true };
      await store.set('shopProducts', pid, data);
      // Si el producto ya estaba en la lista (sin comprar), se actualiza ahí también.
      if (id) {
        for (const it of (S.items || []).filter((x) => x.productId === id && x.status !== 'comprado')) {
          await store.update('shopItems', it.id, { name: data.name, categoryId: data.categoryId, updatedAt: Date.now() });
        }
      }
      if (!id && f.get('addNow') === 'on') await createItem({ id: pid, ...data }, f);
      closeModal();
      S.ui.q = '';
      await onDone?.({ id: pid, ...data });
      toast(id ? 'Producto guardado' : `${pname} creado${f.get('addNow') === 'on' ? ' y agregado a la lista' : ''}`);
      render();
    },
    onDelete: id && (async () => {
      if (!confirm(`¿Eliminar «${p.name}» del catálogo?`)) return;
      await store.remove('shopProducts', id);
      closeModal();
    }),
  });
}

function categoryModal(id) {
  const c = S.cats.find((x) => x.id === id) || { name: '', icon: '📦' };
  openModal(id ? 'Editar categoría' : 'Nueva categoría', `
    <label>Nombre<input name="name" required maxlength="40" value="${esc(c.name)}"></label>
    <label>Ícono (emoji)<input name="icon" maxlength="4" value="${esc(c.icon || '')}"></label>`, {
    async onSubmit(f) {
      await store.set('shopCategories', id || uid(), {
        name: f.get('name').trim(), icon: f.get('icon').trim(),
        order: id ? c.order : Math.max(0, ...S.cats.map((x) => x.order || 0)) + 1,
      });
      closeModal();
    },
    onDelete: id && (async () => {
      if (S.products.some((p) => p.categoryId === id)) return toast('Primero mueve o elimina los productos de esta categoría', 'err');
      if (!confirm(`¿Eliminar la categoría «${c.name}»?`)) return;
      await store.remove('shopCategories', id);
      closeModal();
    }),
  });
}

function buyerModal(id) {
  const b = S.buyers.find((x) => x.id === id) || { name: '', active: true };
  const curPin = id ? S.pins[id] ?? '' : String(Math.floor(10 + Math.random() * 90));
  openModal(id ? 'Editar persona' : 'Nueva persona de compras', `
    <label>Nombre<input name="name" required maxlength="40" value="${esc(b.name)}"></label>
    <label>PIN (2 a 6 dígitos)<input name="pin" required inputmode="numeric" pattern="[0-9]{2,6}" maxlength="6" value="${esc(curPin)}"></label>
    <label class="check"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}> Activo</label>`, {
    async onSubmit(f) {
      const pin = f.get('pin').trim();
      const bid = id || uid();
      await store.set('buyerPins', bid, { pin });
      await store.set('buyers', bid, { name: f.get('name').trim(), pinLength: pin.length, active: f.get('active') === 'on' });
      closeModal();
    },
    onDelete: id && (async () => {
      if (!confirm(`¿Eliminar a ${b.name}?`)) return;
      await store.remove('buyers', id);
      await store.remove('buyerPins', id);
      closeModal();
    }),
  });
}

// ───────────────────────── acciones ─────────────────────────

async function buyerLogin(b, pin) {
  let ok = false;
  if (S.mode === 'demo') {
    ok = (await store.get('buyerPins', b.id))?.pin === pin;
  } else {
    try {
      await store.set('buyerSessions', store.auth.uid(), { buyerId: b.id, pin, at: Date.now() });
      ok = true;
    } catch (e) {
      if (!isPermissionError(e)) throw e;
    }
  }
  if (!ok) {
    S.ui.pinError = true;
    return render();
  }
  saveSession({ role: 'buyer', buyerId: b.id });
  S.ui.pick = null;
  startSubs();
  render();
}

const ACTIONS = {
  pin(el) {
    const k = el.dataset.k;
    const admin = S.route.startsWith('admin');
    const b = admin ? null : S.buyers.find((x) => x.id === S.ui.pick);
    const len = admin ? 4 : b?.pinLength || 2;
    S.ui.pinError = false;
    S.ui.pin = k === '⌫' ? S.ui.pin.slice(0, -1) : (S.ui.pin + k).slice(0, len);
    if (S.ui.pin.length < len) return render();
    const pin = S.ui.pin;
    S.ui.pin = '';
    if (admin) {
      if (pin === String(S.settings.adminPin || '1234')) {
        saveSession({ role: 'admin' });
        startSubs();
      } else S.ui.pinError = true;
      return render();
    }
    return buyerLogin(b, pin);
  },
  pick(el) { S.ui.pick = el.dataset.id; render(); },
  'pick-back'() { S.ui.pick = null; render(); },
  async 'google-login'() {
    if (!store.auth.isGoogle()) await store.auth.google();
    if (!store.auth.isGoogle()) return;
    S.owner = await store.get('settings', 'owner');
    if (S.owner?.uid !== store.auth.uid()) {
      await store.auth.anon();
      return toast('Esta cuenta de Google no es la administradora.', 'err');
    }
    saveSession({ role: 'admin' });
    await seedShop();
    location.reload();
  },
  async logout() {
    const role = S.session?.role;
    saveSession(null);
    if (S.mode === 'firebase') {
      if (role === 'buyer') await store.remove('buyerSessions', store.auth.uid()).catch(() => {});
      if (store.auth.isGoogle()) await store.auth.anon();
      location.hash = '';
      return location.reload();
    }
    startSubs();
    go('');
  },
  // quien compra
  async buy(el) {
    const it = S.items.find((x) => x.id === el.dataset.id);
    if (!it) return;
    const bought = it.status !== 'comprado';
    await store.update('shopItems', it.id, {
      status: bought ? 'comprado' : 'pendiente', boughtAt: bought ? Date.now() : null,
      buyerId: S.session.buyerId, updatedAt: Date.now(),
    });
  },
  'not-bought'(el) {
    const it = S.items.find((x) => x.id === el.dataset.id);
    if (!it) return;
    openModal('No se pudo comprar', `
      <p><b>${esc(it.name)}</b>${it.qty ? ` · ${esc(it.qty)}` : ''}</p>
      <label>Comentario<textarea name="comment" rows="3" maxlength="200" placeholder="Ej: no había en el supermercado / estaba agotado">${esc(it.buyerComment || '')}</textarea></label>`, {
      submitLabel: 'Avisar',
      async onSubmit(f) {
        const comment = f.get('comment').trim();
        await store.update('shopItems', it.id, { status: 'no_comprado', buyerComment: comment, buyerId: S.session.buyerId, updatedAt: Date.now() });
        await store.set('alerts', uid(), { type: 'compra-no', at: Date.now(), read: false, text: it.name, note: comment, byBuyerId: S.session.buyerId });
        closeModal();
        toast('Se avisó a administración');
      },
    });
  },
  msg() {
    openModal('Mensaje a administración', `
      <label>Mensaje<textarea name="note" rows="3" required maxlength="300" placeholder="Ej: mañana voy a la distribuidora por la crema"></textarea></label>`, {
      submitLabel: 'Enviar',
      async onSubmit(f) {
        await store.set('alerts', uid(), { type: 'compra-msg', at: Date.now(), read: false, note: f.get('note').trim(), byBuyerId: S.session.buyerId });
        closeModal();
        toast('Mensaje enviado');
      },
    });
  },
  async finish() {
    const items = S.items || [];
    const bought = items.filter((i) => i.status === 'comprado').length;
    const notBought = items.filter((i) => i.status === 'no_comprado').length;
    const pending = items.filter((i) => i.status === 'pendiente').length;
    if (!confirm(`¿Avisar a administración que terminaste? ${bought} comprado(s)${pending ? `, ${pending} sin marcar` : ''}.`)) return;
    await store.set('alerts', uid(), { type: 'compra-fin', at: Date.now(), read: false, bought, notBought, pending, byBuyerId: S.session.buyerId });
    toast('¡Gracias! Se avisó a administración');
  },
  'toggle-bought'() { S.ui.showBought = !S.ui.showBought; render(); },
  // administración
  'add-item'(el) { const p = S.products.find((x) => x.id === el.dataset.id); if (p) addItemModal(p); },
  'new-product'(el) { productModal(null, { cat: el.dataset.cat, name: S.ui.q, addToList: !el.dataset.cat }); },
  'edit-product'(el) { productModal(el.dataset.id); },
  'edit-item'(el) { editItem(el.dataset.id); },
  'edit-cat'(el) { categoryModal(el.dataset.id); },
  'edit-buyer'(el) { buyerModal(el.dataset.id); },
  async archive() {
    const bought = (S.items || []).filter((i) => i.status === 'comprado');
    if (!confirm(`¿Pasar ${bought.length} producto(s) comprados al historial?`)) return;
    for (const it of bought) await store.update('shopItems', it.id, { archived: true });
    S.ui.history = null;
  },
  async 'req-add'(el) {
    const r = S.requests.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const match = S.products.find((p) => norm(p.name) === norm(r.text));
    const done = async () => { await store.update('shopRequests', r.id, { status: 'agregado' }); };
    if (match) {
      openModal(`Agregar: ${esc(match.name)}`, itemFields({ urgent: r.urgent, note: `Avisó ${r.byName || 'el equipo'}` }), {
        submitLabel: 'Agregar a la lista',
        async onSubmit(f) { await createItem(match, f); await done(); closeModal(); },
      });
    } else {
      productModal(null, { name: r.text, addToList: true, onDone: done });
    }
  },
  async 'req-discard'(el) {
    if (!confirm('¿Descartar este aviso?')) return;
    await store.update('shopRequests', el.dataset.id, { status: 'descartado' });
  },
  async 'alerts-read'() {
    for (const a of S.alerts.filter((x) => !x.read)) await store.update('alerts', a.id, { read: true });
  },
  async share(el) {
    const url = el.dataset.url;
    try {
      if (navigator.share) await navigator.share({ title: 'Compras Heladería', text: 'Lista de compras de la heladería:', url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado'); }
    } catch {}
  },
  async notif() {
    try { await Notification.requestPermission(); } catch {}
    render();
  },
  'reset-demo'() {
    if (!confirm('¿Borrar todos los datos de demo de este dispositivo (incluido el checklist)?')) return;
    resetDemo();
    saveSession(null);
    location.hash = '';
    location.reload();
  },
  'close-modal'() { closeModal(); },
  async 'modal-delete'() { await S.modal?.onDelete?.(); },
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
document.addEventListener('input', (e) => {
  if (e.target.dataset.input !== 'q') return;
  S.ui.q = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const input = document.querySelector('[data-input="q"]');
  input?.focus();
  input?.setSelectionRange(pos, pos);
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'modal-form') return;
  e.preventDefault();
  run(S.modal.onSubmit, new FormData(e.target));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) closeModal();
});
