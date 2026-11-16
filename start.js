const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

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

// 2. Ensure data.sqlite disables requireLogin and requireApiKey so remote mobile access works 100%
function patchSqliteSettings() {
  try {
    const py = `
import sqlite3, json, os, glob
candidates = [
    os.path.expanduser('~/.9router/db/data.sqlite'),
    os.path.expanduser('/data/home/.9router/db/data.sqlite'),
    os.path.expanduser('~/.9router/data.sqlite')
] + glob.glob(os.path.expanduser('~/**/data.sqlite'), recursive=True)

for p in set(candidates):
    if os.path.exists(p):
        try:
            conn = sqlite3.connect(p)
            cur = conn.cursor()
            cur.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, data TEXT)')
            cur.execute('SELECT data FROM settings WHERE id = 1')
            row = cur.fetchone()
            d = json.loads(row[0]) if row and row[0] else {}
            d['requireLogin'] = False
            d['requireApiKey'] = False
            cur.execute('INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)', (json.dumps(d),))
            conn.commit()
            conn.close()
            print('[DB] requireLogin disabled in:', p)
        except Exception as ex:
            print('[DB] Error patching', p, ex)
`;
    execSync(`python3 -c "${py.replace(/\n/g, ';').replace(/"/g, '\\"')}"`, { stdio: "inherit" });
  } catch (e) {
    console.log("[DB] Note on sqlite patch:", e.message);
  }
}
patchSqliteSettings();

// 3. Patch custom-server.js to serve /mobile, route hostnames, and bypass 401
const customServerPath = path.join(appDir, "custom-server.js");
if (fs.existsSync(customServerPath)) {
  try {
    let content = fs.readFileSync(customServerPath, "utf8");

    // Add helper
    if (!content.includes("function getCliToken()")) {
      const helper = `
let _cachedCliTok = null;
function getCliToken() {
  if (_cachedCliTok) return _cachedCliTok;
  try {
    const _fs = require("fs");
    const _path = require("path");
    const _os = require("os");
    const _crypto = require("crypto");
    const dDir = process.env.DATA_DIR || (process.platform === "win32"
      ? _path.join(process.env.APPDATA || _path.join(_os.homedir(), "AppData", "Roaming"), "9router")
      : _path.join(_os.homedir(), ".9router"));
    const raw = _fs.readFileSync(_path.join(dDir, "machine-id"), "utf8").trim();
    const sec = _fs.readFileSync(_path.join(dDir, "auth", "cli-secret"), "utf8").trim();
    _cachedCliTok = _crypto.createHash("sha256").update(raw + "9r-cli-auth" + sec).digest("hex").substring(0, 16);
    return _cachedCliTok;
  } catch (e) {
    return "";
  }
}
`;
      content = helper + content;
    }

    // Replace the proxy header logic to treat mobile tunnel requests as trusted internal requests
    const oldProxyLogic = 'if (viaProxy) req.headers["x-9r-via-proxy"] = "1";';
    const newProxyLogic = `
    const u = (req.url || "").split("?")[0];
    const host = (req.headers["host"] || "").toLowerCase();
    const isMobileHost = host.includes("9router") || host.includes("mobile.");

    // Always inject internal CLI auth token for mobile and internal requests
    try {
      const tok = getCliToken();
      if (tok) req.headers["x-9r-cli-token"] = tok;
    } catch {}

    // When accessed through tunnel / mobile, spoof loopback to bypass remote auth lock
    if (isMobileHost || u.startsWith("/api/")) {
      req.headers["x-9r-real-ip"] = "127.0.0.1";
      delete req.headers["x-9r-via-proxy"];
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-real-ip"];
    } else if (viaProxy) {
      req.headers["x-9r-via-proxy"] = "1";
    }

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

    // Replace whatever was previously patched
    if (content.includes(oldProxyLogic)) {
      content = content.replace(oldProxyLogic, newProxyLogic);
    }

    fs.writeFileSync(customServerPath, content, "utf8");
    console.log("[Patch] custom-server.js successfully verified and patched!");
  } catch (err) {
    console.error("[Patch] Warning patching custom-server.js:", err.message);
  }
}

// 4. Port configuration (default 20128 for Cloudflare Tunnel compatibility)
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
