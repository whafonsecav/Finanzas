/* Plan Finanzas — PWA sin servidor. Los datos del plan llegan cifrados (AES-256-GCM) y se descifran solo en tu dispositivo.
   El progreso (checks, gastos, saldos reales) se guarda en este dispositivo (localStorage) y se puede exportar. */
'use strict';
const APP_VERSION = '1.0.0';
const KEY_LS = 'fin_key', STATE_LS = 'fin_state', PLAN_CACHE_LS = 'fin_plan_meta';
const $ = s => document.querySelector(s);
const view = $('#view');
const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const money = n => (n == null || isNaN(n)) ? '—' : fmt.format(Math.round(n)).replace(/\s/g, ' ');
const moneyK = n => (n == null || isNaN(n)) ? '—' : (Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M' : Math.round(n / 1000).toLocaleString('es-CO') + ' mil');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const fDate = s => { if (!s) return ''; const d = parseD(s); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const fDateLong = s => { const d = parseD(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const monthName = id => { const [y, m] = id.split('-').map(Number); return `${MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1)} ${y}`; };
const curMonth = () => todayStr().slice(0, 7);

let PLAN = null, KEY = null;
let STATE = loadState();
let TAB = 'hoy', MES_SEL = null, META_SEL = 'viaje';

function loadState() {
  try { return Object.assign({ checks: {}, gastos: [], saldos: {}, cierres: {}, notif: {}, nags: {} }, JSON.parse(localStorage.getItem(STATE_LS) || '{}')); }
  catch { return { checks: {}, gastos: [], saldos: {}, cierres: {}, notif: {}, nags: {} }; }
}
function saveState() { try { localStorage.setItem(STATE_LS, JSON.stringify(STATE)); } catch (e) { toast('No se pudo guardar en este dispositivo'); } syncPendientes(); updateBell(); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------- Cifrado ---------- */
const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const b64urlToBytes = s => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
async function decryptPlan(enc, keyStr) {
  const key = await crypto.subtle.importKey('raw', b64urlToBytes(keyStr), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

async function boot() {
  // 1) ¿Llegó la clave por el enlace del QR?
  const m = location.hash.match(/k=([A-Za-z0-9_-]{40,})/);
  if (m) { localStorage.setItem(KEY_LS, m[1]); history.replaceState(null, '', location.pathname + location.search); }
  KEY = localStorage.getItem(KEY_LS);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!KEY) return renderLock();
  try {
    const res = await fetch('data/plan.enc.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const enc = await res.json();
    PLAN = await decryptPlan(enc, KEY);
  } catch (e) {
    console.warn(e);
    return renderLock('No pude abrir los datos con la clave guardada en este dispositivo (o no hay conexión). Vuelve a escanear el QR.');
  }
  $('#tabs').hidden = false;
  $('#sub').textContent = `Versión del plan ${PLAN.version}`;
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#bell').onclick = () => go('hoy');
  MES_SEL = PLAN.meses.find(x => x.id === curMonth()) ? curMonth() : PLAN.meses[0].id;
  render();
  syncPendientes(); updateBell(); maybeNotify();
  setInterval(() => { maybeNotify(); updateBell(); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { maybeNotify(); updateBell(); if (TAB === 'hoy') render(); } });
  registerPeriodicSync();
}

function renderLock(msg) {
  $('#tabs').hidden = true;
  view.innerHTML = `<div class="lock card">
    <h2>🔒 App cifrada</h2>
    ${msg ? `<div class="alert warn">${esc(msg)}</div>` : ''}
    <p>Tus datos financieros están cifrados. Para abrir la app en este celular:</p>
    <ol class="list-plain">
      <li>En tu PC ejecuta <b>Abrir app (vincular celular)</b> (doble clic en <i>abrir-app.cmd</i> en la carpeta <i>app-privado</i>).</li>
      <li>En el PC toca <b>Más → Vincular celular</b>.</li>
      <li>Escanea el QR con la cámara de este celular.</li>
    </ol>
    <details><summary>Pegar la clave manualmente</summary>
      <label class="f" for="k">Clave</label><input id="k" class="i" autocomplete="off" spellcheck="false">
      <button class="btn block" style="margin-top:.5rem" id="kb">Abrir</button></details>
  </div>`;
  const kb = $('#kb'); if (kb) kb.onclick = () => { const v = $('#k').value.trim(); if (v) { localStorage.setItem(KEY_LS, v); location.reload(); } };
}

/* ---------- Utilidades del plan ---------- */
const allTasks = () => PLAN.meses.flatMap(m => m.tareas.map(t => Object.assign({ mes: m.id }, t)));
const isDone = id => !!STATE.checks[id];
function overdue() { const h = todayStr(); return allTasks().filter(t => t.fecha < h && !isDone(t.id)); }
function dueRange(from, to) { return allTasks().filter(t => t.fecha >= from && t.fecha <= to && !isDone(t.id)); }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nagLevel(days) { return days >= 7 ? 'alarma' : days >= 3 ? 'regano' : 'recordatorio'; }
function nagText(t, days) {
  const n = PLAN.persona.nombre;
  if (days >= 7) return `🚨 ALARMA, ${n}: llevas ${days} días sin "${t.titulo}". Esto rompe el plan y retrasa tu salida de deudas y la boda. Hazlo HOY y márcalo.`;
  if (days >= 3) return `😠 Regaño: ${days} días de retraso en "${t.titulo}". ${t.tipo === 'pago' ? 'Cada día de mora suma intereses y puede reportarte en centrales de riesgo.' : 'Si no lo haces, el dinero se va en otra cosa.'}`;
  return `⏰ ${days === 1 ? 'Ayer' : 'Hace ' + days + ' días'} tocaba: "${t.titulo}". ¿Ya lo hiciste? Márcalo.`;
}
function cierrePendiente() {
  const h = todayStr(), cm = h.slice(0, 7);
  const prev = PLAN.meses.filter(m => m.id < cm).map(m => m.id);
  const ultimo = prev[prev.length - 1];
  if (!ultimo || STATE.cierres[ultimo]) return null;
  const dia = Number(h.slice(8));
  return { mes: ultimo, dias: dia, nivel: dia > 5 ? 'bad' : 'warn' };
}
function gastosMes(mes) { return STATE.gastos.filter(g => g.fecha.slice(0, 7) === mes); }
function gastoPorSobre(mes) { const r = {}; gastosMes(mes).forEach(g => { r[g.cat] = (r[g.cat] || 0) + g.monto; }); return r; }
function deudaPlanEnMes(mesId) { const m = PLAN.meses.find(x => x.id === mesId); return m ? m.saldosFin : null; }
function sum(o) { return Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0); }
function pendingCount() { const c = cierrePendiente(); return overdue().length + dueRange(todayStr(), todayStr()).length + (c && c.dias > 5 ? 1 : 0); }
function updateBell() { if (!PLAN) return; const n = pendingCount(); const el = $('#bellCount'); el.hidden = !n; el.textContent = n;
  if ('setAppBadge' in navigator) { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } }

/* ---------- Navegación ---------- */
function go(tab) { TAB = tab; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); render(); window.scrollTo(0, 0); }
function render() {
  const f = { hoy: vHoy, mes: vMes, deudas: vDeudas, metas: vMetas, gastos: vGastos, mas: vMas }[TAB];
  view.innerHTML = f(); bindCommon();
}
function bindCommon() {
  view.querySelectorAll('input[data-task]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.task;
    if (cb.checked) { STATE.checks[id] = { t: new Date().toISOString() }; toast('✔ Bien hecho. Marcado.'); }
    else { delete STATE.checks[id]; }
    saveState(); render();
  });
  view.querySelectorAll('[data-mes]').forEach(b => b.onclick = () => { MES_SEL = b.dataset.mes; if (TAB !== 'mes') TAB = 'mes'; go('mes'); });
  view.querySelectorAll('[data-meta]').forEach(b => b.onclick = () => { META_SEL = b.dataset.meta; render(); });
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ACT[b.dataset.act](b));
}

