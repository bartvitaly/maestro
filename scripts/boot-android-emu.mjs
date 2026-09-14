#!/usr/bin/env node
// Boot a local Android emulator (if an AVD already exists), then install and
// launch the thin Harbor Lease WebView APK (com.example.listings). That wrapper
// loads the static demo at http://10.0.2.2:4173. This is not Chrome and not a
// Play Store / Capacitor binary. Serve the demo on 0.0.0.0.
// Skips (exit 0) when adb/emulator are missing, or when no AVD exists.
// Does not create an AVD.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  androidSdkHint,
  avdCreateHint,
  probeDevices,
  resolveAdb,
  resolveEmulator,
} from "./device-probe.mjs";
import { installAndLaunchWebView } from "./lib/android-app.mjs";
import { listAndroidEmulators, onlineAndroidEmulator } from "./lib/runtimes.mjs";
import { ANDROID_APP_ID, androidDemoUrl, emitDeviceSkip, skip, waitSync } from "./lib/demo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, "artifacts");
const NO_OPEN = process.argv.includes("--no-open");
const NO_PROBE = process.argv.includes("--no-probe");
const URL = androidDemoUrl();
const BOOT_TIMEOUT_SEC = Number(process.env.SAMPLE_EMU_BOOT_TIMEOUT_SEC) || 300;

function finish(status, ran, skipped) {
  if (!NO_PROBE) probeDevices({ ran, skipped });
  process.exit(status);
}

function adbOut(adb, args) {
  return execFileSync(adb, args, { encoding: "utf8" });
}

function listAvds(emu) {
  const r = spawnSync(emu, ["-list-avds"], { encoding: "utf8" });
  const names = (r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || `exit ${r.status}`).trim();
    return { names, error: detail };
  }
  return { names, error: null };
}

function pickAvd(names) {
  const pixel = names.find((n) => /pixel/i.test(n));
  return pixel || names[0];
}

function bootCompleted(adb, serial) {
  try {
    const v = adbOut(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]).trim();
    return v === "1";
  } catch {
    return false;
  }
}

function disableAnimations(adb, serial) {
  for (const key of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
    spawnSync(adb, ["-s", serial, "shell", "settings", "put", "global", key, "0"], {
      encoding: "utf8",
    });
  }
}

function openWebViewApp(adb, serial) {
  const result = installAndLaunchWebView({ adb, serial, url: URL, open: !NO_OPEN });
  return result;
}

