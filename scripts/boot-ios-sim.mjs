#!/usr/bin/env node
// Boot an iPhone Simulator, then install and launch the thin Harbor Lease
// WKWebView app (com.example.listings). That wrapper loads the static demo at
// http://127.0.0.1:4173. This is not Safari and not an App Store / Capacitor
// binary. Serve the demo on 0.0.0.0.
// Skips (exit 0) when xcrun simctl is missing. Avast MITM does not block simctl.

import { execFileSync, spawnSync } from "node:child_process";
import { iosXcodeHint, probeDevices, resolveXcrun } from "./device-probe.mjs";
import { installAndLaunchWebView } from "./lib/ios-app.mjs";
import { listIosPhones, pickIosPhone } from "./lib/runtimes.mjs";
import { IOS_APP_ID, emitDeviceSkip, iosDemoUrl, skip } from "./lib/demo.mjs";

const NO_OPEN = process.argv.includes("--no-open");
const NO_PROBE = process.argv.includes("--no-probe");
const URL = iosDemoUrl();

function finish(status, ran, skipped) {
  if (!NO_PROBE) probeDevices({ ran, skipped });
  process.exit(status);
}

function simctl(xcrun, args, opts = {}) {
  return execFileSync(xcrun, ["simctl", ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  });
}

function alreadyBooted(stderr) {
  return /current state:\s*Booted/i.test(stderr) || /already booted/i.test(stderr);
}

function openWebViewApp(xcrun, udid) {
  return installAndLaunchWebView({ xcrun, udid, url: URL, open: !NO_OPEN });
}

function main() {
  const ran = [];
  const skipped = [];
  const xcrun = resolveXcrun();
  if (!xcrun) {
    skip(
      [
        "iOS Simulator — xcrun not found. Cannot boot a Simulator or install the WKWebView app.",
        iosXcodeHint(),
      ].join("\n      "),
      [
        { id: "ios-simulator", missing: ["xcrun", "simctl"] },
        { id: "ios-app", missing: ["xcrun", "simctl"] },
      ],
    );
    skipped.push({ id: "ios-simulator", missing: ["xcrun", "simctl"] });
    skipped.push({ id: "ios-app", missing: ["xcrun", "simctl"] });
    finish(0, ran, skipped);
  }
  const help = spawnSync(xcrun, ["simctl", "help"], { encoding: "utf8" });
  if (help.status !== 0) {
    const detail = (help.stderr || "").trim() || "simctl help failed";
    skip(
      [
        `iOS Simulator — xcrun is present but simctl is not usable (${detail}).`,
        iosXcodeHint(),
      ].join("\n      "),
      [
        { id: "ios-simulator", missing: ["simctl"] },
        { id: "ios-app", missing: ["simctl"] },
      ],
    );
    skipped.push({ id: "ios-simulator", missing: ["simctl"] });
    skipped.push({ id: "ios-app", missing: ["simctl"] });
    finish(0, ran, skipped);
  }

  let phones;
  try {
    phones = listIosPhones(xcrun);
  } catch (e) {
    console.error(e.message);
    emitDeviceSkip("ios-simulator", ["simctl-list"]);
    emitDeviceSkip("ios-app", ["simctl-list"]);
    skipped.push({ id: "ios-simulator", missing: ["simctl-list"], blocked: "did not boot Simulator" });
    skipped.push({ id: "ios-app", missing: ["simctl-list"], blocked: "did not install/launch WebView app" });
    finish(1, ran, skipped);
  }

  const phone = pickIosPhone(phones);
  if (!phone) {
    skip(
      [
        "iOS Simulator — no iPhone runtime is listed (looked for iPhone 16/15/14, then any iPhone).",
        "This script does not create a simulator.",
        "In Xcode: Window → Devices and Simulators → Simulators → +",
        "Or: xcodebuild -downloadPlatform iOS",
        "Then: npm run boot:ios",
        "Chromium `npm test` is a separate viewport gate and does not need a Simulator.",
      ].join("\n      "),
      [
        { id: "ios-simulator", missing: ["iphone-runtime"] },
        { id: "ios-app", missing: ["iphone-runtime"] },
      ],
    );
    skipped.push({ id: "ios-simulator", missing: ["iphone-runtime"], blocked: "did not boot Simulator" });
    skipped.push({ id: "ios-app", missing: ["iphone-runtime"], blocked: "did not install/launch WebView app" });
    finish(0, ran, skipped);
  }

  if (/booted/i.test(phone.state || "")) {
    console.log(`iOS Simulator already online (${phone.name}, ${phone.udid})`);
  } else {
    try {
      simctl(xcrun, ["boot", phone.udid], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = `${e.stderr || ""} ${e.message || ""}`;
      if (!alreadyBooted(err)) {
        console.error(`simctl boot failed for ${phone.name} (${phone.udid}): ${err.trim()}`);
        emitDeviceSkip("ios-simulator", ["boot-failed"]);
        emitDeviceSkip("ios-app", ["boot-failed"]);
        skipped.push({ id: "ios-simulator", missing: ["boot-failed"], blocked: "did not boot Simulator" });
        skipped.push({ id: "ios-app", missing: ["boot-failed"], blocked: "did not install/launch WebView app" });
        finish(1, ran, skipped);
      }
    }
  }

  spawnSync("open", ["-a", "Simulator"], { encoding: "utf8" });

  try {
    simctl(xcrun, ["bootstatus", phone.udid, "-b"], { timeout: 180_000 });
  } catch (e) {
    console.error(`simctl bootstatus timed out or failed for ${phone.udid}: ${e.stderr || e.message}`);
    emitDeviceSkip("ios-simulator", ["bootstatus"]);
    emitDeviceSkip("ios-app", ["bootstatus"]);
    skipped.push({ id: "ios-simulator", missing: ["bootstatus"], blocked: "did not boot Simulator" });
    skipped.push({ id: "ios-app", missing: ["bootstatus"], blocked: "did not install/launch WebView app" });
    finish(1, ran, skipped);
  }

  ran.push("ios-simulator");

  try {
    openWebViewApp(xcrun, phone.udid);
  } catch (e) {
    console.error(`Could not install/launch WebView app: ${e.message}`);
    emitDeviceSkip("ios-app", ["webview-app"]);
    skipped.push({
      id: "ios-app",
      missing: ["webview-app"],
      blocked: "did not install/launch WebView app",
    });
    finish(1, ran, skipped);
  }

  console.log("iOS Simulator ready");
  console.log(`  name: ${phone.name}`);
  console.log(`  udid: ${phone.udid}`);
  console.log(`  url:  ${URL}`);
  console.log(`  app:  ${IOS_APP_ID} (WebView wrapper — static HTML demo, not App Store)`);
  ran.push("ios-app");
  finish(0, ran, skipped);
}

main();
