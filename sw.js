/* ============================================
   Taxi Madrid · Service Worker
   Caché offline + assets + tiles + datos
   ============================================ */

const CACHE_VERSION = 'taxi-madrid-v1.0.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const TILE_CACHE    = `${CACHE_VERSION}-tiles`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

const MAX_TILES = 500;
const MAX_RUNTIME_ENTRIES = 80;
const MAX_DATA_ENTRIES = 30;

/* Assets que se cachean en la instalación */
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE && k !== TILE_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- HELPERS ---------- */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    for (let i = 0; i < keys.length - maxEntries; i++) {
      await cache.delete(keys[i]);
    }
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejar GET
  if (req.method !== 'GET') return;

  // WebSocket (Nostr) → no tocar
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // Tiles del mapa (OpenStreetMap) → cache-first, actualización en background
  if (url.hostname.endsWith('tile.openstreetmap.org') ||
      url.hostname.endsWith('tile.openstreetmap.fr') ||
      url.hostname.endsWith('tiles.stadiamaps.com')) {
    event.respondWith(cacheFirst(req, TILE_CACHE, MAX_TILES));
    return;
  }

  // Datos de paradas Madrid / OSM Overpass → stale-while-revalidate
  if (url.hostname.includes('datos.madrid.es') ||
      url.hostname.includes('overpass-api.de') ||
      url.hostname.includes('overpass.kumi.systems')) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE, MAX_DATA_ENTRIES));
    return;
  }

  // Nominatim / OSRM (geocoding y rutas) → network-first con fallback
  if (url.hostname.includes('nominatim.openstreetmap.org') ||
      url.hostname.includes('router.project-osrm.org')) {
    event.respondWith(networkFirst(req, DATA_CACHE, MAX_DATA_ENTRIES));
    return;
  }

  // Librerías externas (CDNs) → cache-first
  if (url.hostname.includes('unpkg.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('esm.sh') ||
      url.hostname.includes('jsdelivr.net')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Navegación (HTML) → network-first con fallback a index cacheado
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Resto → cache-first con fallback a red
  event.respondWith(cacheFirst(req, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
});

/* ---------- MENSAJES DESDE LA APP ---------- */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE);
  }

  if (event.data.type === 'CLEAR_DATA_CACHE') {
    caches.delete(DATA_CACHE);
  }

  if (event.data.type === 'CLEAR_ALL') {
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    );
  }
});
