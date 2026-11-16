const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const appDir = path.join(__dirname, "node_modules", "9router", "app");
const publicDir = path.join(appDir, "public");

// 1. Inject our custom assets into 9router app public folder
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const assets = ["mobile.html", "pojokai.jpg", "pojokai.png"];
for (const file of assets) {
  try {
    const src = path.join(__dirname, file);
    const dest = path.join(publicDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[Asset] Injected ${file} into 9Router public folder!`);
    }
  } catch (e) {
    console.error(`Warning copying ${file}:`, e.message);
  }
}

// 2. Auto-patch custom-server.js to serve /mobile, route hostnames, and auto-authorize API
const customServerPath = path.join(appDir, "custom-server.js");
if (fs.existsSync(customServerPath)) {
  try {
    let content = fs.readFileSync(customServerPath, "utf8");

    // Add getCliToken helper if missing
    if (!content.includes("function getCliToken()")) {
      const helper = `
let _cachedCliTok = null;
function getCliToken() {
  if (_cachedCliTok) return _cachedCliTok;
  try {
    const os = require("os");
    const crypto = require("crypto");
    const dDir = process.env.DATA_DIR || (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
      : path.join(os.homedir(), ".9router"));
    const raw = fs.readFileSync(path.join(dDir, "machine-id"), "utf8").trim();
    const sec = fs.readFileSync(path.join(dDir, "auth", "cli-secret"), "utf8").trim();
    _cachedCliTok = crypto.createHash("sha256").update(raw + "9r-cli-auth" + sec).digest("hex").substring(0, 16);
    return _cachedCliTok;
  } catch (e) {
    return "";
  }
}
`;
      content = helper + content;
    }

    // Ensure x-9r-cli-token is injected into incoming requests
    if (!content.includes('req.headers["x-9r-cli-token"]')) {
      content = content.replace(
        'if (viaProxy) req.headers["x-9r-via-proxy"] = "1";',
        'if (viaProxy) req.headers["x-9r-via-proxy"] = "1";\n    try { const t = getCliToken(); if (t) req.headers["x-9r-cli-token"] = t; } catch {}'
      );
    }

    // Ensure /mobile routing is present
    if (!content.includes("isMobileHost")) {
      const target = 'if (viaProxy) req.headers["x-9r-via-proxy"] = "1";';
      const patch = `if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    try { const t = getCliToken(); if (t) req.headers["x-9r-cli-token"] = t; } catch {}
    const u = (req.url || "").split("?")[0];
    const host = (req.headers["host"] || "").toLowerCase();
    const isMobileHost = host.includes("9router") || host.includes("mobile.");
    if (u === "/pojokai.jpg" || u === "/pojokai.png") {
      const lp = path.join(__dirname, "public", "pojokai.png");
      return fs.readFile(lp, (e, d) => {
        if (e) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        res.end(d);
      });
    }
    if (u === "/mobile" || u === "/mobile/" || (u === "/" && isMobileHost)) {
      const p = path.join(__dirname, "public", "mobile.html");
      return fs.readFile(p, (e, d) => {
        if (e) { res.writeHead(404); return res.end("mobile.html missing"); }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(d);
      });
    }`;
      content = content.replace(target, patch);
    }

    fs.writeFileSync(customServerPath, content, "utf8");
    console.log("[Patch] custom-server.js successfully verified and patched!");
  } catch (err) {
    console.error("[Patch] Warning patching custom-server.js:", err.message);
  }
}

// 3. Port configuration (default 20128 for Cloudflare Tunnel compatibility)
const port = process.env.PORT || 20128;
const host = process.env.HOSTNAME || "0.0.0.0";

console.log(`Starting 9Router on ${host}:${port}...`);

const child = spawn(process.execPath, [
  "--dns-result-order=ipv4first",
  "--max-old-space-size=4096",
  "custom-server.js"
], {
  cwd: appDir,
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: host
  },
  stdio: "inherit"
});

child.on("exit", (code) => {
  console.log(`9Router process exited with code ${code}`);
  process.exit(code || 0);
});
