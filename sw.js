/* Service worker: funciona sin conexión y avisa de pendientes en segundo plano cuando el sistema lo permite. */
const CACHE = 'fin-shell-v10';
const SHELL = ['./', 'index.html', 'styles.css?v=10', 'app.js?v=10', 'qr.js?v=10', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'fin-meta').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Datos y código: primero la red (para recibir actualizaciones), si no hay red, la copia guardada.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); const key = url.pathname.endsWith('plan.enc.json') ? 'data/plan.enc.json' : e.request; caches.open(CACHE).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(url.pathname.endsWith('plan.enc.json') ? 'data/plan.enc.json' : e.request, { ignoreSearch: true })));
});

async function avisar() {
  const c = await caches.open('fin-meta'); const r = await c.match('./__pendientes.json'); if (!r) return;
  const { n, list } = await r.json();
  const d = new Date(), hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tarde = list.filter(t => t.f < hoy), deHoy = list.filter(t => t.f === hoy);
  if (!tarde.length && !deHoy.length) return;
  const dias = tarde.length ? Math.round((new Date(hoy) - new Date(tarde[0].f)) / 864e5) : 0;
  const title = tarde.length ? (dias >= 7 ? '🚨 ALARMA financiera' : dias >= 3 ? '😠 Regaño del plan' : '⏰ Tienes pendientes') : '📌 Hoy toca';
  const body = tarde.length ? `${n}, tienes ${tarde.length} tarea(s) atrasada(s): "${tarde[0].t}"${dias ? ` (${dias} días)` : ''}. Ábreme y márcalas.` : deHoy.map(t => t.t).join(' · ');
  await self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'plan-finanzas', renotify: true });
  if (self.navigator && 'setAppBadge' in self.navigator) self.navigator.setAppBadge(tarde.length + deHoy.length).catch(() => {});
}
self.addEventListener('periodicsync', e => { if (e.tag === 'regano') e.waitUntil(avisar()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs) { if ('focus' in c) return c.focus(); } return self.clients.openWindow('./'); }));
});