function taskHTML(t, opts = {}) {
  const h = todayStr(), done = isDone(t.id), late = !done && t.fecha < h;
  const days = late ? daysBetween(t.fecha, h) : 0;
  return `<div class="task ${done ? 'done' : ''} ${late ? 'late' : ''}">
    <input type="checkbox" data-task="${esc(t.id)}" ${done ? 'checked' : ''} aria-label="Marcar ${esc(t.titulo)}">
    <div><div class="t">${t.critica ? '❗ ' : ''}${esc(t.titulo)}</div>
      ${t.detalle ? `<div class="d">${esc(t.detalle)}</div>` : ''}
      ${(t.desde || t.hacia) ? `<div class="d">${t.desde ? 'Desde: ' + esc(t.desde) : ''}${t.desde && t.hacia ? ' → ' : ''}${t.hacia ? 'A: ' + esc(t.hacia) : ''}</div>` : ''}
      ${late ? `<div class="d bad-t">${days} día${days > 1 ? 's' : ''} de retraso</div>` : ''}</div>
    <div>${t.monto ? `<div class="amt num">${money(t.monto)}</div>` : ''}<div class="when">${opts.noDate ? '' : fDate(t.fecha)}</div></div>
  </div>`;
}

/* ---------- Vista: Hoy ---------- */
function vHoy() {
  const h = todayStr(), od = overdue(), cp = cierrePendiente();
  const semana = dueRange(h, addDays(h, 7));
  const prox = (PLAN.ingresos || []).filter(i => i.fecha >= h).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  let html = '';
  // Regaños
  od.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 6).forEach(t => {
    const d = daysBetween(t.fecha, h), lvl = nagLevel(d);
    html += `<div class="alert ${lvl === 'recordatorio' ? 'warn' : 'bad'}"><b>${lvl === 'alarma' ? 'ALARMA' : lvl === 'regano' ? 'REGAÑO' : 'Recordatorio'}</b>${esc(nagText(t, d))}
      <div style="margin-top:.4rem"><label><input type="checkbox" data-task="${esc(t.id)}"> Ya lo hice</label></div></div>`;
  });
  if (od.length > 6) html += `<div class="alert bad"><b>Y ${od.length - 6} tareas atrasadas más.</b> Revisa la pestaña Mes.</div>`;
  if (cp) html += `<div class="alert ${cp.nivel}"><b>${cp.nivel === 'bad' ? 'REGAÑO: no has cerrado ' : 'Cierre pendiente: '}${monthName(cp.mes)}</b>
    Descarga los extractos de tus cuentas, tarjetas y créditos, súbelos a la carpeta de Drive y anota tus saldos reales. Luego pídeme “actualiza la app”.
    <div style="margin-top:.4rem"><button class="btn small" data-act="cierre" data-m="${cp.mes}">Hacer cierre de ${monthName(cp.mes)}</button></div></div>`;
  // Sobres excedidos
  const mm = PLAN.meses.find(x => x.id === h.slice(0, 7));
  if (mm) { const g = gastoPorSobre(mm.id); (mm.sobres || []).forEach(s => { const u = g[s.id] || 0; if (u > s.monto) html += `<div class="alert bad"><b>Te pasaste en ${esc(s.nombre)}</b>Llevas ${money(u)} de ${money(s.monto)} este mes. Para lo que queda del mes: cero en esta categoría.</div>`;
    else if (s.monto && u > s.monto * 0.8) html += `<div class="alert warn"><b>Cuidado con ${esc(s.nombre)}</b>Ya usaste ${Math.round(u / s.monto * 100)} % (${money(u)} de ${money(s.monto)}).</div>`; }); }
  if (!od.length && !cp) html += `<div class="alert ok"><b>Vas al día 💪</b>No tienes tareas atrasadas. Así se sale de deudas: sigue igual.</div>`;
  if (mm) { const hasta = mm.tareas.filter(t => t.fecha <= h), hechas = hasta.filter(t => isDone(t.id)).length, todas = mm.tareas.filter(t => isDone(t.id)).length;
    const pct = hasta.length ? Math.round(hechas / hasta.length * 100) : 100;
    html += `<div class="card tight"><div class="row"><b>Cumplimiento de ${monthName(mm.id)}</b><span class="pill ${pct === 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad'}">${pct} %</span></div>
      <div class="bar ${pct === 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad'}"><i style="width:${pct}%"></i></div>
      <div class="tiny muted">${hasta.length ? `${hechas} de ${hasta.length} tareas que ya tocaban · ` : 'Aún no se vence ninguna tarea este mes · '}${todas} de ${mm.tareas.length} en todo el mes. ${!hasta.length ? '' : pct === 100 ? '¡Excelente! 🎉' : pct >= 70 ? 'Vas bien, termina lo que falta.' : 'Te estás quedando: ponte al día hoy.'}</div></div>`; }

  // KPIs
  const deudaPlan = mm ? sum(mm.saldosIni || {}) : null;
  const real = latestRealDebt();
  const fechas = PLAN.fechas || {};
  html += `<div class="grid2 wide" style="margin-bottom:.8rem">
    <div class="kpi"><div class="lbl">Deuda total ${real ? '(real reportada)' : '(según plan)'}</div><div class="val num">${moneyK(real ? real.total : deudaPlan)}</div><div class="sub">${real ? 'al ' + fDate(real.fecha) : 'inicio de ' + (mm ? monthName(mm.id) : '')}</div></div>
    <div class="kpi"><div class="lbl">Libre de deudas</div><div class="val">${fechas.libreDeudas ? monthName(fechas.libreDeudas) : '—'}</div><div class="sub">si cumples el plan</div></div>
    ${fechas.viaje && fechas.viaje >= h ? `<div class="kpi"><div class="lbl">San Francisco 🌉</div><div class="val">${daysBetween(h, fechas.viaje)} días</div><div class="sub">${fDate(fechas.viaje)}</div></div>` : ''}
    ${fechas.boda ? `<div class="kpi"><div class="lbl">Boda 💍</div><div class="val">${fechas.boda >= h ? daysBetween(h, fechas.boda) + ' días' : '¡Casados!'}</div><div class="sub">${fDate(fechas.boda)}</div></div>` : ''}
  </div>`;
  if (prox) html += `<div class="card"><h2>Próximo ingreso <span class="pill">${fDate(prox.fecha)}</span></h2>
    <div class="row"><span>${esc(prox.concepto)}</span><b class="num">${money(prox.monto)}</b></div>
    <p class="small muted">${esc(prox.nota || 'La fecha exacta puede moverse 1–3 días. Ejecuta las tareas el mismo día que llegue el dinero.')}</p></div>`;
  html += `<div class="card"><h2>Próximos 7 días <span class="pill ${semana.length ? 'warn' : 'ok'}">${semana.length} pendientes</span></h2>
    ${semana.length ? semana.sort((a, b) => a.fecha.localeCompare(b.fecha)).map(t => taskHTML(t)).join('') : '<p class="muted">Nada pendiente esta semana.</p>'}</div>`;
  if (mm) html += `<div class="card"><h2>Foco de ${monthName(mm.id)}</h2><p>${esc(mm.foco)}</p><button class="btn ghost small" data-mes="${mm.id}">Ver el mes completo</button></div>`;
  html += `<p class="tiny muted center" style="padding:.5rem">Plan ${esc(PLAN.version)} · app ${APP_VERSION}</p>`;
  return html;
}
function latestRealDebt() {
  const ks = Object.keys(STATE.saldos).sort(); if (!ks.length) return null;
  const k = ks[ks.length - 1], s = STATE.saldos[k];
  const total = (PLAN.deudas || []).reduce((a, d) => a + (+s[d.id] || 0), 0);
  return { fecha: s.fecha || (k + '-28'), total };
}

