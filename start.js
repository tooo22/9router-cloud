const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const appDir = path.join(__dirname, "node_modules", "9router", "app");
const publicDir = path.join(appDir, "public");

// 0. Auto-restore encrypted laptop database if db.enc is present
const encDbPath = path.join(__dirname, "db.enc");
if (fs.existsSync(encDbPath)) {
  try {
    const crypto = require("crypto");
    const zlib = require("zlib");
    const os = require("os");
    const targetDir = process.env.DATA_DIR || (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router", "db")
      : path.join(os.homedir(), ".9router", "db"));

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const enc = fs.readFileSync(encDbPath);
    const key = crypto.scryptSync("pojokai-sync-key-9router", "salt123", 32);
    const iv = enc.subarray(0, 16);
    const data = enc.subarray(16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decGz = Buffer.concat([decipher.update(data), decipher.final()]);
    const decRaw = zlib.gunzipSync(decGz);

    const targetDb = path.join(targetDir, "data.sqlite");
    fs.writeFileSync(targetDb, decRaw);
    console.log(`[DB] Successfully restored laptop database into ${targetDb} (${decRaw.length} bytes)!`);
  } catch (err) {
    console.error("[DB] Warning restoring db.enc:", err.message);
  }
}

// 1. Inject custom public assets
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
      console.log(`[Asset] Injected ${file}`);
    }
  } catch (e) {
    console.error(`Warning copying ${file}:`, e.message);
  }
}

// 2. Overwrite custom-server.js cleanly with our perfected version
const srcCustomServer = path.join(__dirname, "custom-server.js");
const destCustomServer = path.join(appDir, "custom-server.js");
if (fs.existsSync(srcCustomServer)) {
  fs.copyFileSync(srcCustomServer, destCustomServer);
  console.log("[Server] Injected clean custom-server.js successfully!");
}

// 3. Unlock Next.js middleware: allow /api/* routes without 401
const middlewarePath = path.join(appDir, ".next-cli-build", "server", "middleware.js");
if (fs.existsSync(middlewarePath)) {
  try {
    let mwContent = fs.readFileSync(middlewarePath, "utf8");
    if (mwContent.includes('aJ=["/api/health"')) {
      mwContent = mwContent.replace('aJ=["/api/health"', 'aJ=["/api", "/api/health"');
      fs.writeFileSync(middlewarePath, mwContent, "utf8");
      console.log("[Middleware] Successfully unlocked all /api/* routes!");
    } else if (mwContent.includes('aJ=["/api"')) {
      console.log("[Middleware] /api/* routes already unlocked.");
    }
  } catch (err) {
    console.error("[Middleware] Warning unlocking middleware:", err.message);
  }
}

// 4. Start 9Router
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
