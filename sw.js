/* Service worker — Registrasi Kode Barang
   - File aplikasi: jaringan dulu (agar update langsung terbaca), cadangan dari cache saat offline.
   - Library/font dari CDN: cache lalu perbarui diam-diam.
   - Panggilan ke Google Apps Script (data) TIDAK pernah di-cache. */
const VER = 'kb-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png'];
const EXT = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  // satu file gagal (mis. belum terupload) tidak boleh membatalkan instalasi service worker
  e.waitUntil(caches.open(VER).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== VER + '-ext').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VER).then(c => c.put(req, copy)); }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
      )
    );
    return;
  }

  if (EXT.includes(url.hostname)) {
    e.respondWith(
      caches.open(VER + '-ext').then(c =>
        c.match(req).then(hit => {
          const net = fetch(req).then(res => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone());
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // selain itu (mis. script.google.com) -> langsung ke jaringan
});
