#!/usr/bin/env node
// Device lane: serve static demo on 0.0.0.0:4173 → boot iOS sim / Android emu
// if the tools exist → install/launch the Android WebView APK and the iOS
// WKWebView app → run Maestro when `maestro` + a JRE 17+ are available.
//
// Android: thin WebView APK (com.example.listings), not Chrome.
// iOS: thin WKWebView app (com.example.listings), not Safari.
// Playwright Pixel 7 + iPhone viewports stay on `npm test` (never this script).
// Missing simctl/adb → skip that piece, exit 0 unless SAMPLE_REQUIRE_DEVICES=1
// or --strict (then SKIP is a failure for required device tools / AVD /
// runtime / 127.0.0.1-only demo — not for a missing Maestro CLI or JRE).
// Maestro is optional only when the CLI or JRE is missing and the app already
// launched. A failed Maestro run is a failure — never a soft SKIP.
// SAMPLE_HIDE_TOOLS=ios|android|maestro|java (comma-separated; see
// device-probe.mjs) pretends those resolvers found nothing — logs / CI, not
// uninstalling.
// iOS YAML always targets the booted Simulator (`--platform ios --device <udid>`).
// Android YAML always targets the online emulator (`--platform android --device <serial>`).
// Never run iOS YAML against the Android AVD (Maestro otherwise picks pixel_24).

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  javaInstallHint,
  nextStepForMissing,
  probeDevices,
  requireDevices,
  resolveAndroidSdk,
  resolveJavaHome,
  resolveMaestro,
} from "./device-probe.mjs";
import { maestroWebUrl } from "./lib/demo.mjs";
import {
  compactMaestroLog,
  maestroCliEnv,
  maestroTestArgs,
  resolveBootedIosSimulator,
  resolveOnlineAndroidEmulator,
} from "./lib/runtimes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");

const argv = process.argv.slice(2);
const strict = requireDevices(process.argv);
const positional = argv.filter((a) => !a.startsWith("-"));
const arg = (positional[0] || "all").toLowerCase();
const wantIos = arg === "all" || arg === "ios";
const wantAndroid = arg === "all" || arg === "android";

if (!wantIos && !wantAndroid) {
  console.error("Usage: node scripts/test-device.mjs [all|ios|android] [--strict]");
  console.error("  SAMPLE_REQUIRE_DEVICES=1 is the same as --strict (SKIP exits non-zero).");
  process.exit(2);
}

const ran = [];
const skipped = [];
let failed = false;

function runNode(script, args = []) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

function captureNode(script, args = []) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  return { status: r.status ?? 1, text };
}

function deviceEvidence() {
  return (
    ran.includes("android-app") ||
    ran.includes("ios-app") ||
    ran.includes("ios-simulator") ||
    ran.includes("android-emulator")
  );
}

function parseDeviceSkips(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^DEVICE_SKIP\s+(\S+)(?:\s+(\S*))?$/);
    if (!m) continue;
    const missing = (m[2] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ id: m[1], missing });
  }
  return out;
}

function recordSkipsFromBoot(text, fallback) {
  const parsed = parseDeviceSkips(text);
  skipped.push(...(parsed.length ? parsed : fallback));
}

function printRequiredDevicesFailure(blocking) {
  console.error("");
  console.error("SAMPLE_REQUIRE_DEVICES / --strict: device lane failed (SKIP is not a pass).");
  console.error("Chromium `npm test` (Pixel 7 / iPhone 14 viewports) is a separate gate.");
  const groups = [
    { title: "iOS", ids: ["ios-simulator", "ios-app", "ios-maestro-target"] },
    { title: "Android", ids: ["android-emulator", "android-app", "android-maestro-target"] },
    { title: "Demo", ids: ["serve-demo"] },
  ];
  for (const group of groups) {
    const hits = blocking.filter((s) => group.ids.includes(s.id));
    if (!hits.length) continue;
    const missing = [...new Set(hits.flatMap((s) => s.missing || []))];
    const miss = missing.length ? missing.join(", ") : "see SKIP above";
    console.error(`  ${group.title}: missing ${miss}`);
    const next = nextStepForMissing(missing);
    if (next) console.error(`         next: ${next}`);
  }
}

console.log("== Harbor Lease device lane ==");
console.log("Static HTML demo. iOS: WKWebView app. Android: WebView APK (not Chrome).");
console.log("Thin wrapper around the local demo — not a Capacitor / Play Store binary.");
console.log(`Maestro host-Chromium URL (web YAML fallback): ${maestroWebUrl()}`);
if (strict) {
  console.log(
    "SAMPLE_REQUIRE_DEVICES / --strict: SKIP is a failure (Maestro/JRE missing is optional if the app already launched).",
  );
}
console.log("");

