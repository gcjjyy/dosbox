const path = require("node:path");
const fs = require("node:fs");

function loadDotEnv(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) continue;
    out[name] = line.slice(eq + 1);
  }
  return out;
}

const envFromFile = loadDotEnv(path.join(__dirname, ".env"));

module.exports = {
  apps: [
    {
      name: "dosbox",
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      cwd: "/home/gcjjyy/lab/dosbox",
      env: {
        NODE_ENV: "production",
        ...envFromFile,
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
  ],
};
