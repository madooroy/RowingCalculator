// Offline support for Rowing Calculator.
//
// The first time the app is opened online, this saves a copy of every file the
// app needs on the device. After that the app opens from that copy, so it starts
// instantly and works with no signal.
//
// RELEASING AN UPDATE: change VERSION below whenever you change any app file.
// Phones notice the new version, download it in the background, and show an
// "Update available" note. Old saved copies are deleted automatically.

const VERSION = '2026-10-18b';
const CACHE_NAME = `rowing-calculator-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'vendor/html2canvas.min.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

// Download a fresh copy of every file (skipping any copy the browser has lying
// around) and store it under this version's name.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_FILES.map(file =>
        fetch(new Request(file, { cache: 'reload' })).then(response => {
          if (!response.ok) throw new Error(`Could not cache ${file}`);
          return cache.put(file, response);
        })
      ))
    )
  );
});

// Once this version takes over, remove copies saved by older versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.startsWith('rowing-calculator-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// The page asks for this when you tap "Refresh" on the update note.
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Serve app files from the saved copy; fall back to the network for anything else.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match('index.html'))
        .then(cached => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME)
      .then(cache => cache.match(request, { ignoreSearch: true }))
      .then(cached => cached || fetch(request))
  );
});