if (runNode("serve-demo.mjs", ["--background"]) !== 0) {
  console.error("Demo server failed to start (need 0.0.0.0:4173, not 127.0.0.1-only).");
  skipped.push({ id: "serve-demo", missing: ["demo-server"], blocked: "did not serve demo" });
  probeDevices({ ran, skipped });
  if (strict) printRequiredDevicesFailure(skipped);
  process.exit(1);
}
ran.push("serve-demo");

let iosUp = false;
let androidUp = false;

if (wantIos) {
  const ios = captureNode("boot-ios-sim.mjs", ["--no-probe"]);
  if (ios.status !== 0) {
    const simUp = /iOS Simulator (already online|ready|booted)/i.test(ios.text);
    const appFail = /WebView|webview-app|xcodebuild|Cannot build/i.test(ios.text);
    if (simUp) {
      iosUp = true;
      ran.push("ios-simulator");
    } else {
      console.error("iOS boot failed (simctl was found but boot did not finish).");
      skipped.push({ id: "ios-simulator", missing: ["boot-failed"], blocked: "did not boot Simulator" });
    }
    skipped.push({
      id: "ios-app",
      missing: appFail ? ["webview-app"] : ["boot-failed"],
      blocked: "did not install/launch WebView app",
    });
    failed = true;
  } else if (/^SKIP:/m.test(ios.text)) {
    recordSkipsFromBoot(ios.text, [{ id: "ios-simulator" }, { id: "ios-app" }]);
  } else {
    iosUp = true;
    ran.push("ios-simulator");
    if (/com\.example\.listings|WebView wrapper/i.test(ios.text)) {
      ran.push("ios-app");
    } else {
      skipped.push({
        id: "ios-app",
        missing: ["webview-app"],
        blocked: "did not install/launch WebView app",
      });
      failed = true;
    }
  }
}

if (wantAndroid) {
  const and = captureNode("boot-android-emu.mjs", ["--no-probe"]);
  if (and.status !== 0) {
    const emuUp = /Android emulator (already online|ready)/i.test(and.text);
    const apkFail = /WebView|webview-apk|Gradle|Cannot build|JDK/i.test(and.text);
    if (emuUp) {
      androidUp = true;
      ran.push("android-emulator");
    } else {
      console.error("Android boot failed (adb/emulator were found but boot did not finish).");
      skipped.push({ id: "android-emulator", missing: ["boot-failed"], blocked: "did not boot AVD" });
    }
    skipped.push({
      id: "android-app",
      missing: apkFail ? ["webview-apk"] : ["boot-failed"],
      blocked: "did not install/launch WebView APK",
    });
    failed = true;
  } else if (/^SKIP:/m.test(and.text)) {
    recordSkipsFromBoot(and.text, [{ id: "android-emulator" }, { id: "android-app" }]);
  } else {
    androidUp = true;
    ran.push("android-emulator");
    if (/com\.example\.listings|WebView wrapper/i.test(and.text)) {
      ran.push("android-app");
    } else {
      skipped.push({
        id: "android-app",
        missing: ["webview-apk"],
        blocked: "did not install/launch WebView APK",
      });
      failed = true;
    }
  }
}

const maestro = resolveMaestro();
const javaHome = resolveJavaHome();
const sdk = resolveAndroidSdk();
const maestroEnv = maestroCliEnv(process.env);
if (javaHome) maestroEnv.JAVA_HOME = javaHome;
if (sdk) {
  maestroEnv.ANDROID_HOME = sdk;
  maestroEnv.ANDROID_SDK_ROOT = sdk;
}

const jobs = [];
if (wantIos) {
  jobs.push({
    flow: ".maestro/ios/shell.yaml",
    platform: "ios",
    up: iosUp,
    resolve() {
      const sim = resolveBootedIosSimulator();
      if (!sim) return null;
      return {
        deviceId: sim.udid,
        label: `${sim.name} (${sim.udid})`,
      };
    },
    noDevice: {
      id: "ios-maestro-target",
      missing: ["booted-simulator"],
      blocked: "refused to run iOS YAML without a Simulator (would attach to Android)",
    },
  });
}
if (wantAndroid) {
  jobs.push({
    flow: ".maestro/android/shell.yaml",
    platform: "android",
    up: androidUp,
    resolve() {
      const emu = resolveOnlineAndroidEmulator();
      if (!emu) return null;
      return {
        deviceId: emu.serial,
        label: emu.serial,
      };
    },
    noDevice: {
      id: "android-maestro-target",
      missing: ["online-emulator"],
      blocked: "refused to run Android YAML without an online emulator",
    },
  });
}

