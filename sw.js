'use strict';
// 서비스 워커: 한 번 열면 앱 파일을 저장해 두어, 인터넷이 없어도 Daily Log 가 열리게 합니다.
// __VERSION__ 은 배포할 때 커밋 번호로 바뀝니다. 이 파일 내용이 바뀌면 브라우저가 새 버전을 설치하고,
// 아래 activate 에서 옛 버전의 저장 파일을 지웁니다.
// (개발 중에는 app.js 가 이 파일을 등록하지 않으므로, 고친 코드가 바로 보입니다.)
// 기록(localStorage)은 여기서 다루지 않습니다. 저장해 두는 것은 앱 화면 파일뿐이에요.
const VERSION = '__VERSION__';
const CACHE = `daily-log-${VERSION}`;
const CORE_FILES = [
  './',
  `./styles.css?v=${VERSION}`,
  `./logic.js?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// 설치: 앱에 필요한 파일을 미리 저장
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting()), // 기다리지 않고 바로 새 버전 사용
  );
});

// 활성화: 옛 버전 저장 파일 정리
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('daily-log-') && key !== CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // 외부(글꼴 CDN)는 그대로 인터넷으로. 인터넷이 없으면 기기 기본 글꼴로 보여요.
  if (new URL(request.url).origin !== self.location.origin) return;

  // 페이지(HTML): 인터넷 먼저 → 항상 최신 버전. 인터넷이 안 되면 저장해 둔 페이지.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // 나머지 파일: 저장해 둔 것 먼저 → 빠름. (주소에 ?v=버전 이 붙어 있어 새 버전은 다른 주소로 받음)
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});
