/* Plan Finanzas v2 — PWA sin servidor. Datos cifrados (AES-256-GCM) que solo se descifran en tu dispositivo.
   El progreso (checks, gastos, saldos reales) vive en este dispositivo y se puede exportar. */
'use strict';
var APP_VERSION = '3.5.0';
var KEY_LS = 'fin_key', STATE_LS = 'fin_state';
function $(s) { return document.querySelector(s); }
var view = $('#view');
var fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
function money(n) { return (n == null || isNaN(n)) ? '—' : fmt.format(Math.round(n)).replace(/\s/g, ' '); }
function moneyK(n) { if (n == null || isNaN(n)) return '—'; var a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M' : Math.round(n / 1000).toLocaleString('es-CO') + ' mil'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseD(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2] || 1); }
function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
function fDate(s) { if (!s) return ''; var d = parseD(s); return DIAS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); }
function fDateLong(s) { var d = parseD(s); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
function monthName(id) { var p = id.split('-').map(Number); var n = MESES[p[1] - 1]; return n[0].toUpperCase() + n.slice(1) + ' ' + p[0]; }
function monthShort(id) { var p = id.split('-').map(Number); return MESES[p[1] - 1].slice(0, 3) + " '" + String(p[0]).slice(2); }
function curMonth() { return todayStr().slice(0, 7); }
function addDays(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function sum(o) { var t = 0; for (var k in (o || {})) t += (+o[k] || 0); return t; }
function isDesktop() { try { return window.matchMedia('(pointer: fine)').matches && window.innerWidth > 760; } catch (e) { return false; } }

var PLAN = null, KEY = null, LLEGO_POR_ENLACE = false, DEFERRED_INSTALL = null;
var STATE = loadState();
var TAB = 'hoy', MES_SEL = null, META_SEL = null;

function loadState() {
  var base = { checks: {}, gastos: [], retiros: [], saldos: {}, cierres: {}, notif: {} };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(STATE_LS) || '{}')); } catch (e) { return base; }
}
function saveState() { try { localStorage.setItem(STATE_LS, JSON.stringify(STATE)); } catch (e) { toast('No se pudo guardar en este dispositivo'); } syncPendientes(); updateBell(); }
function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

window.addEventListener('error', function (e) {
  if (!PLAN) view.innerHTML = '<section class="welcome"><div class="welcome-art">⚠️</div><h1>Algo falló al abrir</h1><p>Tu navegador no pudo ejecutar la app (' + esc(e.message) + ').</p><p class="hint">Ábrela en Chrome (Android) o Safari (iPhone), no dentro de WhatsApp o Gmail.</p></section>';
});
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); DEFERRED_INSTALL = e; });

/* ---------- Cifrado ---------- */
function b64ToBytes(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function b64urlToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return b64ToBytes(s); }
function decryptPlan(enc, keyStr) {
  return crypto.subtle.importKey('raw', b64urlToBytes(keyStr), 'AES-GCM', false, ['decrypt'])
    .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.ct)); })
    .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
}

function boot() {
  var m = location.hash.match(/k=([A-Za-z0-9_-]{40,})/);
  if (m) { lsSet(KEY_LS, m[1]); LLEGO_POR_ENLACE = true; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } }
  KEY = lsGet(KEY_LS) || (m ? m[1] : null);
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(function () { }); } catch (e) { } }
  if (!KEY) return renderLock();
  if (!window.crypto || !crypto.subtle) return renderLock('Este navegador no permite descifrar. Ábrela en Chrome o Safari actualizados.');
  view.innerHTML = '<div class="skel"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:200px"></div>';
  fetch('data/plan.enc.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (enc) { return decryptPlan(enc, KEY); })
    .then(function (plan) { PLAN = plan; start(); })
    .catch(function (e) { console.warn(e); renderLock('La clave guardada en este dispositivo no abre los datos (o no hay internet). Vuelve a escanear el QR.'); });
}

function start() {
  $('#top').hidden = false; $('#tabs').hidden = false;
  $('#sub').textContent = 'Plan ' + PLAN.version;
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.onclick = function () { go(b.dataset.tab); }; });
  $('#bell').onclick = function () { go('hoy'); };
  MES_SEL = PLAN.meses.some(function (x) { return x.id === curMonth(); }) ? curMonth() : PLAN.meses[0].id;
  META_SEL = PLAN.metas[0].id;
  render(); syncPendientes(); updateBell(); maybeNotify();
  setInterval(function () { maybeNotify(); updateBell(); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { maybeNotify(); updateBell(); if (TAB === 'hoy') render(); } });
  registerPeriodicSync();
  if (LLEGO_POR_ENLACE) { if (isDesktop()) setTimeout(function () { ACT.qr(); }, 600); else setTimeout(showInstallHelp, 800); }
}

/* ---------- Pantalla de entrada ---------- */
function renderLock(msg) {
  $('#tabs').hidden = true; $('#top').hidden = true;
  view.innerHTML = '<div class="lock anim">' +
    '<div class="hero"><div class="phone-art" aria-hidden="true"><div class="ph"></div><div class="qr-mini"></div><div class="beam"></div><div class="lockb">🔒</div></div>' +
    '<h1>Tu plan financiero</h1><p>Privado y cifrado. Nadie más lo puede ver.</p></div>' +
    (msg ? '<div class="alert warn"><div class="ai">⚠️</div><div>' + esc(msg) + '</div></div>' : '') +
    '<div class="card"><h2><span class="tt"><span class="ic">📲</span>Así se abre en tu celular</span></h2><ol class="steps">' +
    '<li><b>En tu computador aparece esta app con un código QR grande.</b><span class="small muted">Si ya la abriste allá, entra a Más → Vincular celular.</span></li>' +
    '<li><b>Abre la cámara del celular y apunta al QR.</b><span class="small muted">No hace falta instalar nada.</span></li>' +
    '<li><b>Toca el enlace que aparece. ¡Entraste!</b><span class="small muted">El celular recuerda la clave para siempre.</span></li>' +
    '<li><b>Agrégala a tu pantalla de inicio</b><span class="small muted">Android: menú ⋮ → Instalar app. iPhone: “Copiar llave”, luego Compartir → Agregar a inicio, y en el ícono “Pegar llave copiada”.</span></li></ol></div>' +
    '<div class="card"><h2><span class="tt"><span class="ic">🔑</span>¿Tienes la clave copiada?</span></h2>' +
    '<p class="small muted">Pega aquí la clave o el enlace completo que empieza por https://…#k=</p>' +
    '<div class="keybox"><input id="k" class="i" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pega aquí la clave"></div>' +
    '<button class="btn block" style="margin-top:.7rem" id="kb">Abrir mi plan</button>' +
    '<button class="btn ghost block" style="margin-top:.5rem" id="kp">Pegar llave copiada</button></div></div>';
  stagger();
  $('#kp').onclick = function () {
    if (!(navigator.clipboard && navigator.clipboard.readText)) return toast('Mantén presionado el cuadro y elige Pegar');
    navigator.clipboard.readText().then(function (t) {
      $('#k').value = (t || '').trim();
      try { navigator.clipboard.writeText(''); } catch (e) { }   // la llave no se queda en el portapapeles
      $('#kb').click();
    }).catch(function () { toast('Mantén presionado el cuadro y elige Pegar'); });
  };
  $('#kb').onclick = function () {
    var v = $('#k').value.trim(); var mm = v.match(/k=([A-Za-z0-9_-]{40,})/); if (mm) v = mm[1];
    if (!/^[A-Za-z0-9_-]{40,}$/.test(v)) return toast('Esa clave no tiene el formato correcto');
    lsSet(KEY_LS, v); location.reload();
  };
}
function showInstallHelp() {
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (standalone) return toast('¡Listo! Ya estás dentro 🎉');
  openModal('<div class="center" style="padding:.4rem 0"><div style="font-size:3rem">🎉</div><h2>¡Entraste!</h2><p class="muted">Deja la app como ícono en tu celular para abrirla con un toque.</p></div>' +
    '<ol class="steps">' + (ios ? '<li><b>Toca “Copiar llave” (abajo)</b><span class="small muted">En iPhone el ícono no comparte memoria con Safari: la pegas una sola vez.</span></li><li><b>Toca Compartir</b><span class="small muted">El cuadrado con la flecha, abajo en Safari.</span></li><li><b>“Agregar a inicio”</b></li><li><b>Abre el ícono de Finanzas y toca “Pegar llave copiada”</b><span class="small muted">Queda guardada para siempre en el ícono.</span></li>'
      : '<li><b>Toca el menú ⋮ arriba a la derecha</b></li><li><b>“Instalar app” o “Agregar a pantalla principal”</b></li><li><b>Listo: aparece el ícono de Finanzas</b></li>') + '</ol>' +
    (ios ? '<button class="btn block" id="cpk">Copiar llave</button>' : '') +
    (DEFERRED_INSTALL ? '<button class="btn block" id="inst">Instalar ahora</button>' : '') +
    '<button class="btn ghost block" style="margin-top:.5rem" id="mclose">Entendido</button>');
  var ib = $('#inst'); if (ib) ib.onclick = function () { DEFERRED_INSTALL.prompt(); closeModal(); };
  var ck = $('#cpk'); if (ck) ck.onclick = function () {
    var link = location.origin + location.pathname + '#k=' + KEY;
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(function () { toast('Llave copiada. Ahora: Compartir → Agregar a inicio'); })
      .catch(function () { window.prompt('Copia este enlace (es tu llave, no lo compartas):', link); });
  };
}
function openModal(html) { var m = $('#modal'); m.innerHTML = '<div class="box">' + html + '</div>'; m.hidden = false; m.onclick = function (e) { if (e.target === m || e.target.id === 'mclose') closeModal(); }; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

/* ---------- Utilidades del plan ---------- */
function allTasks() { var out = []; PLAN.meses.forEach(function (m) { m.tareas.forEach(function (t) { var x = Object.assign({ mes: m.id }, t); out.push(x); }); }); return out.concat(tareasB()); }
function tareasB() {
  if (!STATE.modoB || !PLAN.modoB) return [];
  return PLAN.modoB.map(function (d, i) { var f = addDays(STATE.modoB.fecha, d.dias); return { id: 'B-' + STATE.modoB.fecha + '-' + i, mes: f.slice(0, 7), grupo: 'otros', fecha: f, titulo: '🛟 ' + d.titulo, detalle: d.detalle, tipo: d.tipo, critica: d.critica, monto: 0, desde: '', hacia: '', metas: ['planb'], guia: 'modo_b' }; });
}
function isDone(id) { return !!STATE.checks[id]; }
function overdue() { var h = todayStr(); return allTasks().filter(function (t) { return t.fecha < h && !isDone(t.id); }); }
function dueRange(from, to) { return allTasks().filter(function (t) { return t.fecha >= from && t.fecha <= to && !isDone(t.id); }); }
function nagLevel(days) { return days >= 7 ? 'alarma' : days >= 3 ? 'regano' : 'recordatorio'; }
function nagText(t, days) {
  var n = PLAN.persona.nombre;
  if (days >= 7) return n + ', llevas ' + days + ' días sin "' + t.titulo + '". Esto rompe el plan y aleja la boda y el apartamento. Hazlo HOY.';
  if (days >= 3) return days + ' días de retraso en "' + t.titulo + '". ' + (t.tipo === 'pago' ? 'Cada día de mora suma intereses y te puede reportar en centrales de riesgo.' : 'Si no lo haces, esa plata se va en otra cosa.');
  return (days === 1 ? 'Ayer' : 'Hace ' + days + ' días') + ' tocaba: "' + t.titulo + '". ¿Ya lo hiciste? Márcalo.';
}
function cierrePendiente() {
  var h = todayStr(), cm = h.slice(0, 7);
  var prev = PLAN.meses.filter(function (m) { return m.id < cm; }).map(function (m) { return m.id; });
  var ultimo = prev[prev.length - 1];
  if (!ultimo || STATE.cierres[ultimo]) return null;
  var dia = Number(h.slice(8)); if (dia < 8) return null;   // antes de eso lo recuerda la tarea de extractos
  return { mes: ultimo, dias: dia, nivel: dia > 10 ? 'bad' : 'warn' };
}
function gastosMes(mes) { return STATE.gastos.filter(function (g) { return g.fecha.slice(0, 7) === mes; }); }
function gastoPorSobre(mes) { var r = {}; gastosMes(mes).forEach(function (g) { r[g.cat] = (r[g.cat] || 0) + g.monto; }); return r; }
function pendingCount() { var c = cierrePendiente(); return overdue().length + dueRange(todayStr(), todayStr()).length + (c && c.dias > 5 ? 1 : 0); }
function updateBell() {
  if (!PLAN) return; var n = pendingCount(), el = $('#bellCount'); el.hidden = !n; el.textContent = n; $('#bell').classList.toggle('ring', n > 0);
  if ('setAppBadge' in navigator) { try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () { }); } catch (e) { } }
}
function mesActual() { return PLAN.meses.filter(function (x) { return x.id === curMonth(); })[0] || PLAN.meses[0]; }
function deudaInicial() { return sum(PLAN.meses[0].saldosIni); }
function latestRealDebt() {
  var ks = Object.keys(STATE.saldos).sort(); if (!ks.length) return null;
  var k = ks[ks.length - 1], s = STATE.saldos[k], tot = 0, any = false;
  (PLAN.deudas || []).forEach(function (d) { if (s[d.id] != null) { tot += +s[d.id]; any = true; } });
  return any ? { fecha: s.fecha || (k + '-28'), total: tot } : null;
}
var ICON_TIPO = { pago: '💸', ahorro: '🐷', transferencia: '🔁', tramite: '📋', compra: '🛍️', revision: '🔎' };
var COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c9)', 'var(--c10)', 'var(--c8)'];
var DEBT_COLORS = { vc: 'var(--c4)', vi: 'var(--c3)', occ: 'var(--c2)' };

