// Yerel test yığını için minimal API geçidi (Supabase'deki Kong'un yerine).
// /auth/v1 -> GoTrue, /rest/v1 -> PostgREST, /storage/v1 -> Storage API,
// /functions/v1/<ad> -> Edge Runtime. Yalnızca yerel geliştirme/test içindir.
import http from "node:http";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", 9999],
  ["/rest/v1", 3000],
  ["/storage/v1", 5000],
  ["/functions/v1/admin-users", 9000],
  ["/functions/v1/ai-insights", 9001],
];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*",
  "access-control-max-age": "3600",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const route = routes.find(([p]) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
    if (!route) {
      res.writeHead(404, { ...CORS, "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    const [prefix, port] = route;
    const path = req.url.slice(prefix.length) || "/";
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const up = http.request({ host: "127.0.0.1", port, path, method: req.method, headers }, (ur) => {
      const h = { ...ur.headers };
      for (const k of Object.keys(h)) if (k.startsWith("access-control-")) delete h[k];
      res.writeHead(ur.statusCode ?? 502, { ...h, ...CORS });
      ur.pipe(res);
    });
    up.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { ...CORS, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream unavailable", detail: String(e.message) }));
    });
    req.pipe(up);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`gateway listening on http://127.0.0.1:${PORT}`));
