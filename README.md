# Plan Finanzas

App web instalable (PWA) para seguir un plan financiero personal mes a mes: tareas por quincena, recordatorios, sobres de gasto, metas y proyección de deudas.

- **Los datos no están en este repositorio en texto plano.** `data/plan.enc.json` está cifrado con AES-256-GCM; la clave nunca se sube y solo vive en los dispositivos del dueño.
- Sin servidor: funciona en GitHub Pages, sin conexión (service worker) y guarda el progreso en el dispositivo.
- Recordatorios: notificaciones cuando la app está abierta, aviso en segundo plano donde el navegador lo permite y un calendario `.ics` exportable con alarmas.

Archivos: `index.html`, `app.js` (lógica y vistas), `qr.js` (generador de QR local), `sw.js` (offline y avisos), `styles.css`, `manifest.webmanifest`.