/* ---------- Componentes gráficos ---------- */
function ringSVG(pct, size, stroke) {
  size = size || 112; stroke = stroke || 11; var r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
    '<circle class="ring-bar" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" data-off="' + off + '"/></svg>';
}
function donutSVG(items, size) {
  size = size || 150; var stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r, total = items.reduce(function (a, b) { return a + b.v; }, 0) || 1, acc = 0, out = '';
  items.forEach(function (it, i) {
    var len = c * it.v / total, gap = items.length > 1 ? 2 : 0;
    out += '<circle class="donut-seg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + it.c + '" stroke-width="' + stroke + '" stroke-dasharray="0 ' + c + '" data-da="' + Math.max(0, len - gap) + ' ' + (c - Math.max(0, len - gap)) + '" stroke-dashoffset="' + (-acc) + '"/>';
    acc += len;
  });
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="' + stroke + '"/>' + out + '</svg>';
}
function areaChart(serie, markers, opts) {
  opts = opts || {}; var W = 340, H = opts.h || 150, P = 8, n = serie.length; if (!n) return '';
  var max = Math.max.apply(null, serie.map(function (s) { return s.v; }).concat([1]));
  function X(i) { return P + (W - 2 * P) * (n === 1 ? 0 : i / (n - 1)); }
  function Y(v) { return H - 18 - (H - 34) * v / max; }
  var d = serie.map(function (s, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(s.v).toFixed(1); }).join(' ');
  var fill = d + ' L' + X(n - 1).toFixed(1) + ' ' + (H - 18) + ' L' + X(0).toFixed(1) + ' ' + (H - 18) + ' Z';
  var cm = curMonth(), ti = serie.map(function (s) { return s.k; }).indexOf(cm), mk = '';
  if (ti >= 0) mk += '<line class="today" x1="' + X(ti) + '" x2="' + X(ti) + '" y1="6" y2="' + (H - 18) + '"/><text class="mk" x="' + (X(ti) + 4) + '" y="14">hoy</text>';
  (markers || []).forEach(function (m) { var i = serie.map(function (s) { return s.k; }).indexOf(m.k); if (i < 0) return; mk += '<text x="' + X(i) + '" y="' + (Y(serie[i].v) - 8) + '" text-anchor="middle" font-size="15">' + m.i + '</text>'; });
  return '<div class="area"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Gráfica') + '"><defs>' +
    '<linearGradient id="gline" x1="0" x2="1"><stop offset="0" stop-color="#f43f5e"/><stop offset=".5" stop-color="#6366f1"/><stop offset="1" stop-color="#0d9488"/></linearGradient>' +
    '<linearGradient id="gfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".35"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>' +
    '<path class="fill" d="' + fill + '"/><path class="line" d="' + d + '"/>' + mk + '</svg>' +
    '<div class="axis"><span>' + monthShort(serie[0].k) + '</span><span>' + monthShort(serie[n - 1].k) + '</span></div></div>';
}
function bar(pct, cls) { return '<div class="bar ' + (cls || '') + '"><i data-w="' + Math.max(0, Math.min(100, pct)).toFixed(1) + '"></i></div>'; }
function countEl(v, kind) { return '<span class="cnt" data-to="' + v + '" data-k="' + (kind || 'money') + '">' + (kind === 'int' ? '0' : money(0)) + '</span>'; }
function stagger() { Array.prototype.forEach.call(view.querySelectorAll('.anim > *'), function (el, i) { el.style.setProperty('--i', Math.min(i, 12)); }); }
function animate() {
  stagger();
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    Array.prototype.forEach.call(view.querySelectorAll('[data-w]'), function (el) { el.style.width = el.dataset.w + '%'; });
    Array.prototype.forEach.call(view.querySelectorAll('.ring-bar[data-off]'), function (el) { el.style.strokeDashoffset = el.dataset.off; });
    Array.prototype.forEach.call(view.querySelectorAll('.donut-seg[data-da]'), function (el) { el.style.strokeDasharray = el.dataset.da; });
    var road = view.querySelector('.road .rail i'); if (road) road.style.width = road.dataset.w + '%';
    Array.prototype.forEach.call(view.querySelectorAll('.cnt'), function (el) {
      var to = +el.dataset.to, k = el.dataset.k, t0 = performance.now(), dur = 1100;
      function f(t) { var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = to * e;
        el.textContent = k === 'int' ? Math.round(v).toLocaleString('es-CO') : k === 'k' ? moneyK(v) : money(v); if (p < 1) requestAnimationFrame(f); }
      requestAnimationFrame(f);
    });
  }); });
}
function confetti(x, y) {
  var cols = ['#0d9488', '#6366f1', '#f59e0b', '#f43f5e', '#10b981', '#0ea5e9'];
  for (var i = 0; i < 22; i++) {
    var s = document.createElement('i'); s.className = 'confetti'; s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.background = cols[i % cols.length];
    var a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
    s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', (Math.sin(a) * d - 40) + 'px'); s.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    document.body.appendChild(s); setTimeout(function (el) { return function () { el.remove(); }; }(s), 1000);
  }
}

/* ---------- Navegación ---------- */
function go(tab) {
  TAB = tab; var idx = 0; if (tab === 'mes') vMes._scrolled = false;
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b, i) { var on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) idx = i; });
  $('#tabInd').style.transform = 'translateX(' + (idx * 100) + '%)';
  render(); window.scrollTo(0, 0);
}
function render() {
  var f = { hoy: vHoy, mes: vMes, avance: vAvance, deudas: vAvance, metas: vMetas, gastos: vGastos, mas: vMas }[TAB] || vHoy;
  view.innerHTML = '<div class="anim">' + f() + '</div>'; bindCommon(); animate();
}
function bindCommon() {
  Array.prototype.forEach.call(view.querySelectorAll('input[data-task]'), function (cb) {
    cb.onchange = function (ev) {
      var id = cb.dataset.task;
      if (cb.checked) { STATE.checks[id] = { t: new Date().toISOString() }; var r = cb.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); toast('✔ ¡Bien hecho! Así se cumple el plan.'); }
      else delete STATE.checks[id];
      saveState(); setTimeout(render, 450);
    };
  });
  Array.prototype.forEach.call(view.querySelectorAll('[data-mes]'), function (b) { b.onclick = function () { MES_SEL = b.dataset.mes; go('mes'); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-meta]'), function (b) { b.onclick = function () { META_SEL = b.dataset.meta; if (TAB !== 'metas') go('metas'); else { render(); var d = $('#metaDet'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) { b.onclick = function () { go(b.dataset.go); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-act]'), function (b) { b.onclick = function () { ACT[b.dataset.act](b); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-rdia]'), function (b) { b.onclick = function () { abrirDia(b.dataset.rdia, b.dataset.rg); }; b.onkeydown = function (e) { if (e.key === 'Enter') abrirDia(b.dataset.rdia, b.dataset.rg); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-guia]'), function (b) { b.onclick = function (e) { e.stopPropagation(); abrirGuia(b.dataset.guia); }; b.onkeydown = function (e) { if (e.key === 'Enter') abrirGuia(b.dataset.guia); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-done]'), function (b) { b.onclick = function () { toggleDone(b.dataset.done, b); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-mnav]'), function (b) { b.onclick = function () { var ids = PLAN.meses.map(function (x) { return x.id; }), i = ids.indexOf(MES_SEL) + Number(b.dataset.mnav); if (i >= 0 && i < ids.length) { MES_SEL = ids[i]; vMes._scrolled = false; render(); window.scrollTo(0, 0); } }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-mf]'), function (b) { b.onclick = function () { MES_FILTRO = b.dataset.mf; render(); }; });
  Array.prototype.forEach.call(view.querySelectorAll('[data-ef]'), function (b) { b.onclick = function () { EF_MODO = b.dataset.ef; render(); }; });
  Array.prototype.forEach.call(view.querySelectorAll('.nx[data-dia]'), function (b) { b.onclick = function () { var f = b.dataset.dia; MES_SEL = f.slice(0, 7); go('mes'); setTimeout(function () { var el = document.getElementById('d-' + f); if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); } }, 120); }; });
  var imp = $('#imp'); if (imp) imp.onchange = function () { var f = imp.files[0]; if (!f) return; f.text().then(function (t) { var j = JSON.parse(t); if (j.state) { STATE = Object.assign(loadState(), j.state); saveState(); toast('Progreso importado'); render(); } }).catch(function () { toast('Archivo inválido'); }); };
}

