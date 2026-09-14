// Resolve the booted iOS Simulator and the online Android emulator.
// Used by boot scripts and the device-lane Maestro runner. Never hard-code a UDID.
import { execFileSync } from "node:child_process";
import { resolveAdb, resolveXcrun } from "../device-probe.mjs";
import { phoneScore } from "./demo.mjs";

export function listIosPhones(xcrun) {
  let raw;
  try {
    raw = execFileSync(xcrun, ["simctl", "list", "devices", "available", "-j"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(`simctl list failed: ${e.stderr || e.message}`);
  }
  const data = JSON.parse(raw);
  const phones = [];
  for (const [runtime, devices] of Object.entries(data.devices || {})) {
    if (!/iOS/i.test(runtime)) continue;
    for (const d of devices || []) {
      if (d.isAvailable === false) continue;
      const score = phoneScore(d.name);
      if (!score) continue;
      phones.push({
        name: d.name,
        udid: d.udid,
        state: d.state,
        runtime,
        score,
      });
    }
  }
  return phones;
}

/** Prefer a booted iPhone, then 16/15/14, then any iPhone. */
export function pickIosPhone(phones) {
  const booted = phones.filter((p) => /booted/i.test(p.state || ""));
  if (booted.length) {
    booted.sort((a, b) => b.score - a.score);
    return booted[0];
  }
  const preferred = phones.filter((p) => p.score >= 10);
  const pool = preferred.length ? preferred : phones;
  pool.sort((a, b) => b.score - a.score);
  return pool[0] || null;
}

/** Booted Simulator only. Null if nothing is up — do not invent a UDID. */
export function resolveBootedIosSimulator(xcrun = resolveXcrun()) {
  if (!xcrun) return null;
  try {
    const phones = listIosPhones(xcrun);
    const booted = phones.filter((p) => /booted/i.test(p.state || ""));
    if (!booted.length) return null;
    booted.sort((a, b) => b.score - a.score);
    return booted[0];
  } catch {
    return null;
  }
}

export function listAndroidEmulators(adb) {
  const out = execFileSync(adb, ["devices"], { encoding: "utf8" });
  const rows = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(emulator-\d+)\s+(\S+)/);
    if (m) rows.push({ serial: m[1], state: m[2] });
  }
  return rows;
}

export function onlineAndroidEmulator(adb) {
  return listAndroidEmulators(adb).find((r) => r.state === "device") || null;
}

/** Online emulator serial only (typically emulator-5554). */
export function resolveOnlineAndroidEmulator(adb = resolveAdb()) {
  if (!adb) return null;
  try {
    return onlineAndroidEmulator(adb);
  } catch {
    return null;
  }
}

/**
 * Maestro 2.x global flags must come before `test`.
 * `--device` / `--udid` and `--platform` keep iOS YAML off the Android AVD.
 * `--no-ansi` disables the live TTY box (cursor moves / reserved rows) that
 * dumps as a giant blank hole when logs are captured.
 */
export function maestroTestArgs({ platform, deviceId, flow }) {
  const args = [];
  if (platform) args.push("--platform", platform);
  if (deviceId) args.push("--device", deviceId);
  args.push("--no-ansi", "test", flow);
  return args;
}

/** Force Maestro's plain renderer even if the parent process has a TTY. */
export function maestroCliEnv(env = process.env) {
  return {
    ...env,
    CI: "1",
    TERM: "dumb",
    NO_COLOR: "1",
  };
}

const ANSI_RE =
  // CSI / OSC / single-char ESC — Maestro's live UI uses cursor + erase.
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;

/**
 * Keep the ✅ step list, drop the reserved-row hole (consecutive blanks)
 * and leftover ANSI if `--no-ansi` is ignored.
 */
export function compactMaestroLog(text) {
  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_RE, "")
    .split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.replace(/[ \t]+$/g, "");
    const blank = trimmed.trim() === "";
    if (blank) {
      if (out.length === 0 || out[out.length - 1] === "") continue;
      out.push("");
      continue;
    }
    out.push(trimmed);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? `${out.join("\n")}\n` : "";
}
