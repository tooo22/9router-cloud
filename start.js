const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const appDir = path.join(__dirname, "node_modules", "9router", "app");
const publicDir = path.join(appDir, "public");

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

// 3. Patch SQLite database to ensure requireLogin=false
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
            print('[DB] Configured requireLogin=False in:', p)
        except Exception as e:
            pass
`;
  execSync(`python3 -c "${py.replace(/\n/g, ';').replace(/"/g, '\\"')}"`, { stdio: "ignore" });
} catch (e) {}

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