if (!maestro) {
  skipped.push({ id: "maestro", missing: ["maestro"], blocked: "did not run Maestro YAML" });
  const up = (wantIos && iosUp) || (wantAndroid && androidUp);
  const later = jobs
    .map((j) => `maestro --platform ${j.platform} --device <${j.platform}-id> test ${j.flow}`)
    .join(" ; ");
  if (up) {
    console.log(
      "\nMaestro CLI not installed. The WebView app already launched — that is the device evidence.",
    );
    console.log("Maestro is optional here. A failed Maestro run (if you add it later) is not.");
  } else {
    console.log(
      "\nMaestro CLI not installed (optional). Simulator/emulator did not start, so there is no device evidence yet.",
    );
    console.log("Fix Xcode / Android Studio / AVD first. Chromium `npm test` is a separate viewport gate.");
  }
  console.log(`Optional later: ${later}`);
  console.log("Install: https://maestro.mobile.dev");
} else if (!javaHome) {
  skipped.push({
    id: "maestro",
    missing: ["java"],
    blocked: "did not run Maestro YAML (need JRE 17+)",
  });
  console.log("\nMaestro is on PATH but no usable JRE/JDK 17+ was found (macOS /usr/bin/java is a stub).");
  console.log(javaInstallHint());
  console.log("The Android WebView APK / iOS WebView app launch does not require Maestro.");
} else {
  for (const job of jobs) {
    if (!job.up) {
      console.log(
        `\nSkipping ${job.flow}: ${job.platform} runtime is not up (will not let Maestro pick another platform).`,
      );
      continue;
    }
    const target = job.resolve();
    if (!target) {
      console.error(
        `No ${job.platform} device id for ${job.flow}. Refusing to run without --device (Maestro would attach to the other platform).`,
      );
      skipped.push(job.noDevice);
      failed = true;
      continue;
    }
    const abs = join(ROOT, job.flow);
    if (!existsSync(abs)) {
      console.error(`Maestro YAML missing: ${job.flow} (looked at repo root: ${abs})`);
      skipped.push({ id: "maestro", missing: [job.flow], blocked: "YAML not in repo root" });
      failed = true;
      continue;
    }
    const args = maestroTestArgs({
      platform: job.platform,
      deviceId: target.deviceId,
      flow: job.flow,
    });
    console.log(`\nmaestro ${args.join(" ")}`);
    console.log(`Target: ${target.label}`);
    // Pipe, do not inherit a TTY: Maestro's live box reserves ~terminal-height
    // empty rows (the hole between "Target:" and "Running on …").
    const r = spawnSync(maestro, args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: maestroEnv,
    });
    if (r.error) console.error(r.error.message);
    process.stdout.write(compactMaestroLog(r.stdout || ""));
    process.stderr.write(compactMaestroLog(r.stderr || ""));
    if ((r.status ?? 1) !== 0) {
      console.error(
        `Maestro failed: ${job.flow} on ${target.label} (not a skip — targeting was ${job.platform}).`,
      );
      failed = true;
    } else if (!ran.includes("maestro")) {
      ran.push("maestro");
    }
  }
}

probeDevices({ ran, skipped });

if (failed) {
  const blocking = skipped.filter((s) => s.id !== "maestro");
  if (blocking.length) printRequiredDevicesFailure(blocking);
  process.exit(1);
}
if (strict) {
  const blocking = skipped.filter((s) => s.id !== "maestro");
  if (blocking.length) {
    printRequiredDevicesFailure(blocking);
    process.exit(1);
  }
  if (skipped.some((s) => s.id === "maestro") && !deviceEvidence()) {
    console.error(
      "SAMPLE_REQUIRE_DEVICES / --strict: no Simulator/emulator app evidence, and Maestro did not run.",
    );
    console.error("Chromium `npm test` is a separate viewport gate.");
    process.exit(1);
  }
} else if (skipped.length) {
  console.log(
    "\nSKIP is not a device pass. Re-run with SAMPLE_REQUIRE_DEVICES=1 or --strict to fail instead of exit 0.",
  );
  console.log("Chromium `npm test` is a separate viewport gate and may still pass.");
}
process.exit(0);
