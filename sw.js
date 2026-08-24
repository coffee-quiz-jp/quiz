/* Black Apron 対策 — オフライン用サービスワーカー
   v51: 合言葉エラー表示の修正。問題データ(.enc)はネット優先。
        キャッシュ優先のままだと、内容を更新しても端末に古いデータが残り続けるため */
const CACHE = "bp-cache-v51";
const LOCAL = ["./index.html", "./app.enc", "./assets.enc", "./manifest.webmanifest",
               "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];
const CDN = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.24.7/babel.min.js",
];

/* 保存してよいレスポンスか（リダイレクト・エラー・認証画面は保存しない） */
const cacheable = (res) =>
  res && res.ok && !res.redirected && res.type !== "opaqueredirect";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all([...LOCAL, ...CDN].map(async (u) => {
      try {
        const res = await fetch(u);
        if (cacheable(res)) await c.put(u, res);
      } catch (err) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  /* Access の認証まわりには一切触らない */
  if (url.pathname.startsWith("/cdn-cgi/") || url.hostname.endsWith("cloudflareaccess.com")) return;

  /* ページ本体はネット優先。リダイレクトはブラウザに委ねる */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.redirected) return Response.redirect(res.url, 302);
        if (cacheable(res)) {
          const c = await caches.open(CACHE);
          c.put("./index.html", res.clone()).catch(() => {});
        }
        return res;
      } catch (err) {
        const hit = await caches.match("./index.html", { ignoreVary: true });
        return hit || Response.error();
      }
    })());
    return;
  }

  /* 問題データはネット優先（つながらない時だけキャッシュを使う）。
     URLの ?v=... が変わってもキャッシュを引けるよう ignoreSearch で照合する */
  if (url.pathname.endsWith(".enc")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (cacheable(res)) {
          const c = await caches.open(CACHE);
          c.put(url.origin + url.pathname, res.clone()).catch(() => {});
        }
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreVary: true, ignoreSearch: true });
        return hit || Response.error();
      }
    })());
    return;
  }

  /* それ以外（JS・画像）はキャッシュ優先 */
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreVary: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (cacheable(res)) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