/* ---------- Tarjetas de acción ---------- */
var VERBO = { pago: ['💸', 'PAGAR', 'v-pago'], transferencia: ['🔁', 'TRANSFERIR', 'v-transf'], ahorro: ['🐷', 'AHORRAR', 'v-ahorro'], compra: ['🛍️', 'COMPRAR', 'v-compra'], tramite: ['📋', 'HACER', 'v-tramite'], revision: ['📂', 'CERRAR MES', 'v-rev'] };
var ORDEN_G = { q1: 0, q2: 1, otros: 2, cierre: 3 };
function byFecha(a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (ORDEN_G[a.grupo] || 2) - (ORDEN_G[b.grupo] || 2); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function cuando(f, rel) { var d = daysBetween(todayStr(), f); return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d === -1 ? 'Ayer' : d < 0 ? 'Hace ' + (-d) + ' días' : rel ? 'En ' + d + ' días' : cap(fDate(f)); }
function cardHTML(t, opts) {
  opts = opts || {}; var h = todayStr(), done = isDone(t.id), late = !done && t.fecha < h, v = VERBO[t.tipo] || ['📌', 'HACER', 'v-tramite'];
  var ruta = (t.desde || t.hacia) ? '<div class="ac-ruta">' + (t.desde ? 'Desde <b>' + esc(t.desde) + '</b>' : '') + (t.hacia ? (t.desde ? ' → a ' : 'A ') + '<b>' + esc(t.hacia) + '</b>' : '') + '</div>' : '';
  return '<article class="ac ' + v[2] + (done ? ' done' : '') + (late ? ' late' : '') + '">' +
    '<div class="ac-top"><span class="ac-verb">' + v[0] + ' ' + v[1] + (t.critica && !done ? (t.tipo === 'pago' ? ' · CON FECHA LÍMITE' : ' · IMPORTANTE') : '') + '</span>' + (opts.fecha === false && !late ? '' : '<span class="ac-when">' + (late ? '⚠️ ' : '') + cuando(t.fecha) + '</span>') + '</div>' +
    '<div class="ac-t">' + esc(t.titulo) + '</div>' +
    (t.monto ? '<div class="ac-amt num">' + money(t.monto) + '</div>' : '') + ruta +
    (late ? '<div class="ac-nag">' + esc(nagText(t, daysBetween(t.fecha, h))) + '</div>' : '') +
    (t.detalle ? '<details class="ac-how"><summary>Detalle</summary><p>' + esc(t.detalle) + '</p></details>' : '') +
    (t.guia ? '<button class="ac-guia" data-guia="' + t.guia + '">📘 Cómo se hace, paso a paso</button>' : '') +
    '<button class="ac-btn" data-done="' + esc(t.id) + '">' + (done ? '✓ Hecho · deshacer' : 'Ya lo hice ✔') + '</button></article>';
}
function filaHTML(t) {
  var v = VERBO[t.tipo] || ['📌'];
  return '<div class="nx" data-dia="' + t.fecha + '"><span class="nx-d">' + cuando(t.fecha) + '</span><span class="nx-t">' + v[0] + ' ' + esc(t.titulo) + '</span>' + (t.monto ? '<b class="num">' + moneyK(t.monto) + '</b>' : '<span></span>') + '</div>';
}
function taskHTML(t) { return cardHTML(t); }
function toggleDone(id, el) {
  if (isDone(id)) { delete STATE.checks[id]; toast('Marcada como pendiente'); }
  else { STATE.checks[id] = { t: new Date().toISOString() }; if (el) { var r = el.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 10); } toast('✔ ¡Bien hecho! Una menos.'); }
  saveState(); updateBell(); syncPendientes(); setTimeout(render, 380);
}

/* ---------- Hoy: solo lo que hay que hacer ---------- */
function vHoy() {
  var h = todayStr(), od = overdue().sort(byFecha), hoy = allTasks().filter(function (t) { return t.fecha === h; }).sort(byFecha), cp = cierrePendiente();
  var pend = hoy.filter(function (t) { return !isDone(t.id); }), n = od.length + pend.length;
  var prox = dueRange(addDays(h, 1), addDays(h, 7)).sort(byFecha);
  var entra = (PLAN.ingresos || []).filter(function (i) { return i.fecha === h; });
  var html = '<section class="hero"><div class="hi">' + cap(fDateLong(h)) + '</div><h1 style="margin:.2rem 0 .3rem">' +
    (n ? 'Hoy tienes ' + n + ' cosa' + (n > 1 ? 's' : '') + ' por hacer' : 'Hoy estás al día 🙌') + '</h1><div class="small" style="opacity:.92">' +
    (od.length ? '⚠️ ' + od.length + ' atrasada' + (od.length > 1 ? 's' : '') + '. ' : '') + (hoy.length ? (hoy.length - pend.length) + ' de ' + hoy.length + ' de hoy ya hechas.' : 'No hay nada programado para hoy.') + '</div>' +
    entra.map(function (i) { return '<span class="chip">💰 Hoy entra: ' + esc(i.concepto) + ' ' + money(i.monto) + '</span>'; }).join('') + '</section>';
  html += alarmBanner();
  if (STATE.modoB) html += '<div class="alert bad"><div class="ai">🛟</div><div><b>Plan B activo desde ' + fDateLong(STATE.modoB.fecha) + '</b>Tus tareas del plan B ya están en Hoy y en Mes (marcadas con 🛟). No abones extra al crédito y no uses tarjetas para vivir. Escríbeme para recalcular todo con tus números reales.<div class="act"><button class="btn small ghost" data-act="modoBOff">Ya tengo empleo: desactivar</button></div></div></div>';
  if (od.length) html += '<h2 class="sec bad-t">⚠️ Atrasado: hazlo primero</h2>' + od.map(function (t) { return cardHTML(t); }).join('');
  if (hoy.length) html += '<h2 class="sec">📌 Hoy</h2>' + hoy.map(function (t) { return cardHTML(t, { fecha: false }); }).join('');
  else if (!od.length) html += '<div class="alert ok"><div class="ai">🙌</div><div><b>Hoy no tienes que pagar ni hacer nada</b>Si gastas en efectivo, anótalo.<div class="act"><button class="btn small" data-go="gastos">Anotar efectivo</button></div></div></div>';
  if (cp) html += '<div class="alert ' + cp.nivel + '"><div class="ai">📂</div><div><b>' + (cp.nivel === 'bad' ? 'REGAÑO: no has cerrado ' : 'Cierra ') + monthName(cp.mes) + '</b>Sube los extractos a Drive y anota tus saldos reales.<div class="act"><button class="btn small" data-act="cierre" data-m="' + cp.mes + '">Hacer el cierre</button></div></div></div>';
  var mm = mesActual(), g = gastoPorSobre(mm.id);
  (mm.sobres || []).forEach(function (s) { var u = g[s.id] || 0; if (u > s.monto) html += '<div class="alert bad"><div class="ai">🛑</div><div><b>Te pasaste en ' + esc(s.nombre.split(' (')[0]) + '</b>Llevas ' + money(u) + ' de ' + money(s.monto) + '. No gastes más en esto este mes.</div></div>'; });
  html += '<div class="card"><h2><span class="tt"><span class="ic">🗓️</span>Lo que viene (7 días)</span></h2>' +
    (prox.length ? prox.map(filaHTML).join('') : '<p class="muted small">Nada en los próximos 7 días.</p>') +
    '<button class="btn block ghost" style="margin-top:.6rem" data-go="mes">Ver todo el mes en orden</button></div>';
  return html;
}