function waitForBoot(adb, { startedAt, emuPid }) {
  const deadline = startedAt + BOOT_TIMEOUT_SEC * 1000;
  while (Date.now() < deadline) {
    if (emuPid && !alive(emuPid)) {
      throw new Error(`emulator process ${emuPid} exited before boot completed`);
    }
    const online = onlineAndroidEmulator(adb);
    if (online && bootCompleted(adb, online.serial)) return online;
    waitSync(2000);
  }
  const seen = listAndroidEmulators(adb)
    .map((r) => `${r.serial}:${r.state}`)
    .join(", ");
  throw new Error(
    `emulator did not reach sys.boot_completed within ${BOOT_TIMEOUT_SEC}s (adb: ${seen || "none"})`,
  );
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startEmulator(emu, avd) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const log = join(ARTIFACTS, "emulator.log");
  const fd = openSync(log, "a");
  const args = ["-avd", avd, "-netdelay", "none", "-netspeed", "full"];
  if (process.env.ANDROID_EMU_NO_WINDOW === "1") {
    args.push("-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect");
  }
  const child = spawn(emu, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  writeFileSync(join(ARTIFACTS, "emulator.pid"), String(child.pid));
  console.log(`Starting AVD ${avd} (pid ${child.pid}). Log: ${log}`);
  return child.pid;
}

function main() {
  const ran = [];
  const skipped = [];
  const adb = resolveAdb();
  const emu = resolveEmulator();
  if (!adb && !emu) {
    skip(
      [
        "Android emulator — adb and the emulator binary were not found.",
        androidSdkHint(),
      ].join("\n      "),
      [
        { id: "android-emulator", missing: ["adb", "emulator"] },
        { id: "android-app", missing: ["adb"] },
      ],
    );
    skipped.push({ id: "android-emulator", missing: ["adb", "emulator"] });
    skipped.push({ id: "android-app", missing: ["adb"] });
    finish(0, ran, skipped);
  }
  if (!adb) {
    skip(
      [
        "Android emulator — adb (platform-tools) not found. Cannot wait for boot or install the WebView APK.",
        androidSdkHint(),
      ].join("\n      "),
      [
        { id: "android-emulator", missing: ["adb"] },
        { id: "android-app", missing: ["adb"] },
      ],
    );
    skipped.push({ id: "android-emulator", missing: ["adb"] });
    skipped.push({ id: "android-app", missing: ["adb"] });
    finish(0, ran, skipped);
  }

  spawnSync(adb, ["start-server"], { encoding: "utf8" });

  const already = onlineAndroidEmulator(adb);
  if (already) {
    console.log(`Android emulator already online (${already.serial})`);
    disableAnimations(adb, already.serial);
    ran.push("android-emulator");
    try {
      openWebViewApp(adb, already.serial);
    } catch (e) {
      console.error(`Could not install/launch WebView app: ${e.message}`);
      emitDeviceSkip("android-app", ["webview-apk"]);
      skipped.push({
        id: "android-app",
        missing: ["webview-apk"],
        blocked: "did not install/launch WebView APK",
      });
      finish(1, ran, skipped);
    }
    console.log("Android emulator ready");
    console.log(`  serial: ${already.serial}`);
    console.log(`  url:    ${URL}`);
    console.log(`  app:    ${ANDROID_APP_ID} (WebView wrapper — static HTML demo, not Play Store)`);
    ran.push("android-app");
    finish(0, ran, skipped);
  }

  if (!emu) {
    skip(
      [
        "Android emulator — no AVD is online and the emulator binary was not found.",
        androidSdkHint(),
      ].join("\n      "),
      [
        { id: "android-emulator", missing: ["emulator"] },
        { id: "android-app", missing: ["emulator"] },
      ],
    );
    skipped.push({ id: "android-emulator", missing: ["emulator"] });
    skipped.push({ id: "android-app", missing: ["emulator"] });
    finish(0, ran, skipped);
  }

  const avdList = listAvds(emu);
  if (avdList.error && !avdList.names.length) {
    skip(
      [
        `Android emulator — \`emulator -list-avds\` failed (${avdList.error}).`,
        androidSdkHint(),
      ].join("\n      "),
      [
        { id: "android-emulator", missing: ["AVD"] },
        { id: "android-app", missing: ["AVD"] },
      ],
    );
    skipped.push({ id: "android-emulator", missing: ["AVD"], blocked: "did not boot AVD" });
    skipped.push({ id: "android-app", missing: ["AVD"], blocked: "did not install/launch WebView APK" });
    finish(0, ran, skipped);
  }
  if (!avdList.names.length) {
    skip(avdCreateHint(), [
      { id: "android-emulator", missing: ["AVD"] },
      { id: "android-app", missing: ["AVD"] },
    ]);
    skipped.push({ id: "android-emulator", missing: ["AVD"], blocked: "did not boot AVD" });
    skipped.push({ id: "android-app", missing: ["AVD"], blocked: "did not install/launch WebView APK" });
    finish(0, ran, skipped);
  }

  const avd = pickAvd(avdList.names);
  const emuPid = startEmulator(emu, avd);

  let online;
  try {
    online = waitForBoot(adb, { startedAt: Date.now(), emuPid });
  } catch (e) {
    console.error(e.message);
    emitDeviceSkip("android-emulator", ["boot-failed"]);
    emitDeviceSkip("android-app", ["boot-failed"]);
    skipped.push({ id: "android-emulator", missing: ["boot-failed"], blocked: "did not boot AVD" });
    skipped.push({ id: "android-app", missing: ["boot-failed"], blocked: "did not install/launch WebView APK" });
    finish(1, ran, skipped);
  }

  ran.push("android-emulator");
  disableAnimations(adb, online.serial);
  try {
    openWebViewApp(adb, online.serial);
  } catch (e) {
    console.error(`Could not install/launch WebView app: ${e.message}`);
    emitDeviceSkip("android-app", ["webview-apk"]);
    skipped.push({
      id: "android-app",
      missing: ["webview-apk"],
      blocked: "did not install/launch WebView APK",
    });
    finish(1, ran, skipped);
  }

  console.log("Android emulator ready");
  console.log(`  avd:    ${avd}`);
  console.log(`  serial: ${online.serial}`);
  console.log(`  url:    ${URL}`);
  console.log(`  app:    ${ANDROID_APP_ID} (WebView wrapper — static HTML demo, not Play Store)`);
  ran.push("android-app");
  finish(0, ran, skipped);
}

main();
