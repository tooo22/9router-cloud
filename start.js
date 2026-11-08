const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const appDir = path.join(__dirname, "node_modules", "9router", "app");
const publicDir = path.join(appDir, "public");

// Inject our perfected custom assets into 9router app public folder
const assets = ["mobile.html", "pojokai.jpg", "pojokai.png"];
for (const file of assets) {
  try {
    const src = path.join(__dirname, file);
    const dest = path.join(publicDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Injected ${file} into 9Router public folder!`);
    }
  } catch (e) {
    console.error(`Warning copying ${file}:`, e.message);
  }
}

// Render supplies the listening port via process.env.PORT
const port = process.env.PORT || 10000;
const host = "0.0.0.0";

console.log(`Starting 9Router on ${host}:${port}...`);

const child = spawn(process.execPath, ["custom-server.js"], {
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