/* ---------- Vista: Mes ---------- */
function vMes() {
  const m = PLAN.meses.find(x => x.id === MES_SEL) || PLAN.meses[0];
  const chips = PLAN.meses.map(x => `<button data-mes="${x.id}" class="${x.id === m.id ? 'on' : ''}">${monthName(x.id).replace(' 20', " '")}</button>`).join('');
  const grupos = [['q1', 'Quincena 1 (≈ día 11–14)'], ['q2', 'Quincena 2 (≈ día 25–29)'], ['otros', 'Trámites y compras'], ['cierre', 'Cierre de mes']];
  const g = gastoPorSobre(m.id);
  let html = `<div class="seg" id="seg">${chips}</div>
  <div class="card"><h2>${monthName(m.id)} ${m.etiqueta ? `<span class="pill info">${esc(m.etiqueta)}</span>` : ''}</h2><p>${esc(m.foco)}</p>${m.nota ? `<p class="small muted">${esc(m.nota)}</p>` : ''}</div>`;
  html += `<div class="card"><h2>Ingresos del mes</h2>${m.ingresos.map(i => `<div class="row"><span>${esc(i.concepto)} <span class="tiny muted">${fDate(i.fecha)}</span></span><b class="num">${money(i.monto)}</b></div>`).join('')}
    <div class="row" style="border-top:1px solid var(--line);padding-top:.35rem;margin-top:.35rem"><b>Total</b><b class="num">${money(m.ingresos.reduce((a, b) => a + b.monto, 0))}</b></div></div>`;
  grupos.forEach(([k, nombre]) => { const ts = m.tareas.filter(t => (t.grupo || 'otros') === k); if (!ts.length) return;
    const hechos = ts.filter(t => isDone(t.id)).length;
    html += `<div class="card"><h2>${nombre} <span class="pill ${hechos === ts.length ? 'ok' : ''}">${hechos}/${ts.length}</span></h2>${ts.map(t => taskHTML(t)).join('')}</div>`; });
  if (m.sobres && m.sobres.length) {
    html += `<div class="card"><h2>Sobres de gasto variable <button class="btn small ghost" data-go="gastos">+ Anotar gasto</button></h2>
      <p class="small muted">Es el máximo que puedes gastar en el mes. Anota cada gasto en la pestaña Gastos.</p>
      ${m.sobres.map(s => { const u = g[s.id] || 0, p = s.monto ? Math.min(100, u / s.monto * 100) : 0;
        return `<div style="margin:.5rem 0"><div class="row"><span>${esc(s.nombre)}</span><span class="num small">${money(u)} / ${money(s.monto)}</span></div>
        <div class="bar ${u > s.monto ? 'bad' : p > 80 ? 'warn' : 'ok'}"><i style="width:${p}%"></i></div>${s.nota ? `<div class="tiny muted">${esc(s.nota)}</div>` : ''}</div>`; }).join('')}</div>`;
  }
  if (m.resumen) { const r = m.resumen;
    html += `<div class="card"><h2>Resumen del mes</h2><table>
      ${(r.lineas || []).map(l => `<tr><td>${esc(l[0])}</td><td class="n">${money(l[1])}</td></tr>`).join('')}
      </table></div>`; }
  if (m.saldosFin) html += `<div class="card"><h2>Así deberías terminar el mes</h2><table>
    ${(PLAN.deudas || []).map(d => `<tr><td>${esc(d.nombre)}</td><td class="n">${money(m.saldosFin[d.id] || 0)}</td></tr>`).join('')}
    <tr class="tot"><td>Deuda total</td><td class="n">${money(sum(m.saldosFin))}</td></tr>
    ${Object.entries(m.ahorrosFin || {}).map(([k, v]) => `<tr><td>${esc((PLAN.bolsillos || {})[k] || k)}</td><td class="n">${money(v)}</td></tr>`).join('')}
  </table></div>`;
  setTimeout(() => { const on = document.querySelector('#seg .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0);
  return html;
}

/* ---------- Vista: Deudas ---------- */
function vDeudas() {
  const h = todayStr(), cm = curMonth();
  const serie = PLAN.meses.map(m => ({ id: m.id, v: sum(m.saldosFin) }));
  const max = Math.max(...serie.map(s => s.v), 1);
  let html = `<div class="card"><h2>Deuda total proyectada</h2>
    <div class="mini-chart">${serie.map(s => `<div class="${s.id < cm ? 'past' : s.id === cm ? 'now' : ''}" style="height:${Math.max(2, s.v / max * 100)}%" title="${monthName(s.id)}: ${money(s.v)}"></div>`).join('')}</div>
    <div class="axis"><span>${monthName(serie[0].id)}</span><span>${monthName(serie[serie.length - 1].id)}</span></div>
    <p class="small">Meta: <b>${PLAN.fechas.libreDeudas ? monthName(PLAN.fechas.libreDeudas) : '—'}</b> sin deudas. Orden de ataque: primero la deuda con la tasa más alta, después las demás.</p></div>`;
  (PLAN.deudas || []).forEach(d => {
    const real = Object.keys(STATE.saldos).sort().reverse().map(k => ({ k, v: STATE.saldos[k][d.id] })).find(x => x.v != null && x.v !== '');
    const planNow = (PLAN.meses.find(m => m.id === cm) || PLAN.meses[0]).saldosIni[d.id];
    const fin = PLAN.meses.find(m => (m.saldosFin[d.id] || 0) <= 0 && m.id >= PLAN.meses[0].id);
    html += `<div class="card"><h2>${esc(d.nombre)} <span class="pill ${d.tasaEA > 25 ? 'bad' : 'warn'}">${String(d.tasaEA).replace('.', ',')} % E.A.</span></h2>
      <div class="row"><span>Saldo inicial (${fDate(d.fechaSaldo)})</span><b class="num">${money(d.saldoInicial)}</b></div>
      <div class="row"><span>Según plan, este mes inicia en</span><b class="num">${money(planNow)}</b></div>
      ${real ? `<div class="row"><span>Último saldo real que anotaste (${monthName(real.k)})</span><b class="num">${money(+real.v)}</b></div>` : ''}
      <div class="row"><span>Pago mínimo / cuota</span><b class="num">${money(d.cuotaMin)}</b></div>
      <div class="row"><span>Fecha límite de pago</span><b>${esc(d.diaPagoTxt || ('día ' + d.diaPago))}</b></div>
      <div class="row"><span>Queda en cero</span><b>${fin ? monthName(fin.id) : '—'}</b></div>
      ${d.nota ? `<p class="small muted" style="margin-top:.5rem">${esc(d.nota)}</p>` : ''}</div>`;
  });
  html += `<div class="card"><h2>Calendario de saldos</h2><div class="scroll"><table><tr><th>Mes</th>${PLAN.deudas.map(d => `<th class="n">${esc(d.corto || d.id)}</th>`).join('')}<th class="n">Total</th></tr>
    ${PLAN.meses.map(m => `<tr ${m.id === cm ? 'style="background:var(--warn-soft)"' : ''}><td>${monthName(m.id).replace(' 20', " '")}</td>${PLAN.deudas.map(d => `<td class="n">${moneyK(m.saldosFin[d.id] || 0)}</td>`).join('')}<td class="n"><b>${moneyK(sum(m.saldosFin))}</b></td></tr>`).join('')}
  </table></div><p class="tiny muted">Saldos al final de cada mes si cumples el plan.</p></div>`;
  return html;
}

/* ---------- Vista: Metas ---------- */
function vMetas() {
  const metas = PLAN.metas || [];
  const chips = metas.map(x => `<button data-meta="${x.id}" class="${x.id === META_SEL ? 'on' : ''}">${x.icono || ''} ${esc(x.corto || x.nombre)}</button>`).join('');
  const m = metas.find(x => x.id === META_SEL) || metas[0];
  if (!m) return '<p>No hay metas.</p>';
  let html = `<div class="seg">${chips}</div><div class="card"><h2>${m.icono || ''} ${esc(m.nombre)}</h2>
    ${m.fecha ? `<div class="row"><span>Fecha</span><b>${fDateLong(m.fecha)}</b></div>` : ''}
    ${m.objetivo ? `<div class="row"><span>Meta de dinero</span><b class="num">${money(m.objetivo)}</b></div>` : ''}
    ${m.resumen ? `<p style="margin-top:.5rem">${esc(m.resumen)}</p>` : ''}</div>`;
  if (m.proyeccion && m.proyeccion.length) {
    const max = Math.max(...m.proyeccion.map(p => p.saldo), m.objetivo || 1);
    html += `<div class="card"><h2>Cómo crece el ahorro</h2><div class="mini-chart">${m.proyeccion.map(p => `<div class="${p.mes < curMonth() ? 'past' : ''}" style="height:${Math.max(2, p.saldo / max * 100)}%" title="${monthName(p.mes)}: ${money(p.saldo)}"></div>`).join('')}</div>
      <div class="axis"><span>${monthName(m.proyeccion[0].mes)}</span><span>${monthName(m.proyeccion[m.proyeccion.length - 1].mes)}</span></div></div>`;
  }
  (m.tablas || []).forEach(tb => {
    html += `<div class="card"><h2>${esc(tb.titulo)}</h2>${tb.nota ? `<p class="small muted">${esc(tb.nota)}</p>` : ''}<div class="scroll"><table>
      <tr>${tb.cols.map((c, i) => `<th class="${i && tb.num && tb.num.includes(i) ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr>
      ${tb.filas.map(r => `<tr class="${r._tot ? 'tot' : ''}">${(r.c || r).map((c, i) => `<td class="${tb.num && tb.num.includes(i) ? 'n' : ''}">${tb.num && tb.num.includes(i) && typeof c === 'number' ? money(c) : linkify(c)}</td>`).join('')}</tr>`).join('')}
    </table></div></div>`;
  });
  (m.listas || []).forEach(l => { html += `<div class="card"><h2>${esc(l.titulo)}</h2><ul class="list-plain">${l.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`; });
  const ts = allTasks().filter(t => (t.metas || []).includes(m.id));
  if (ts.length) html += `<div class="card"><h2>Tareas de esta meta <span class="pill">${ts.filter(t => isDone(t.id)).length}/${ts.length}</span></h2>${ts.map(t => taskHTML(t)).join('')}</div>`;
  return html;
}

function linkify(c) {
  const s = String(c == null ? '' : c);
  if (/^(https?:\/\/)?[a-z0-9.-]+\.(com|co|app|org|net)(\.[a-z]{2})?(\/\S*)?$/i.test(s)) {
    const url = /^https?:/.test(s) ? s : 'https://' + s;
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.replace(/^https?:\/\//, ''))}</a>`;
  }
  return esc(s);
}

/* ---------- Vista: Gastos ---------- */
function vGastos() {
  const cm = curMonth(), m = PLAN.meses.find(x => x.id === cm) || PLAN.meses[0];
  const sobres = m.sobres || [];
  const gs = gastosMes(m.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const g = gastoPorSobre(m.id);
  return `<div class="card"><h2>Anotar gasto</h2>
    <p class="small muted">Anota todo lo que no esté en las tareas del plan (domicilios, comida rápida, Uber, compras, antojos…). Cada peso cuenta.</p>
    <label class="f" for="gc">Categoría</label><select id="gc" class="i">${sobres.map(s => `<option value="${s.id}">${esc(s.nombre)} (te quedan ${money(Math.max(0, s.monto - (g[s.id] || 0)))})</option>`).join('')}</select>
    <div class="grid2"><div><label class="f" for="gm">Monto</label><input id="gm" class="i" inputmode="numeric" placeholder="25000"></div>
    <div><label class="f" for="gf">Fecha</label><input id="gf" class="i" type="date" value="${todayStr()}"></div></div>
    <label class="f" for="gn">Nota</label><input id="gn" class="i" placeholder="Ej. Rappi hamburguesa">
    <button class="btn block" style="margin-top:.6rem" data-act="addGasto">Guardar gasto</button></div>
    <div class="card"><h2>${monthName(m.id)}: llevas ${money(sum(g))}</h2>
    ${sobres.map(s => { const u = g[s.id] || 0, p = s.monto ? Math.min(100, u / s.monto * 100) : 0;
      return `<div style="margin:.4rem 0"><div class="row"><span>${esc(s.nombre)}</span><span class="num small">${money(u)} / ${money(s.monto)}</span></div><div class="bar ${u > s.monto ? 'bad' : p > 80 ? 'warn' : 'ok'}"><i style="width:${p}%"></i></div></div>`; }).join('')}</div>
    <div class="card"><h2>Movimientos anotados</h2>${gs.length ? `<table>${gs.map(x => `<tr><td>${fDate(x.fecha)}<div class="tiny muted">${esc((sobres.find(s => s.id === x.cat) || {}).nombre || x.cat)} · ${esc(x.nota || '')}</div></td><td class="n">${money(x.monto)}</td><td class="n"><button class="btn small ghost" data-act="delGasto" data-id="${x.id}" aria-label="Borrar">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">Aún no anotas gastos este mes.</p>'}</div>`;
}

/* ---------- Vista: Más ---------- */
function vMas() {
  const a = PLAN.analisis || {};
  const perm = ('Notification' in window) ? Notification.permission : 'no-soportado';
  return `
  <div class="card"><h2>Recordatorios y regaños</h2>
    <p class="small">La app te avisa cuando la abres y cada 30 minutos mientras esté abierta. Para que tu celular te avise <b>aunque no la abras</b>, agrega el calendario de recordatorios a Google Calendar (abajo).</p>
    <div class="row"><span>Notificaciones en este dispositivo</span><span class="pill ${perm === 'granted' ? 'ok' : 'warn'}">${perm === 'granted' ? 'activas' : perm === 'denied' ? 'bloqueadas' : perm === 'no-soportado' ? 'no soportadas' : 'sin activar'}</span></div>
    <div class="chip-row" style="margin-top:.6rem"><button class="btn small" data-act="notif">Activar notificaciones</button><button class="btn small ghost" data-act="testNotif">Probar</button></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:.8rem 0">
    <p class="small"><b>Calendario de recordatorios (.ics)</b>: crea alarmas para cada quincena, cada pago con fecha límite y cada cierre de mes, con avisos repetidos (mañana, noche y al día siguiente).</p>
    <button class="btn small" data-act="ics">Descargar calendario</button>
    <p class="tiny muted">Android: abre el archivo con Google Calendar, o en el PC entra a calendar.google.com → Configuración → Importar. iPhone: ábrelo y toca “Agregar todo”.</p></div>
  <div class="card"><h2>Diagnóstico de tus finanzas</h2>${a.resumen ? `<p>${esc(a.resumen)}</p>` : ''}
    ${(a.hallazgos || []).map(x => `<details><summary>${x.nivel === 'bad' ? '🔴' : x.nivel === 'warn' ? '🟠' : '🟢'} ${esc(x.titulo)}</summary><p class="small">${esc(x.detalle)}</p>${x.accion ? `<p class="small"><b>Qué hacer:</b> ${esc(x.accion)}</p>` : ''}</details>`).join('')}</div>
  ${a.tabla ? `<div class="card"><h2>${esc(a.tabla.titulo)}</h2><div class="scroll"><table><tr>${a.tabla.cols.map((c, i) => `<th class="${i ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr>${a.tabla.filas.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${typeof c === 'number' ? money(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>${a.tabla.nota ? `<p class="tiny muted">${esc(a.tabla.nota)}</p>` : ''}</div>` : ''}
  <div class="card"><h2>Reglas de oro</h2><ol class="list-plain">${(PLAN.reglas || []).map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>
  <div class="card"><h2>Supuestos y fuentes</h2><div class="scroll"><table><tr><th>Dato</th><th>Valor usado</th></tr>${(PLAN.supuestos || []).map(s => `<tr><td>${esc(s.dato)}${s.fuente ? `<div class="tiny muted">${esc(s.fuente)}</div>` : ''}</td><td>${esc(s.valor)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h2>Saldos reales (cierre de mes)</h2><p class="small muted">Anota tus saldos reales al cierre de cada mes. Así comparo el plan contra la realidad cuando me pidas actualizar.</p>
    <button class="btn small" data-act="cierre" data-m="${curMonth()}">Anotar saldos de hoy</button></div>
  <div class="card"><h2>Vincular celular</h2><p class="small">Muestra un QR para abrir la app en otro dispositivo. <b>No lo compartas</b>: es la llave de tus datos.</p>
    <button class="btn small" data-act="qr">Mostrar QR</button><div id="qrbox"></div></div>
  <div class="card"><h2>Respaldo y actualización</h2>
    <p class="small">Tu progreso vive en este dispositivo. Exporta un respaldo y guárdalo en la carpeta <i>Finanzas Personales/progreso</i> de Drive para que yo lo lea cuando actualice el plan.</p>
    <div class="chip-row"><button class="btn small" data-act="export">Exportar progreso</button><label class="btn small ghost">Importar<input type="file" accept="application/json" id="imp" hidden></label><button class="btn small ghost" data-act="reload">Buscar actualización</button></div></div>
  <div class="card"><h2>Seguridad</h2><p class="small">Los datos están cifrados con AES-256: en GitHub solo hay texto ilegible y la clave vive en tu celular y en el Administrador de credenciales de tu PC. Si pierdes el celular, pídeme cambiar la clave y la copia vieja queda inservible.</p>
    <button class="btn small danger" data-act="forget">Olvidar clave en este dispositivo</button></div>
  <p class="tiny muted center" style="padding:.5rem">Plan ${esc(PLAN.version)} · generado ${esc(PLAN.generado)} · app ${APP_VERSION}</p>`;
}

/* ---------- Acciones ---------- */
const ACT = {
  addGasto() {
    const monto = Number(String($('#gm').value).replace(/[^\d]/g, ''));
    if (!monto) return toast('Escribe el monto');
    STATE.gastos.push({ id: Date.now().toString(36), fecha: $('#gf').value || todayStr(), cat: $('#gc').value, monto, nota: $('#gn').value.trim() });
    saveState(); toast('Gasto guardado'); render();
  },
  delGasto(b) { STATE.gastos = STATE.gastos.filter(g => g.id !== b.dataset.id); saveState(); render(); },
  cierre(b) {
    const mes = b.dataset.m;
    const campos = (PLAN.deudas || []).map(d => [d.id, d.nombre]).concat(Object.entries(PLAN.bolsillos || {}));
    const prev = STATE.saldos[mes] || {};
    view.innerHTML = `<div class="card"><h2>Cierre de ${monthName(mes)}</h2>
      <ol class="list-plain small"><li>Descarga los extractos de tus cuentas, tarjetas y créditos.</li><li>Súbelos a su carpeta en Drive.</li><li>Escribe aquí los saldos reales de hoy.</li><li>Exporta el progreso y pídeme “actualiza la app”.</li></ol>
      ${campos.map(([id, n]) => `<label class="f" for="s_${id}">${esc(n)}</label><input class="i" id="s_${id}" inputmode="numeric" value="${prev[id] != null ? prev[id] : ''}">`).join('')}
      <label style="display:block;margin-top:.7rem"><input type="checkbox" id="extr" ${STATE.cierres[mes] ? 'checked' : ''}> Ya subí los extractos del mes a la carpeta</label>
      <div class="chip-row" style="margin-top:.7rem"><button class="btn" id="gs">Guardar</button><button class="btn ghost" id="gc2">Cancelar</button></div></div>`;
    $('#gc2').onclick = () => render();
    $('#gs').onclick = () => {
      const s = { fecha: todayStr() }; campos.forEach(([id]) => { const v = $('#s_' + id).value.replace(/[^\d]/g, ''); if (v !== '') s[id] = Number(v); });
      STATE.saldos[mes] = s; if ($('#extr').checked) STATE.cierres[mes] = new Date().toISOString(); else delete STATE.cierres[mes];
      saveState(); toast('Cierre guardado'); render();
    };
  },
  async notif() {
    if (!('Notification' in window)) return toast('Este navegador no soporta notificaciones. Instala la app (Agregar a pantalla de inicio).');
    const p = await Notification.requestPermission(); STATE.notif.on = p === 'granted'; saveState(); render();
    if (p === 'granted') { registerPeriodicSync(); maybeNotify(true); }
  },
  async testNotif() { await showNotif('Prueba de Plan Finanzas', 'Así te voy a regañar cuando no cumplas 😉'); },
  ics() { downloadICS(); },
  qr() {
    if (!window.QR) return;
    const url = location.origin + location.pathname + '#k=' + KEY;
    $('#qrbox').innerHTML = `<div class="qr">${QR.toSVG(url, { ecl: 'M' })}</div><p class="tiny muted center" style="padding:0">Escanéalo con la cámara del celular. Luego toca “Agregar a pantalla de inicio”.</p>`;
  },
  export() {
    const blob = new Blob([JSON.stringify({ app: APP_VERSION, plan: PLAN.version, exportado: new Date().toISOString(), state: STATE }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `progreso-finanzas-${todayStr()}.json`; a.click();
  },
  reload() { location.reload(); },
  forget() { if (confirm('¿Olvidar la clave en este dispositivo? Tendrás que escanear el QR otra vez.')) { localStorage.removeItem(KEY_LS); location.reload(); } }
};
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'imp') {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const j = JSON.parse(t); if (j.state) { STATE = Object.assign(loadState(), j.state); saveState(); toast('Progreso importado'); render(); } }).catch(() => toast('Archivo inválido'));
  }
});

/* ---------- Notificaciones ---------- */
async function showNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return toast(body);
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'plan-finanzas', renotify: true }); }
  catch { new Notification(title, { body }); }
}
function maybeNotify(force) {
  if (!PLAN || !('Notification' in window) || Notification.permission !== 'granted') return;
  const last = STATE.notif.last ? Date.parse(STATE.notif.last) : 0;
  if (!force && Date.now() - last < 3 * 3600e3) return;
  const h = todayStr(), od = overdue(), hoy = dueRange(h, h), cp = cierrePendiente();
  if (!od.length && !hoy.length && !(cp && cp.dias > 3)) return;
  let title, body;
  if (od.length) { const worst = od.sort((a, b) => a.fecha.localeCompare(b.fecha))[0], d = daysBetween(worst.fecha, h);
    title = d >= 7 ? '🚨 ALARMA financiera' : d >= 3 ? '😠 Regaño del plan' : '⏰ Tienes pendientes'; body = nagText(worst, d) + (od.length > 1 ? ` (+${od.length - 1} más)` : ''); }
  else if (hoy.length) { title = '📌 Hoy toca'; body = hoy.map(t => t.titulo + (t.monto ? ' ' + money(t.monto) : '')).join(' · '); }
  else { title = 'Cierre de mes pendiente'; body = `Sube los extractos de ${monthName(cp.mes)} y anota tus saldos.`; }
  STATE.notif.last = new Date().toISOString(); localStorage.setItem(STATE_LS, JSON.stringify(STATE));
  showNotif(title, body);
}
async function syncPendientes() {
  // Copia mínima de pendientes para que el service worker pueda avisar en segundo plano (Android, app instalada).
  if (!PLAN || !('caches' in window)) return;
  const h = todayStr();
  const list = allTasks().filter(t => !isDone(t.id) && t.fecha <= addDays(h, 3)).map(t => ({ id: t.id, f: t.fecha, t: t.titulo, p: t.tipo === 'pago' }));
  try { const c = await caches.open('fin-meta'); await c.put('./__pendientes.json', new Response(JSON.stringify({ n: PLAN.persona.nombre, list }), { headers: { 'content-type': 'application/json' } })); } catch { }
}
async function registerPeriodicSync() {
  try { const reg = await navigator.serviceWorker.ready; if ('periodicSync' in reg) await reg.periodicSync.register('regano', { minInterval: 6 * 3600e3 }); } catch { }
}

/* ---------- Calendario .ics ---------- */
function downloadICS() {
  const h = todayStr(), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlanFinanzas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Plan Finanzas', 'X-WR-TIMEZONE:America/Bogota'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const escI = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const fold = l => { const out = []; while (l.length > 73) { out.push(l.slice(0, 73)); l = ' ' + l.slice(73); } out.push(l); return out; };
  const ev = (uid, date, hh, mm, dur, title, desc, alarms) => {
    const d = date.replace(/-/g, ''), st = `${d}T${pad(hh)}${pad(mm)}00`;
    const endMin = hh * 60 + mm + dur, et = `${d}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`;
    const L = ['BEGIN:VEVENT', `UID:${uid}@plan-finanzas`, `DTSTAMP:${stamp}`, `DTSTART;TZID=America/Bogota:${st}`, `DTEND;TZID=America/Bogota:${et}`, `SUMMARY:${escI(title)}`, `DESCRIPTION:${escI(desc)}`];
    alarms.forEach(a => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(title)}`, `TRIGGER:${a}`, 'END:VALARM'));
    L.push('END:VEVENT'); L.forEach(l => lines.push(...fold(l)));
  };
  const byDate = {};
  allTasks().filter(t => t.fecha >= h).forEach(t => { (byDate[t.fecha] = byDate[t.fecha] || []).push(t); });
  Object.entries(byDate).forEach(([date, ts]) => {
    const desc = ts.map(t => `• ${t.titulo}${t.monto ? ' — ' + money(t.monto) : ''}${t.desde ? ' (desde ' + t.desde + ')' : ''}`).join('\n') + '\n\nMárcalo en la app Plan Finanzas.';
    const crit = ts.some(t => t.critica);
    ev(`d${date}`, date, 8, 0, 30, `💰 Plan: ${ts.length} tarea${ts.length > 1 ? 's' : ''} hoy${crit ? ' (pagos con fecha límite)' : ''}`, desc, crit ? ['-P1DT12H', '-PT0M'] : ['-PT0M']);
    ev(`n${date}`, date, 20, 0, 15, '❓ ¿Ya hiciste las tareas del plan de hoy?', 'Si no las marcaste en la app, hazlo ya.\n\n' + desc, ['-PT0M']);
    ev(`r${date}`, addDays(date, 1), 7, 30, 15, '😠 Si ayer no cumpliste el plan, hazlo HOY', desc, ['-PT0M']);
  });
  PLAN.meses.forEach(m => { if (m.id < curMonth()) return; const nx = m.id === '2099-12' ? null : addDays(m.id + '-28', 5).slice(0, 7);
    if (!nx) return; ev(`c${m.id}`, nx + '-02', 19, 0, 30, `📂 Cierre de ${monthName(m.id)}: sube extractos y anota saldos`, 'Descarga los extractos de cuentas, tarjetas y créditos, súbelos a Drive, anota saldos en la app y pídeme “actualiza la app”.', ['-PT0M']);
    ev(`c5${m.id}`, nx + '-05', 19, 0, 15, `😠 ¿Ya cerraste ${monthName(m.id)}?`, 'Si no lo has hecho, hazlo hoy.', ['-PT0M']); });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'plan-finanzas-recordatorios.ics'; a.click();
  toast('Calendario descargado');
}

boot();
