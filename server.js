// Smart Eco Campus — Render deployment backend
// Node.js 18+. Render supplies PORT; bind to 0.0.0.0 for public hosting.
// Keep ROBOFLOW_API_KEY in Render Environment settings, never in index.html.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const API_KEY = process.env.ROBOFLOW_API_KEY;
const WORKFLOW_URL = "https://serverless.roboflow.com/advaiths-workspace-wvko1/workflows/full-body-uniform-check-1795538335596";
const HTML_FILE = path.join(__dirname, "index.html");
const MAX_BODY = 15 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(HTML_FILE).pipe(res);
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/uniform-check") {
    if (!API_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ROBOFLOW_API_KEY is not configured on the server." }));
      return;
    }

    let raw = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", chunk => {
      if (tooLarge) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Image request is too large. Please use a smaller image." }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (tooLarge) return;
      try {
        const payload = JSON.parse(raw || "{}");
        const image = payload?.inputs?.image;
        if (!image || !["url", "base64"].includes(image.type) || typeof image.value !== "string" || !image.value) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request must include inputs.image with a url or base64 value." }));
          return;
        }

        const upstream = await fetch(WORKFLOW_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
          },
          body: JSON.stringify(payload)
        });

        const responseText = await upstream.text();
        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") || "application/json"
        });
        res.end(responseText);
      } catch (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Roboflow request failed: ${err.message || "network error"}` }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Smart Eco Campus server listening on ${HOST}:${PORT}`);
});
