#!/usr/bin/env node
// Static Harbor Lease demo on 0.0.0.0:4173 so an Android emulator can reach
// the host at 10.0.2.2. iOS Simulator can use 127.0.0.1 (same process).
// This is not a Capacitor server. Alternative: python3 -m http.server 4173 --bind 0.0.0.0

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BIND_HOST, ROOT_PORT, waitForHttp } from "./lib/demo.mjs";
import { requireDevices } from "./device-probe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = BIND_HOST;
const PORT = ROOT_PORT;
const ARTIFACTS = join(ROOT, "artifacts");
const PID_FILE = join(ARTIFACTS, "demo-server.pid");
const LOG_FILE = join(ARTIFACTS, "demo-server.log");
const SELF = fileURLToPath(import.meta.url);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function healthUrl() {
  return `http://127.0.0.1:${PORT}/`;
}

async function isHealthy() {
  return waitForHttp(healthUrl(), { timeoutMs: 400 });
}

function resolveSafe(urlPath) {
  const raw = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = raw === "/" ? "index.html" : raw.replace(/^\/+/, "");
  const abs = normalize(join(ROOT, rel));
  const root = resolve(ROOT) + sep;
  if (abs !== resolve(ROOT) && !abs.startsWith(root)) return null;
  return abs;
}

function startServer() {
  const server = createServer((req, res) => {
    const file = resolveSafe(req.url || "/");
    if (!file) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let target = file;
    try {
      if (existsSync(target) && statSync(target).isDirectory()) {
        target = join(target, "index.html");
      }
      const body = readFileSync(target);
      const type = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      if (warnIfLoopbackOnly(PORT) && requireDevices()) {
        console.error("SAMPLE_REQUIRE_DEVICES / --strict: 127.0.0.1-only bind is a device-lane failure.");
        process.exit(1);
      }
      console.log(
        `Port ${PORT} already in use. Reusing it. If that process is bound to 127.0.0.1 only, the Android emulator cannot reach the demo (needs 0.0.0.0; emulator uses 10.0.2.2). Restart with: npm run serve:demo`,
      );
      process.exit(0);
    }
    console.error(err);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Harbor Lease demo  http://127.0.0.1:${PORT}  bind ${HOST}:${PORT}`);
    console.log(`iOS Simulator:     http://127.0.0.1:${PORT}`);
    console.log(`Android emulator:  http://10.0.2.2:${PORT}`);
  });
}

function listenHosts(port) {
  try {
    const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    if ((r.status ?? 1) !== 0) return [];
    const hosts = new Set();
    for (const line of (r.stdout || "").split("\n")) {
      const m = line.match(/TCP\s+(\S+):(\d+)\s+\(LISTEN\)/);
      if (m && m[2] === String(port)) hosts.add(m[1]);
    }
    return [...hosts];
  } catch {
    return [];
  }
}

function isLoopbackOnly(hosts) {
  if (!hosts.length) return false;
  return hosts.every((h) => h === "127.0.0.1" || h === "[::1]" || h === "::1");
}

/** @returns {boolean} true when the listener is loopback-only */
function warnIfLoopbackOnly(port) {
  const hosts = listenHosts(port);
  if (!isLoopbackOnly(hosts)) return false;
  console.error(`Demo port ${port} is bound to 127.0.0.1 only (${hosts.join(", ")}).`);
  console.error("Android emulator uses http://10.0.2.2 and needs this process on 0.0.0.0.");
  console.error("Stop the 127.0.0.1 server (`npm start`) and run: npm run serve:demo");
  console.error("Chromium `npm test` can use 127.0.0.1; the device lane cannot share that bind.");
  return true;
}

async function startBackground() {
  if (await isHealthy()) {
    console.log(`Demo already up at ${healthUrl()}`);
    if (warnIfLoopbackOnly(PORT) && requireDevices()) {
      console.error("SAMPLE_REQUIRE_DEVICES / --strict: 127.0.0.1-only bind is a device-lane failure.");
      return 1;
    }
    console.log("Android emulator needs this server on 0.0.0.0 (npm run serve:demo), not 127.0.0.1-only (npm start).");
    return 0;
  }
  mkdirSync(ARTIFACTS, { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [SELF], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, SAMPLE_BIND: HOST, SAMPLE_PORT: String(PORT) },
    cwd: ROOT,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  const ok = await waitForHttp(healthUrl(), { timeoutMs: 10_000 });
  if (!ok) {
    console.error(`Demo server pid ${child.pid} did not become ready. See ${LOG_FILE}`);
    return 1;
  }
  console.log(`Demo server pid ${child.pid}  ${healthUrl()}  bind ${HOST}:${PORT}`);
  console.log(`Stop with: kill ${child.pid}`);
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--background")) {
  process.exit(await startBackground());
} else {
  startServer();
}