/* ---------- Mes: agenda en orden de fecha ---------- */
var MES_FILTRO = 'pend';
function vMes() {
  var idx = PLAN.meses.map(function (x) { return x.id; }).indexOf(MES_SEL); if (idx < 0) idx = 0;
  var m = PLAN.meses[idx], h = todayStr(), ts = m.tareas.concat(tareasB().filter(function (t) { return t.mes === m.id; })).sort(byFecha);
  var pend = ts.filter(function (t) { return !isDone(t.id); }), hechas = ts.length - pend.length;
  var lista = MES_FILTRO === 'pend' ? pend : ts, porMover = pend.reduce(function (a, t) { return a + (t.monto || 0); }, 0);
  var html = '<div class="mnav"><button data-mnav="-1" aria-label="Mes anterior"' + (idx ? '' : ' disabled') + '>‹</button><div class="mt"><b>' + monthName(m.id) + '</b><span>' + esc(m.etiqueta || '') + '</span></div>' +
    '<button data-mnav="1" aria-label="Mes siguiente"' + (idx < PLAN.meses.length - 1 ? '' : ' disabled') + '>›</button></div>' +
    '<div class="msum"><div><b>' + pend.length + '</b>pendientes</div><div><b>' + hechas + '</b>hechas</div><div><b class="num">' + moneyK(porMover) + '</b>por pagar o mover</div></div>' +
    '<div class="seg2"><button data-mf="pend" class="' + (MES_FILTRO === 'pend' ? 'on' : '') + '">Pendientes</button><button data-mf="todo" class="' + (MES_FILTRO === 'todo' ? 'on' : '') + '">Todo el mes</button></div>';
  if (m.foco) html += '<div class="alert info"><div class="ai">🎯</div><div><b>Lo importante de este mes</b>' + esc(m.foco) + '</div></div>';
  var tope = (m.sobres || []).reduce(function (s, x) { return s + x.monto; }, 0) * (STATE.modoB && m.id >= STATE.modoB.fecha.slice(0, 7) ? 0.7 : 1), T = PLAN.tope || {};
  if (tope) html += '<div class="alert warn"><div class="ai">💸</div><div><b>Tope del día a día este mes: ' + money(tope) + '</b>Es todo lo variable: Nequi, efectivo, comidas, transporte, compras. Máximo absoluto ' + money(T.maximo || 1200000) + '; con más, el plan se rompe. En octubre gastaste ' + moneyK(T.real_oct || 0) + '.</div></div>';
  var dias = {}, orden = [];
  lista.forEach(function (t) { if (!dias[t.fecha]) { dias[t.fecha] = []; orden.push(t.fecha); } dias[t.fecha].push(t); });
  (m.ingresos || []).forEach(function (i) { if (!dias[i.fecha] && MES_FILTRO === 'todo') { dias[i.fecha] = []; orden.push(i.fecha); } });
  orden.sort();
  if (!orden.length) html += '<div class="alert ok"><div class="ai">🎉</div><div><b>Todo hecho este mes</b>Toca “Todo el mes” para ver lo que ya hiciste.</div></div>';
  orden.forEach(function (f) {
    var lateDia = f < h && dias[f].some(function (t) { return !isDone(t.id); });
    var inc = (m.ingresos || []).filter(function (i) { return i.fecha === f; });
    html += '<section class="dia' + (f === h ? ' hoy' : '') + (lateDia ? ' late' : '') + '" id="d-' + f + '"><div class="dia-h"><span class="dia-n">' + DIAS[parseD(f).getDay()] + ' ' + Number(f.slice(8)) + ' de ' + MESES[Number(f.slice(5, 7)) - 1] + '</span><span class="dia-l">' + (f === h ? 'HOY' : cuando(f, true)) + '</span></div>' +
      inc.map(function (i) { return '<div class="inc">💰 Te entra: ' + esc(i.concepto) + ' · ' + money(i.monto) + '</div>'; }).join('') +
      dias[f].map(function (t) { return cardHTML(t, { fecha: false }); }).join('') + '</section>';
  });
  if (m.flujo && m.flujo.length) html += '<details class="card"><summary><b>💵 La plata del mes (cuenta BBVA)</b></summary>' + m.flujo.map(function (f) { var neg = f.v < 0;
    return '<div class="row small" style="margin:.4rem 0' + (f.t ? ';font-weight:800' : '') + '"><span>' + esc(f.m) + '</span><b class="num" style="color:' + (f.t ? 'var(--brand2)' : neg ? 'var(--bad)' : 'var(--ok)') + '">' + (neg ? '−' : '') + money(Math.abs(f.v)) + '</b></div>'; }).join('') + '</details>';
  var g = gastoPorSobre(m.id);
  if (m.sobres && m.sobres.length) html += '<details class="card"><summary><b>✉️ Sobres del día a día (máximo del mes)</b></summary>' + m.sobres.map(function (s) { var u = g[s.id] || 0, p = s.monto ? u / s.monto * 100 : 0;
    return '<div style="margin:.55rem 0"><div class="row small"><span>' + esc(s.nombre) + '</span><span class="num"><b>' + money(u) + '</b> / ' + money(s.monto) + '</span></div>' + bar(p, u > s.monto ? 'bad' : p > 80 ? 'warn' : 'ok') + '</div>'; }).join('') + '</details>';
  if (m.saldosFin) html += '<details class="card"><summary><b>🎯 Así terminas el mes</b></summary>' + (PLAN.deudas || []).map(function (d) { return '<div class="row small" style="margin:.3rem 0"><span>' + esc(d.nombre) + '</span><b class="num">' + money(m.saldosFin[d.id] || 0) + '</b></div>'; }).join('') +
    '<div class="row" style="margin-top:.4rem"><b>Deuda total</b><b class="num">' + money(sum(m.saldosFin)) + '</b></div><div class="sec-t">Ahorros al final del mes</div>' +
    Object.keys(m.ahorrosFin || {}).filter(function (k) { return m.ahorrosFin[k] > 0; }).map(function (k) { return '<div class="row small" style="margin:.25rem 0"><span>' + esc((PLAN.bolsillos || {})[k] || k) + '</span><b class="num">' + money(m.ahorrosFin[k]) + '</b></div>'; }).join('') + '</details>';
  if (m.id === curMonth()) setTimeout(function () { var el = document.getElementById('d-' + h) || document.querySelector('.dia.late'); if (el && !vMes._scrolled) { vMes._scrolled = true; el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); } }, 60);
  return html;
}


function roadmap() {
  var hitos = PLAN.hitos || [], h = todayStr(); if (!hitos.length) return '';
  var nextIdx = hitos.findIndex(function (x) { return x.f >= h; }); if (nextIdx < 0) nextIdx = hitos.length;
  var w = hitos.length > 1 ? Math.max(0, Math.min(100, (nextIdx - .5) / (hitos.length - 1) * 100)) : 0;
  return '<div class="card"><h2><span class="tt"><span class="ic">🧭</span>Tu ruta</span><span class="pill">' + (nextIdx < hitos.length ? 'Siguiente: ' + esc(hitos[nextIdx].t) : 'Completada') + '</span></h2>' +
    '<div class="road"><div class="rail"><i data-w="' + w.toFixed(1) + '"></i></div>' + hitos.map(function (x, i) {
      return '<div class="stop ' + (i < nextIdx ? 'done' : i === nextIdx ? 'next' : '') + '"><div class="dot">' + x.i + '</div><div class="t">' + esc(x.t) + '</div><div class="d">' + monthShort(x.f.slice(0, 7)) + '</div></div>'; }).join('') + '</div></div>';
}
function donutMes(mm) {
  var L = ((mm.resumen || {}).lineas || []).filter(function (l) { return !/^Ingresos/.test(l[0]) && l[1] > 0; });
  if (!L.length) return '';
  var ing = (((mm.resumen || {}).lineas || [])[0] || [0, 0])[1];
  var items = L.map(function (l, i) { return { k: l[0], v: l[1], c: COLORS[i % COLORS.length] }; });
  return '<div class="card"><h2><span class="tt"><span class="ic">🍩</span>¿A dónde va la plata de ' + monthName(mm.id).split(' ')[0].toLowerCase() + '?</span></h2><div class="donut-wrap"><div class="donut-c">' + donutSVG(items) +
    '<div class="ctr"><div><b>' + moneyK(ing) + '</b><span>entran</span></div></div></div><ul class="dl">' +
    items.map(function (it) { return '<li><i style="background:' + it.c + '"></i><span>' + esc(it.k) + '</span><b>' + moneyK(it.v) + '</b></li>'; }).join('') + '</ul></div></div>';
}

/* ---------- Deudas ---------- */
function vDeudas() {
  var serie = PLAN.meses.map(function (m) { return { k: m.id, v: sum(m.saldosFin) }; });
  var ini = deudaInicial(), mm = mesActual(), real = latestRealDebt(), now = real ? real.total : sum(mm.saldosIni);
  var marks = (PLAN.hitos || []).map(function (h) { return { k: h.f.slice(0, 7), i: h.i }; }).filter(function (x) { return x.k <= PLAN.fechas.libreDeudas; });
  var html = '<section class="hero"><div class="stat">Deuda total hoy ' + (real ? '(lo que anotaste)' : '(según el plan)') + '</div><div class="big" style="font-size:2rem">' + countEl(now, 'money') + '</div>' +
    '<div class="stack" style="margin:.7rem 0 .3rem;background:rgba(255,255,255,.18)">' + (PLAN.deudas || []).map(function (d) { var v = (mm.saldosIni || {})[d.id] || 0; return '<i data-w="' + (now ? v / Math.max(now, 1) * 100 : 0).toFixed(1) + '" style="background:' + DEBT_COLORS[d.id] + '"></i>'; }).join('') + '</div>' +
    '<div class="small" style="opacity:.9">Pagado: ' + Math.round(Math.max(0, 1 - now / ini) * 100) + ' % de ' + moneyK(ini) + ' · libre en <b>' + monthName(PLAN.fechas.libreDeudas) + '</b></div></section>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">📉</span>Cómo baja tu deuda</span></h2>' + areaChart(serie, marks, { label: 'Deuda total por mes' }) +
    '<div class="legend">' + (PLAN.deudas || []).map(function (d) { return '<span><i style="background:' + DEBT_COLORS[d.id] + '"></i>' + esc(d.corto) + '</span>'; }).join('') + '</div>' +
    '<p class="small muted" style="margin-top:.6rem">Orden de ataque: primero la tasa más alta (tarjetas), después el crédito del banco. Cada abono extra: “reducción de plazo”.</p></div>';
  (PLAN.deudas || []).forEach(function (d) {
    var planNow = (mm.saldosIni || {})[d.id], fin = PLAN.meses.filter(function (m) { return (m.saldosFin[d.id] || 0) <= 0; })[0], p = d.saldoInicial ? Math.max(0, 1 - planNow / d.saldoInicial) : 1;
    var realV = null; Object.keys(STATE.saldos).sort().reverse().some(function (k) { if (STATE.saldos[k][d.id] != null) { realV = { k: k, v: STATE.saldos[k][d.id] }; return true; } return false; });
    html += '<div class="card"><div class="hero-grid"><div class="ring-wrap" style="width:92px;height:92px">' + ringSVG(p, 92, 10) + '<div class="ring-txt"><div><b style="font-size:1.15rem">' + Math.round(p * 100) + '%</b><span>pagado</span></div></div></div>' +
      '<div><h2 style="margin:0 0 .2rem">' + esc(d.nombre) + '</h2><span class="pill ' + (d.tasaEA > 25 ? 'bad' : 'warn') + '">' + String(d.tasaEA).replace('.', ',') + ' % E.A.</span>' +
      '<div class="row small" style="margin-top:.5rem"><span>Hoy (plan)</span><b class="num">' + money(planNow) + '</b></div>' +
      (realV ? '<div class="row small"><span>Lo que anotaste</span><b class="num">' + money(+realV.v) + '</b></div>' : '') +
      '<div class="row small"><span>Paga antes del</span><b>' + esc(d.diaPagoTxt || ('día ' + d.diaPago)) + '</b></div>' +
      '<div class="row small"><span>Queda en $0</span><b class="ok-t">' + (fin ? monthName(fin.id) : '—') + '</b></div></div></div>' +
      (d.nota ? '<p class="small muted" style="margin-top:.6rem">' + esc(d.nota) + '</p>' : '') + '</div>';
  });
  html += '<div class="card"><details><summary>📅 Calendario de saldos mes a mes</summary><div class="scroll" style="margin-top:.5rem"><table><tr><th>Mes</th>' + PLAN.deudas.map(function (d) { return '<th class="n">' + esc(d.corto) + '</th>'; }).join('') + '<th class="n">Total</th></tr>' +
    PLAN.meses.map(function (m) { return '<tr' + (m.id === curMonth() ? ' style="background:var(--warn-soft)"' : '') + '><td>' + monthShort(m.id) + '</td>' + PLAN.deudas.map(function (d) { return '<td class="n">' + moneyK(m.saldosFin[d.id] || 0) + '</td>'; }).join('') + '<td class="n"><b>' + moneyK(sum(m.saldosFin)) + '</b></td></tr>'; }).join('') + '</table></div></details></div>';
  return html;
}

