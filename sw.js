/* Black Apron 対策 — オフライン用サービスワーカー
   v60: 新形式5種を追加。問題データ(.enc)はネット優先。
        キャッシュ優先のままだと、内容を更新しても端末に古いデータが残り続けるため */
const CACHE = "bp-cache-v114";
/* .enc はここに入れない。index.html が "app.enc?v=BUILD" で取り、
   ネット優先ハンドラが実際に取れたものをオフライン用に保存する。
   ここで版クエリ無しに取ると別URL扱いになり、更新のたび2.7MBを二重にダウンロードしていた */
const LOCAL = ["./index.html", "./manifest.webmanifest",
               "./icon-180.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];
/* Babel は不要になった（app.enc の中身が変換済みJSのため）。
   キャッシュに残っている旧世代は activate の掃除で CACHE ごと消える */
const CDN = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
];

/* 保存してよいレスポンスか（リダイレクト・エラー・認証画面は保存しない） */
const cacheable = (res) =>
  res && res.ok && !res.redirected && res.type !== "opaqueredirect";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all([...LOCAL, ...CDN].map(async (u) => {
      try {
        // cache:"reload" でブラウザのHTTPキャッシュを迂回し、必ず最新を取る
        const res = await fetch(u, { cache: "reload" });
        if (cacheable(res)) await c.put(u, res);
      } catch (err) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k !== CACHE);
    /* 旧キャッシュを消す前に、オフライン用の .enc を新キャッシュへ移す（再ダウンロード無し）。
       移さないと更新直後の端末は、次にオンラインで開くまで機内モードで起動できない（2周目R1）。
       中身が1世代古くても「起動できない」よりはよく、次のオンライン起動でネット優先ハンドラが上書きする */
    try {
      const c = await caches.open(CACHE);
      for (const k of old) {
        const oc = await caches.open(k);
        for (const req of await oc.keys()) {
          const u = new URL(req.url);
          if (!u.pathname.endsWith(".enc")) continue;
          if (await c.match(req, { ignoreSearch: true })) continue;
          const res = await oc.match(req);
          if (res) await c.put(u.origin + u.pathname, res);
        }
      }
    } catch (err) {}
    await Promise.all(old.map((k) => caches.delete(k)));
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
