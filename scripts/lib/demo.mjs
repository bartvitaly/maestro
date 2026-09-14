// Shared Harbor Lease demo constants. Static HTML on :4173.
// Android device lane installs a thin WebView APK (com.example.listings), not Chrome.
// iOS device lane installs a thin WKWebView app (com.example.listings), not Safari.
import { execFileSync } from "node:child_process";

export const ROOT_PORT = Number(process.env.SAMPLE_PORT) || 4173;
export const BIND_HOST = process.env.SAMPLE_BIND || "0.0.0.0";

/** iOS Simulator shares the host network. */
export function iosDemoUrl(port = ROOT_PORT) {
  return process.env.SAMPLE_IOS_URL || `http://127.0.0.1:${port}`;
}

/** Android emulator reaches the host at 10.0.2.2, not 127.0.0.1. */
export function androidDemoUrl(port = ROOT_PORT) {
  return process.env.SAMPLE_ANDROID_URL || `http://10.0.2.2:${port}`;
}

/** Maestro `url:` flows run host Chromium — always the Mac loopback. */
export function maestroWebUrl(port = ROOT_PORT) {
  return process.env.SAMPLE_MAESTRO_URL || `http://127.0.0.1:${port}`;
}

/** Thin Android WebView wrapper. Not a Capacitor / Play Store binary. */
export const ANDROID_APP_ID = "com.example.listings";
export const ANDROID_ACTIVITY = "com.example.listings.MainActivity";

/** Thin iOS WKWebView wrapper. Not a Capacitor / App Store binary. */
export const IOS_APP_ID = "com.example.listings";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitSync(ms) {
  const n = Math.max(0, Number(ms) || 0);
  try {
    const buf = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(buf, 0, 0, n);
  } catch {
    execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${n})`], {
      stdio: "ignore",
      timeout: n + 2000,
    });
  }
}

export async function waitForHttp(url, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  return false;
}

/** Machine-readable skip so test-device.mjs keeps the real missing token (not "unspecified"). */
export function emitDeviceSkip(id, missing = []) {
  const miss = Array.isArray(missing) && missing.length ? missing.join(",") : "";
  console.log(miss ? `DEVICE_SKIP ${id} ${miss}` : `DEVICE_SKIP ${id}`);
}

/**
 * Human SKIP: plus optional DEVICE_SKIP lines.
 * @param {string} message
 * @param {Array<string|{id:string,missing?:string[]}>} [lanes]
 */
export function skip(message, lanes = []) {
  console.log(`SKIP: ${message}`);
  for (const lane of lanes) {
    if (typeof lane === "string") emitDeviceSkip(lane);
    else if (lane?.id) emitDeviceSkip(lane.id, lane.missing);
  }
  return { skipped: true, message };
}

/** Prefer iPhone 16, then 15, then 14. Any other iPhone is a last resort. */
export function phoneScore(name) {
  if (!name) return 0;
  if (/^iPhone 16\b/.test(name)) return 30;
  if (/^iPhone 15\b/.test(name)) return 20;
  if (/^iPhone 14\b/.test(name)) return 10;
  if (/^iPhone /.test(name)) return 1;
  return 0;
}