/* ---------- Metas ---------- */
function linkify(c) {
  var s = String(c == null ? '' : c);
  if (/^(https?:\/\/)?[a-z0-9.-]+\.(com|co|app|org|net)(\.[a-z]{2})?(\/\S*)?$/i.test(s)) { var url = /^https?:/.test(s) ? s : 'https://' + s; return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.replace(/^https?:\/\//, '')) + ' ↗</a>'; }
  return esc(s);
}
function tablaHTML(tb) {
  return '<div class="card"><h2><span class="tt">' + esc(tb.titulo) + '</span></h2>' + (tb.intro ? '<p class="tb-intro">' + esc(tb.intro) + '</p>' : '') + (tb.nota ? '<p class="tb-nota">💡 ' + esc(tb.nota) + '</p>' : '') + '<div class="scroll"><table><tr>' +
    tb.cols.map(function (c, i) { return '<th class="' + (tb.num && tb.num.indexOf(i) >= 0 ? 'n' : '') + '">' + esc(c) + '</th>'; }).join('') + '</tr>' +
    tb.filas.map(function (r) { var cells = r.c || r; return '<tr class="' + (r._tot ? 'tot' : '') + '">' + cells.map(function (c, i) { var isN = tb.num && tb.num.indexOf(i) >= 0; return '<td class="' + (isN ? 'n' : '') + '">' + (isN && typeof c === 'number' ? money(c) : linkify(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></div>';
}
function vMetas() {
  var metas = PLAN.metas || [], h = todayStr();
  var html = '<div class="goals">' + metas.map(function (m) {
    var sub = m.fecha ? (m.fecha >= h ? 'en ' + daysBetween(h, m.fecha) + ' días' : 'cumplida ✓') : (m.corto || '');
    return '<button class="goal ' + (m.id === META_SEL ? 'on' : '') + '" data-meta="' + m.id + '"><div class="gi">' + (m.icono || '🎯') + '</div><div class="gn">' + esc(m.corto || m.nombre) + '</div><div class="gd">' + (m.fecha ? fDate(m.fecha) + ' ' + m.fecha.slice(0, 4) + ' · ' : '') + sub + '</div></button>'; }).join('') + '</div>';
  var m = metas.filter(function (x) { return x.id === META_SEL; })[0] || metas[0];
  html += '<section class="hero" id="metaDet"><div class="stat">' + (m.icono || '') + ' Meta</div><div class="big">' + esc(m.nombre) + '</div>' +
    (m.fecha ? '<span class="chip">📅 ' + fDateLong(m.fecha) + '</span>' : '') + (m.objetivo ? '<span class="chip">🎯 ' + money(m.objetivo) + '</span>' : '') + '</section>';
  if (m.id === 'planb') html += planBCard();
  var GM = { viaje: 'sf', boda: 'boda', luna: 'cancun', deudas: 'deudas', u: 'cesantias', vivienda: 'apto', papas: 'papas', planb: 'control_b' };
  if (m.resumen) html += '<div class="card"><p style="margin:0">' + esc(m.resumen) + '</p>' + (GM[m.id] && (PLAN.guias || {})[GM[m.id]] ? '<button class="ac-guia" data-guia="' + GM[m.id] + '">📘 Cómo funciona, paso a paso</button>' : '') + '</div>';
  if (m.proyeccion && m.proyeccion.length) html += '<div class="card"><h2><span class="tt"><span class="ic">📈</span>' + (m.id === 'deudas' ? 'Cómo baja' : 'Cómo crece') + '</span></h2>' + areaChart(m.proyeccion.map(function (p) { return { k: p.mes, v: p.saldo }; }), [], { label: m.nombre }) + '</div>';
  (m.tablas || []).forEach(function (tb) { html += tablaHTML(tb); });
  (m.listas || []).forEach(function (l) { html += '<div class="card"><h2><span class="tt">' + esc(l.titulo) + '</span></h2><ul class="list-plain">' + l.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>'; });
  var ts = allTasks().filter(function (t) { return (t.metas || []).indexOf(m.id) >= 0; });
  if (ts.length && m.id !== 'deudas') html += '<div class="card"><h2><span class="tt"><span class="ic">✅</span>Pasos de esta meta</span><span class="pill">' + ts.filter(function (t) { return isDone(t.id); }).length + '/' + ts.length + '</span></h2>' + ts.map(function (t) { return taskHTML(t); }).join('') + '</div>';
  return html;
}

/* ---------- Guías paso a paso ---------- */
function guiaHTML(key) {
  var g = (PLAN.guias || {})[key]; if (!g) return '<p>Sin guía.</p><button class="btn block" id="mclose">Cerrar</button>';
  function sec(ic, t, body) { return body ? '<div class="g-sec"><div class="g-h">' + ic + ' ' + t + '</div>' + body + '</div>' : ''; }
  return '<div class="guia"><div class="g-tag">📘 Guía paso a paso</div><h2>' + esc(g.titulo) + '</h2><p class="g-que">' + esc(g.que) + '</p>' +
    sec('🪜', 'Cómo se hace', '<ol class="g-pasos">' + (g.pasos || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>') +
    sec('🙋', '¿Quién lo hace?', '<p>' + esc(g.quien) + '</p>') +
    sec('💸', '¿Cuesta algo o te descuentan algo?', '<p>' + esc(g.costo) + '</p>') +
    sec('🔁', '¿De dónde sale o a dónde llega la plata?', '<p>' + esc(g.plata) + '</p>') +
    (g.secciones || []).map(function (s) { var tag = s.ol ? 'ol' : 'ul'; return sec('📌', esc(s.t), '<' + tag + ' class="g-ojo">' + s.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</' + tag + '>'); }).join('') +
    ((g.ojo || []).length ? sec('⚠️', 'Ojo', '<ul class="g-ojo">' + g.ojo.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul>') : '') +
    '<button class="btn block" id="mclose" style="margin-top:.9rem">Entendido</button></div>';
}
function abrirGuia(key) { openModal(guiaHTML(key)); var b = document.querySelector('#modal .box'); if (b) b.scrollTop = 0; }

/* ---------- Ruta: lo que pasa ESE día ---------- */
function diaHTML(f, guia) {
  var ins = (PLAN.ingresos || []).filter(function (i) { return i.fecha === f; });
  var ts = allTasks().filter(function (t) { return t.fecha === f; }).sort(byFecha), titulo = 'Lo que haces el ' + fDateLong(f);
  if (!ts.length) { var a = addDays(f, -7), b = addDays(f, 7); ts = allTasks().filter(function (t) { return t.fecha >= a && t.fecha <= b; }).sort(byFecha); titulo = 'Lo que haces esa semana (' + fDate(a) + ' a ' + fDate(b) + ')';
    ins = (PLAN.ingresos || []).filter(function (i) { return i.fecha >= a && i.fecha <= b; }); }
  var entra = ins.reduce(function (s, i) { return s + i.monto; }, 0), sale = ts.reduce(function (s, t) { return s + (t.monto || 0); }, 0);
  var m = PLAN.meses.filter(function (x) { return x.id === f.slice(0, 7); })[0];
  var h = '<div class="guia"><div class="g-tag">📅 Paso de tu ruta</div><h2>' + esc(titulo) + '</h2>';
  if (ins.length) h += '<div class="g-sec"><div class="g-h">💰 Ese día te entra</div><ul class="g-ojo">' + ins.map(function (i) { return '<li>' + esc(i.concepto) + ': <b>' + money(i.monto) + '</b></li>'; }).join('') + '</ul><p><b>Total: ' + money(entra) + '</b></p></div>';
  h += '<div class="g-sec"><div class="g-h">✅ Haces esto, en este orden</div>' + (ts.length ? '<ol class="g-pasos">' + ts.map(function (t) {
      return '<li><b>' + esc(t.titulo) + '</b>' + (t.monto ? ' — <b>' + money(t.monto) + '</b>' : '') + ((t.desde || t.hacia) ? '<br><span class="small muted">' + (t.desde ? 'Desde ' + esc(t.desde) : '') + (t.hacia ? ' → a ' + esc(t.hacia) : '') + '</span>' : '') +
        (t.guia ? '<br><button class="ac-guia" data-g2="' + t.guia + '" style="margin-top:.35rem">📘 Cómo se hace</button>' : '') + '</li>'; }).join('') + '</ol>' : '<p>Ese día no tienes pagos: es un hito del plan.</p>') +
    (sale ? '<p><b>Total que pagas o mueves: ' + money(sale) + '</b></p>' : '') + '</div>';
  if (m && m.saldosFin) h += '<div class="g-sec"><div class="g-h">📊 Así terminas ' + monthName(m.id).toLowerCase() + '</div><ul class="g-ojo">' + (PLAN.deudas || []).map(function (d) { return '<li>' + esc(d.corto || d.nombre) + ': ' + money(m.saldosFin[d.id] || 0) + '</li>'; }).join('') + '<li><b>Deuda total: ' + money(sum(m.saldosFin)) + '</b></li></ul></div>';
  if (guia) h += '<button class="ac-guia" data-g2="' + guia + '">📖 Entender más sobre este paso</button>';
  return h + '<button class="btn block" id="mclose" style="margin-top:.9rem">Entendido</button></div>';
}
function abrirDia(f, guia) {
  openModal(diaHTML(f, guia)); var b = document.querySelector('#modal .box'); if (b) b.scrollTop = 0;
  Array.prototype.forEach.call(document.querySelectorAll('#modal [data-g2]'), function (x) { x.onclick = function (e) { e.stopPropagation(); abrirGuia(x.dataset.g2); }; });
}

/* ---------- Ruta: la línea de tiempo completa ---------- */
function primerCero(id) { var m = PLAN.meses.filter(function (x) { return (x.saldosFin || {})[id] != null && x.saldosFin[id] <= 0; })[0]; return m ? m.id : null; }
function vRuta() {
  var h = todayStr(), mm = mesActual(), real = latestRealDebt(), now = real ? real.total : sum(mm.saldosIni), F = PLAN.fechas || {}, d = new Date();
  var faltan = F.libreDeudas ? Math.max(0, (Number(F.libreDeudas.slice(0, 4)) - d.getFullYear()) * 12 + Number(F.libreDeudas.slice(5)) - (d.getMonth() + 1)) : 0;
  var html = '<section class="hero"><div class="stat">💳 Lo que debes hoy</div><div class="big">' + countEl(now, 'money') + '</div>' +
    '<div class="small" style="opacity:.92">En $0 en <b>' + (F.libreDeudas ? monthName(F.libreDeudas) : '—') + '</b> si sigues el plan · faltan ' + faltan + ' meses</div>' +
    '<span class="chip">✂️ Tarjetas en $0: ' + (F.tarjetasCero ? monthName(F.tarjetasCero) : '—') + '</span></section>';
  var ini = PLAN.meses[0].saldosIni || {};
  html += '<div class="card"><h2><span class="tt"><span class="ic">🎯</span>Cuándo queda en $0 cada deuda</span></h2>' + (PLAN.deudas || []).map(function (dd) {
    var v0 = ini[dd.id] || 0, vh = (mm.saldosIni || {})[dd.id] || 0, z = primerCero(dd.id), p = v0 ? Math.max(0, 1 - vh / v0) * 100 : 100;
    return '<div style="margin:.6rem 0"><div class="row small"><span><b>' + esc(dd.corto || dd.nombre) + '</b> · ' + (dd.tasaEA ? String(dd.tasaEA).replace('.', ',') + ' % E.A.' : '') + '</span><span class="num">' + money(vh) + '</span></div>' +
      bar(p, 'ok') + '<div class="tiny muted">En $0: <b>' + (z ? monthName(z) : '—') + '</b></div></div>'; }).join('') + '</div>';
  var R = PLAN.ruta || [], idx = R.findIndex(function (x) { return x.fecha >= h; }); if (idx < 0) idx = R.length;
  html += '<div class="card"><h2><span class="tt"><span class="ic">🧭</span>Tu ruta completa, paso a paso</span></h2><p class="tb-intro">Toca cualquier punto: verás SOLO lo de ese día (cuánto te entra, qué pagas y en qué orden, y cómo quedas). Desde ahí puedes abrir la guía paso a paso de cada acción.</p><div class="tl">' + R.map(function (x, i) {
    var cls = 'tl-i t-' + x.tipo + (i < idx ? ' past' : i === idx ? ' next' : '');
    var chips = (x.deuda != null ? '<span>💳 Deuda: ' + moneyK(x.deuda) + '</span>' : '') + (x.fna != null ? '<span>🏦 Cesantías: ' + moneyK(x.fna) + '</span>' : '');
    return (i === idx ? '<div class="tl-here">📍 Estás aquí</div>' : '') + '<div class="' + cls + ' tl-click' + '" data-rdia="' + x.fecha + '" data-rg="' + (x.guia || '') + '" role="button" tabindex="0"><div class="tl-dot">' + (i < idx ? '✓' : x.icono) + '</div><div class="tl-f">' + cap(fDate(x.fecha)) + ' ' + x.fecha.slice(0, 4) + (i === idx ? ' · PRÓXIMO' : '') + '</div>' +
      '<div class="tl-t">' + esc(x.titulo) + '</div><div class="tl-d">' + esc(x.detalle) + '</div>' + (chips ? '<div class="tl-chips">' + chips + '</div>' : '') + '<div class="tl-ver">Ver qué haces ese día →</div>' + '</div>'; }).join('') + '</div></div>';
  (PLAN.palancas || []).forEach(function (tb) { html += tablaHTML(tb); });
  if (PLAN.refi) html += tablaHTML(PLAN.refi);
  if (PLAN.tasas) html += tablaHTML(PLAN.tasas);
  html += '<details class="card"><summary><b>📈 Gráficas de deudas y del mes</b></summary>' + vDeudas() + donutMes(mm) + '</details>';
  return html;
}
function vAvance() { return vRuta(); }

/* ---------- Alarmas: ¿están al día? ---------- */
function horario() { var s = ''; allTasks().forEach(function (t) { s += t.fecha + t.titulo + (t.monto || 0); }); (PLAN.ingresos || []).forEach(function (i) { s += i.fecha + i.monto; });
  var hsh = 5381; for (var i = 0; i < s.length; i++) hsh = ((hsh << 5) + hsh + s.charCodeAt(i)) | 0; return String(hsh >>> 0); }
function alarmBanner() {
  var hs = horario(); if (STATE.icsHash === hs) return '';
  var nuevo = !STATE.icsHash;
  return '<div class="alert ' + (nuevo ? 'warn' : 'bad') + '"><div class="ai">⏰</div><div><b>' + (nuevo ? 'Activa tus alarmas diarias (una sola vez)' : 'El plan cambió: actualiza tus alarmas (2 minutos)') + '</b>' +
    (nuevo ? 'En el computador: Más → Descargar alarmas → impórtalas en un calendario “Finanzas” de Google Calendar. Te sonará cada mañana y cada tarde lo que toca.'
           : '1) calendar.google.com → ⚙️ → calendario “Finanzas” → Eliminar calendario. 2) Crea otro llamado “Finanzas”. 3) ⚙️ → Importar → el archivo nuevo → “Finanzas”.') +
    '<div class="act"><button class="btn small" data-act="ics">Descargar alarmas</button> <button class="btn small ghost" data-act="icsOk">Ya las importé</button></div></div></div>';
}

/* ---------- Efectivo: lo que sacas del cajero vs. lo que gastas en efectivo ---------- */
var GASTO_CAT = null, EF_MODO = 'gasto';
function retirosMes(mes) { return (STATE.retiros || []).filter(function (r) { return r.fecha.slice(0, 7) === mes; }); }
function vGastos() {
  var m = mesActual(), sobres = m.sobres || [], gs = gastosMes(m.id), rs = retirosMes(m.id);
  if (!GASTO_CAT || !sobres.some(function (s) { return s.id === GASTO_CAT; })) GASTO_CAT = sobres.length ? sobres[0].id : null;
  var gastado = gs.reduce(function (a, b) { return a + b.monto; }, 0), retirado = rs.reduce(function (a, b) { return a + b.monto; }, 0), bolsillo = retirado - gastado;
  var mov = gs.map(function (g) { return { tipo: 'g', x: g }; }).concat(rs.map(function (r) { return { tipo: 'r', x: r }; })).sort(function (a, b) { return a.x.fecha < b.x.fecha ? 1 : -1; });
  var html = '<section class="hero"><div class="stat">💵 Tu efectivo · ' + monthName(m.id) + '</div>' +
    '<div class="ef3"><div><span>Sacaste</span><b class="num">' + money(retirado) + '</b></div><div><span>Gastaste</span><b class="num">' + money(gastado) + '</b></div><div><span>Debes tener</span><b class="num">' + money(bolsillo) + '</b></div></div>' +
    '<div class="small" style="opacity:.92;margin-top:.4rem">' + (bolsillo < 0 ? '⚠️ Anotaste más gastos que retiros: ¿te faltó anotar un retiro?' : retirado && bolsillo > 0 ? 'Cuenta tu billetera: si tienes menos de ' + money(bolsillo) + ', te faltó anotar un gasto.' : 'Anota cada retiro del cajero y cada gasto en efectivo.') + '</div></section>' +
    '<div class="alert info"><div class="ai">ℹ️</div><div><b>Aquí solo va el efectivo</b>Lo que pagas con tarjeta, débito o transferencia lo saco yo de tus extractos cuando cierras el mes.</div></div>' +
    '<div class="card"><div class="seg2"><button data-ef="gasto" class="' + (EF_MODO === 'gasto' ? 'on' : '') + '">Gasté en efectivo</button><button data-ef="retiro" class="' + (EF_MODO === 'retiro' ? 'on' : '') + '">Saqué del cajero</button></div>' +
    '<input id="gm" class="i money-in" inputmode="numeric" placeholder="$ 0" aria-label="Monto">';
  if (EF_MODO === 'gasto') html += '<label class="f">¿En qué?</label><div class="cats">' + sobres.map(function (s) { return '<button data-cat="' + s.id + '" class="' + (s.id === GASTO_CAT ? 'on' : '') + '">' + esc(s.nombre.split(' (')[0]) + '</button>'; }).join('') + '</div>' +
    '<div class="row" style="gap:.5rem;margin-top:.3rem"><div style="flex:1"><label class="f" for="gn">Nota</label><input id="gn" class="i" placeholder="Ej. almuerzo sábado"></div><div style="width:42%"><label class="f" for="gf">Fecha</label><input id="gf" class="i" type="date" value="' + todayStr() + '"></div></div>' +
    '<button class="btn block" style="margin-top:.8rem" data-act="addGasto">Guardar gasto en efectivo</button>';
  else html += '<div class="row" style="gap:.5rem;margin-top:.3rem"><div style="flex:1"><label class="f" for="gn">¿De qué cuenta?</label><select id="gn" class="i"><option>Nequi</option><option>BBVA</option><option>Otra</option></select></div><div style="width:42%"><label class="f" for="gf">Fecha</label><input id="gf" class="i" type="date" value="' + todayStr() + '"></div></div>' +
    '<button class="btn block" style="margin-top:.8rem" data-act="addRetiro">Guardar retiro</button>';
  html += '</div><div class="card"><h2><span class="tt"><span class="ic">🧾</span>Movimientos de efectivo del mes</span></h2>' +
    (mov.length ? '<table>' + mov.map(function (o) { var x = o.x, es = o.tipo === 'r';
      var nom = es ? '🏧 Retiro · ' + esc(x.nota || '') : '💵 ' + esc(((sobres.filter(function (s) { return s.id === x.cat; })[0] || {}).nombre || x.cat || '').split(' (')[0]) + (x.nota ? ' · ' + esc(x.nota) : '');
      return '<tr><td>' + fDate(x.fecha) + '<div class="tiny muted">' + nom + '</div></td><td class="n" style="color:' + (es ? 'var(--ok)' : 'var(--ink)') + '">' + (es ? '+' : '−') + money(x.monto) + '</td><td class="n"><button class="btn small ghost" data-act="' + (es ? 'delRetiro' : 'delGasto') + '" data-id="' + x.id + '" aria-label="Borrar">✕</button></td></tr>'; }).join('') + '</table>'
      : '<p class="muted small">Aún no anotas efectivo este mes.</p>') + '</div>';
  return html;
}


/* ---------- Más ---------- */
function planBCard() {
  return '<div class="card"><h2><span class="tt"><span class="ic">🛟</span>Plan B: si te quedas sin empleo</span><span class="pill ' + (STATE.modoB ? 'bad' : '') + '">' + (STATE.modoB ? 'ACTIVO' : 'apagado') + '</span></h2>' +
    '<p class="small">Si te despiden, actívalo con la fecha. La app te pone de inmediato las tareas del día 1, la semana 1 y el mes 1, baja el tope del día a día 30 % y te recuerda que no se firma el arriendo nuevo. Los escenarios calculados están en Metas → Plan B.</p>' +
    (STATE.modoB ? '<button class="btn small ghost" data-act="modoBOff">Desactivar (ya tengo empleo)</button>' : '<button class="btn small danger" data-act="modoB">Activar plan B</button>') + '</div>';
}
function alarmCard(perm) {
  return '<div class="card"><h2><span class="tt"><span class="ic">⏰</span>Alarmas diarias: qué hacer hoy</span><span class="pill ' + (perm === 'granted' ? 'ok' : 'warn') + '">avisos ' + (perm === 'granted' ? 'activos' : 'apagados') + '</span></h2>' +
    '<p class="small">Todos los días a las 7:00 a. m. tu calendario te dice exactamente qué hacer ese día, y los días con tareas te lo recuerda a las 3:00 p. m. Funciona aunque la app esté cerrada. La app también te avisa cuando la abres.</p>' +
    '<ol class="steps"><li><b>Toca “Descargar alarmas” en el computador</b><span class="small muted">Se descarga el archivo finanzas-alarmas-diarias.ics.</span></li>' +
    '<li><b>En calendar.google.com crea un calendario “Finanzas”</b><span class="small muted">⚙️ Configuración → Agregar calendario → Crear calendario nuevo.</span></li>' +
    '<li><b>Importa el archivo en ese calendario</b><span class="small muted">⚙️ Configuración → Importar y exportar → elige el archivo y el calendario “Finanzas” → Importar.</span></li>' +
    '<li><b>En el celular deja activas las notificaciones de Google Calendar</b><span class="small muted">iPhone: también sirve abrir el archivo en Safari y tocar “Agregar todo”.</span></li></ol>' +
    '<div class="chip-row"><button class="btn small" data-act="ics">Descargar alarmas</button><button class="btn small ghost" data-act="notif">Activar avisos de la app</button><button class="btn small ghost" data-act="testNotif">Probar aviso</button></div>' +
    '<p class="tiny muted">Si el plan cambia, la pestaña Hoy te muestra un aviso rojo con los 3 pasos para reemplazarlas (borrar el calendario “Finanzas”, crearlo de nuevo e importar el archivo nuevo). Cuando las importes toca “Ya las importé”.</p><button class="btn small ghost" data-act="icsOk">Ya las importé</button></div>';
}
function vMas() {
  var a = PLAN.analisis || {}, o = PLAN.optimo, perm = ('Notification' in window) ? Notification.permission : 'no';
  var html = alarmCard(perm);
  html += planBCard();
  html += '<div class="card"><h2><span class="tt"><span class="ic">📖</span>Palabras que vas a ver</span></h2><p class="small">Pago mínimo, pago total, abono a capital, reducción de plazo, tasa E.A., corte, 4x1000, CDT, AFC… explicadas en simple.</p><button class="ac-guia" data-guia="glosario">📖 Abrir el glosario</button></div>';
  if (o) html += '<section class="hero"><div class="stat">🧠 Análisis de escenarios</div><div class="big">' + esc(o.titulo) + '</div><div class="small" style="opacity:.92;margin-top:.3rem">' + esc(o.resumen) + '</div></section>' +
    tablaHTML({ titulo: 'Comparación con el mismo modelo', cols: o.tabla.cols, filas: o.tabla.filas }) +
    '<div class="card"><h2><span class="tt"><span class="ic">✅</span>Las razones</span></h2><ul class="list-plain">' + o.puntos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>';
  if (PLAN.riesgos && PLAN.riesgos.length) html += '<div class="card"><h2><span class="tt"><span class="ic">⚠️</span>Riesgos y decisiones discutibles</span></h2><p class="small muted">Mi opinión franca, con el costo de cada cosa.</p>' +
    PLAN.riesgos.map(function (x) { return '<details' + (x.nivel === 'bad' ? ' open' : '') + '><summary>' + (x.nivel === 'bad' ? '🔴' : '🟠') + ' ' + esc(x.titulo) + '</summary><p class="small">' + esc(x.detalle) + '</p><p class="small"><b>Qué hacer:</b> ' + esc(x.accion) + '</p></details>'; }).join('') + '</div>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">📲</span>Vincular celular</span></h2><p class="small">Muestra un QR para abrir la app en el celular. <b>No lo compartas</b>: es la llave de tus datos.</p><div class="chip-row"><button class="btn small" data-act="qr">Mostrar QR</button><button class="btn small ghost" data-act="install">Instalar en este equipo</button></div></div>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">🩺</span>Diagnóstico de tus finanzas</span></h2>' + (a.resumen ? '<p>' + esc(a.resumen) + '</p>' : '') +
    (a.hallazgos || []).map(function (x) { return '<details><summary>' + (x.nivel === 'bad' ? '🔴' : x.nivel === 'warn' ? '🟠' : '🟢') + ' ' + esc(x.titulo) + '</summary><p class="small">' + esc(x.detalle) + '</p>' + (x.accion ? '<p class="small"><b>Qué hacer:</b> ' + esc(x.accion) + '</p>' : '') + '</details>'; }).join('') + '</div>';
  if (a.tabla) { var items = a.tabla.filas.map(function (r, i) { return { k: r[0], v: r[1], c: COLORS[i % COLORS.length] }; });
    html += '<div class="card"><h2><span class="tt"><span class="ic">🍩</span>' + esc(a.tabla.titulo) + '</span></h2><div class="donut-wrap"><div class="donut-c">' + donutSVG(items) + '<div class="ctr"><div><b>' + moneyK(items.reduce(function (s, x) { return s + x.v; }, 0)) + '</b><span>al mes</span></div></div></div><ul class="dl">' + items.map(function (it) { return '<li><i style="background:' + it.c + '"></i><span>' + esc(it.k) + '</span><b>' + moneyK(it.v) + '</b></li>'; }).join('') + '</ul></div>' + (a.tabla.nota ? '<p class="tiny muted">' + esc(a.tabla.nota) + '</p>' : '') + '</div>'; }
  html += '<div class="card"><h2><span class="tt"><span class="ic">📜</span>Reglas de oro</span></h2><ol class="list-plain">' + (PLAN.reglas || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol></div>';
  html += '<div class="card"><details><summary>📚 Supuestos y fuentes</summary><div class="scroll"><table><tr><th>Dato</th><th>Valor</th></tr>' + (PLAN.supuestos || []).map(function (s) { return '<tr><td>' + esc(s.dato) + (s.fuente ? '<div class="tiny muted">' + esc(s.fuente) + '</div>' : '') + '</td><td>' + esc(s.valor) + '</td></tr>'; }).join('') + '</table></div></details></div>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">🧮</span>Saldos reales</span></h2><p class="small muted">Anótalos cada cierre de mes: así comparo el plan con la realidad.</p><button class="btn small" data-act="cierre" data-m="' + curMonth() + '">Anotar saldos de hoy</button></div>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">💾</span>Respaldo y actualización</span></h2><p class="small">Tu progreso vive en este dispositivo. Exporta un respaldo y guárdalo en la carpeta <i>progreso</i> de tu Drive para que yo lo lea cuando actualice el plan.</p>' +
    '<div class="chip-row"><button class="btn small" data-act="export">Exportar progreso</button><label class="btn small ghost">Importar<input type="file" accept="application/json" id="imp" hidden></label><button class="btn small ghost" data-act="reload">Buscar actualización</button></div></div>';
  html += '<div class="card"><h2><span class="tt"><span class="ic">🛡️</span>Seguridad</span></h2><p class="small">Tus datos están cifrados con AES-256: en internet solo hay texto ilegible. La clave vive en tus dispositivos y en el Administrador de credenciales de tu PC. Si pierdes el celular, pídeme cambiar la clave.</p><button class="btn small danger" data-act="forget">Olvidar la clave en este dispositivo</button></div>';
  html += '<p class="tiny muted center">Plan ' + esc(PLAN.version) + ' · app ' + APP_VERSION + '</p>';
  return html;
}

/* ---------- Acciones ---------- */
var ACT = {
  addGasto: function () {
    var monto = Number(String($('#gm').value).replace(/[^\d]/g, ''));
    if (!monto) return toast('Escribe el monto');
    STATE.gastos.push({ id: Date.now().toString(36), fecha: $('#gf').value || todayStr(), cat: GASTO_CAT, monto: monto, nota: $('#gn').value.trim() });
    saveState(); toast('Gasto en efectivo guardado ✔'); render();
  },
  addRetiro: function () {
    var monto = Number(String($('#gm').value).replace(/[^\d]/g, ''));
    if (!monto) return toast('Escribe cuánto sacaste');
    STATE.retiros = STATE.retiros || []; STATE.retiros.push({ id: 'r' + Date.now().toString(36), fecha: $('#gf').value || todayStr(), monto: monto, nota: $('#gn').value });
    saveState(); toast('Retiro guardado ✔'); render();
  },
  delRetiro: function (b) { STATE.retiros = (STATE.retiros || []).filter(function (g) { return g.id !== b.dataset.id; }); saveState(); render(); },
  delGasto: function (b) { STATE.gastos = STATE.gastos.filter(function (g) { return g.id !== b.dataset.id; }); saveState(); render(); },
  cierre: function (b) {
    var mes = b.dataset.m, campos = (PLAN.deudas || []).map(function (d) { return [d.id, d.nombre]; }).concat(Object.keys(PLAN.bolsillos || {}).map(function (k) { return [k, PLAN.bolsillos[k]]; })), prev = STATE.saldos[mes] || {};
    openModal('<h2>🧮 Cierre de ' + monthName(mes) + '</h2><ol class="list-plain small"><li>Descarga los extractos de tus cuentas, tarjetas y créditos.</li><li>Súbelos a su carpeta en Drive.</li><li>Escribe aquí los saldos reales de hoy.</li><li>Exporta el progreso y pídeme “actualiza la app”.</li></ol>' +
      campos.map(function (c) { return '<label class="f" for="s_' + c[0] + '">' + esc(c[1]) + '</label><input class="i" id="s_' + c[0] + '" inputmode="numeric" value="' + (prev[c[0]] != null ? prev[c[0]] : '') + '">'; }).join('') +
      '<label style="display:flex;gap:.5rem;align-items:center;margin-top:.8rem"><input type="checkbox" id="extr"' + (STATE.cierres[mes] ? ' checked' : '') + '> Ya subí los extractos del mes</label>' +
      '<div class="chip-row" style="margin-top:.8rem"><button class="btn" id="gs">Guardar</button><button class="btn ghost" id="mclose">Cancelar</button></div>');
    $('#gs').onclick = function () {
      var s = { fecha: todayStr() }; campos.forEach(function (c) { var v = $('#s_' + c[0]).value.replace(/[^\d]/g, ''); if (v !== '') s[c[0]] = Number(v); });
      STATE.saldos[mes] = s; if ($('#extr').checked) STATE.cierres[mes] = new Date().toISOString(); else delete STATE.cierres[mes];
      saveState(); closeModal(); toast('Cierre guardado ✔'); render();
    };
  },
  notif: function () {
    if (!('Notification' in window)) return toast('Este navegador no tiene notificaciones. Instala la app primero.');
    Notification.requestPermission().then(function (p) { STATE.notif.on = p === 'granted'; saveState(); render(); if (p === 'granted') { registerPeriodicSync(); maybeNotify(true); } });
  },
  testNotif: function () { showNotif('Prueba de Plan Finanzas', 'Así te voy a regañar cuando no cumplas 😉'); },
  ics: function () { downloadICS(); },
  modoB: function () {
    openModal('<h2>🛟 Activar plan B</h2><p class="small">¿Desde qué día te quedaste sin empleo? Las tareas se programan desde esa fecha.</p><label class="f" for="fb">Fecha</label><input id="fb" class="i" type="date" value="' + todayStr() + '">' +
      '<div class="chip-row" style="margin-top:.9rem"><button class="btn danger" id="okb">Activar</button><button class="btn ghost" id="mclose">Cancelar</button></div>');
    $('#okb').onclick = function () { var f = $('#fb').value || todayStr(); STATE.modoB = { fecha: f, desde: new Date().toISOString() }; saveState(); closeModal(); toast('Plan B activo. Revisa la pestaña Hoy.'); go('hoy'); };
  },
  modoBOff: function () { if (confirm('¿Desactivar el plan B? Vuelves al plan normal.')) { delete STATE.modoB; saveState(); toast('Plan B desactivado'); render(); } },
  icsOk: function () { STATE.icsHash = horario(); saveState(); toast('Listo: alarmas al día ✔'); render(); },
  install: function () { if (DEFERRED_INSTALL) { DEFERRED_INSTALL.prompt(); } else showInstallHelp(); },
  qr: function () {
    if (!window.QR) return toast('No se pudo generar el QR');
    var url = location.origin + location.pathname + '#k=' + KEY;
    openModal('<div class="center" style="padding:.2rem 0"><h2>📲 Escanéalo con tu celular</h2><p class="small muted">Abre la cámara del celular, apunta aquí y toca el enlace que aparece.</p></div>' +
      '<div class="qr">' + QR.toSVG(url, { ecl: 'M' }) + '</div>' +
      '<ol class="steps"><li><b>Cámara → apunta al QR</b><span class="small muted">En iPhone y Android funciona con la cámara normal.</span></li><li><b>Toca el enlace</b><span class="small muted">Se abre tu plan, ya desbloqueado.</span></li><li><b>Agrégalo a la pantalla de inicio</b><span class="small muted">Te mostraré cómo.</span></li></ol>' +
      '<p class="tiny muted center">🔒 No compartas este QR: es la llave de tus datos.</p><div class="chip-row" style="justify-content:center"><button class="btn ghost small" id="copyl">Copiar enlace secreto</button><button class="btn small" id="mclose">Listo</button></div>');
    $('#copyl').onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Copiado. Envíatelo solo a ti.'); }); };
  },
  export: function () {
    var blob = new Blob([JSON.stringify({ app: APP_VERSION, plan: PLAN.version, exportado: new Date().toISOString(), state: STATE }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'progreso-finanzas-' + todayStr() + '.json'; a.click();
  },
  reload: function () { location.reload(); },
  forget: function () { if (confirm('¿Olvidar la clave en este dispositivo? Tendrás que escanear el QR otra vez.')) { try { localStorage.removeItem(KEY_LS); } catch (e) { } location.reload(); } }
};
document.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-cat]') : null; if (b) { GASTO_CAT = b.dataset.cat; Array.prototype.forEach.call(document.querySelectorAll('[data-cat]'), function (x) { x.classList.toggle('on', x === b); }); } });

/* ---------- Notificaciones ---------- */
function showNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return toast(body);
  navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification(title, { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'plan-finanzas', renotify: true }); })
    .catch(function () { try { new Notification(title, { body: body }); } catch (e) { } });
}
function maybeNotify(force) {
  if (!PLAN || !('Notification' in window) || Notification.permission !== 'granted') return;
  var last = STATE.notif.last ? Date.parse(STATE.notif.last) : 0;
  if (!force && Date.now() - last < 3 * 3600e3) return;
  var h = todayStr(), od = overdue(), hoy = dueRange(h, h), cp = cierrePendiente(), title, body;
  if (!od.length && !hoy.length && !(cp && cp.dias > 3)) return;
  if (od.length) { var w = od.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })[0], d = daysBetween(w.fecha, h); title = d >= 7 ? '🚨 ALARMA financiera' : d >= 3 ? '😠 Regaño del plan' : '⏰ Tienes pendientes'; body = nagText(w, d) + (od.length > 1 ? ' (+' + (od.length - 1) + ' más)' : ''); }
  else if (hoy.length) { title = '📌 Hoy toca'; body = hoy.map(function (t) { return t.titulo + (t.monto ? ' ' + money(t.monto) : ''); }).join(' · '); }
  else { title = 'Cierre de mes pendiente'; body = 'Sube los extractos de ' + monthName(cp.mes) + ' y anota tus saldos.'; }
  STATE.notif.last = new Date().toISOString(); lsSet(STATE_LS, JSON.stringify(STATE)); showNotif(title, body);
}
function syncPendientes() {
  if (!PLAN || !('caches' in window)) return;
  var h = todayStr(), list = allTasks().filter(function (t) { return !isDone(t.id) && t.fecha <= addDays(h, 3); }).map(function (t) { return { id: t.id, f: t.fecha, t: t.titulo }; });
  caches.open('fin-meta').then(function (c) { return c.put('./__pendientes.json', new Response(JSON.stringify({ n: PLAN.persona.nombre, list: list }), { headers: { 'content-type': 'application/json' } })); }).catch(function () { });
}
function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(function (reg) { if ('periodicSync' in reg) return reg.periodicSync.register('regano', { minInterval: 6 * 3600e3 }); }).catch(function () { });
}

/* ---------- Alarmas diarias (.ics para Google Calendar o Calendario del iPhone) ---------- */
function downloadICS() {
  var h = todayStr(), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlanFinanzas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Finanzas · qué hacer hoy', 'X-WR-TIMEZONE:America/Bogota'];
  var stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  function escI(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function fold(l) { var cp = Array.from(l), out = []; while (cp.length > 60) { out.push(cp.slice(0, 60).join('')); cp = [' '].concat(cp.slice(60)); } out.push(cp.join('')); return out; }
  function ev(uid, date, hh, mm, dur, title, desc, alarms) {
    var d = date.replace(/-/g, ''), st = d + 'T' + pad(hh) + pad(mm) + '00', e = hh * 60 + mm + dur, et = d + 'T' + pad(Math.floor(e / 60)) + pad(e % 60) + '00';
    var L = ['BEGIN:VEVENT', 'UID:' + uid + '@plan-finanzas', 'DTSTAMP:' + stamp, 'DTSTART;TZID=America/Bogota:' + st, 'DTEND;TZID=America/Bogota:' + et, 'SUMMARY:' + escI(title), 'DESCRIPTION:' + escI(desc), 'TRANSP:TRANSPARENT'];
    alarms.forEach(function (a) { L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escI(title), 'TRIGGER:' + a, 'END:VALARM'); });
    L.push('END:VEVENT'); L.forEach(function (l) { fold(l).forEach(function (x) { lines.push(x); }); });
  }
  var byDate = {}; allTasks().forEach(function (t) { if (t.fecha >= h) (byDate[t.fecha] = byDate[t.fecha] || []).push(t); });
  var inc = {}; (PLAN.ingresos || []).forEach(function (i) { if (i.fecha >= h) (inc[i.fecha] = inc[i.fecha] || []).push(i); });
  var ultimo = PLAN.meses[PLAN.meses.length - 1].id + '-28', n = 0;
  for (var f = h; f <= ultimo; f = addDays(f, 1)) {
    var ts = (byDate[f] || []).sort(byFecha), ins = inc[f] || [];
    var entra = ins.map(function (i) { return '💰 Hoy te entra: ' + i.concepto + ' ' + money(i.monto); }).join('\n');
    if (ts.length) {
      var desc = (entra ? entra + '\n\n' : '') + ts.map(function (t, i) { return (i + 1) + '. ' + t.titulo + (t.monto ? ' — ' + money(t.monto) : '') + (t.desde || t.hacia ? '\n   ' + (t.desde ? 'Desde ' + t.desde : '') + (t.hacia ? ' → a ' + t.hacia : '') : ''); }).join('\n') +
        '\n\nCuando lo hagas, márcalo en la app (pestaña Hoy).';
      var t0 = ts[0], tit = '📌 Hoy: ' + t0.titulo + (t0.monto ? ' ' + moneyK(t0.monto) : '') + (ts.length > 1 ? ' (+' + (ts.length - 1) + ' más)' : '');
      ev('dia-' + f, f, 7, 0, 15, tit, desc, ['-PT0M']);
      ev('tarde-' + f, f, 15, 0, 10, '⏰ Tarde: ¿ya hiciste lo de hoy? ' + t0.titulo + (ts.length > 1 ? ' (+' + (ts.length - 1) + ')' : ''), desc, ['-PT0M']);
    } else {
      ev('dia-' + f, f, 7, 0, 10, entra ? '💰 Hoy te entra plata: no pagas nada hoy' : '🙂 Hoy no pagas nada: anota el efectivo que gastes', (entra ? entra + '\n\n' : '') + 'No tienes pagos ni trámites hoy. Si gastas en efectivo, anótalo en la app (pestaña Efectivo).', ['-PT0M']);
    }
    n++;
  }
  lines.push('END:VCALENDAR');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' })); a.download = 'finanzas-alarmas-diarias.ics'; a.click();
  toast('Descargado: ' + n + ' días de alarmas');
}

try { boot(); } catch (e) { renderLock('Error al iniciar: ' + e.message); }
