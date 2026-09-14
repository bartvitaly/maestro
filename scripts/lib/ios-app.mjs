// Build / install / launch the thin Harbor Lease WKWebView app.
// Not a Capacitor or App Store binary. Loads the static demo at 127.0.0.1.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { firstExisting, which } from "../device-probe.mjs";
import { IOS_APP_ID, iosDemoUrl, waitSync } from "./demo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const IOS_PROJECT_DIR = join(ROOT, "ios");
export const IOS_XCODEPROJ = join(IOS_PROJECT_DIR, "HarborLease.xcodeproj");
export const IOS_DERIVED = join(IOS_PROJECT_DIR, "DerivedData");
export const IOS_SCHEME = "HarborLease";

export function resolveXcodebuild() {
  return which("xcodebuild") || firstExisting(["/usr/bin/xcodebuild"]);
}

export function findSimulatorApp(derivedData = IOS_DERIVED) {
  const dir = join(derivedData, "Build", "Products", "Debug-iphonesimulator");
  if (!existsSync(dir)) return null;
  const preferred = join(dir, "HarborLease.app");
  if (existsSync(preferred)) return preferred;
  const names = readdirSync(dir).filter((n) => n.endsWith(".app"));
  if (!names.length) return null;
  names.sort((a, b) => {
    const pa = join(dir, a);
    const pb = join(dir, b);
    return statSync(pb).mtimeMs - statSync(pa).mtimeMs;
  });
  return join(dir, names[0]);
}

function xcodeInstallHint() {
  return [
    "Cannot build WebView app — xcodebuild not found.",
    "Install Xcode (not only Command Line Tools) and select it:",
    "  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
  ].join("\n");
}

export function buildWebViewApp({ force = false } = {}) {
  const existing = findSimulatorApp();
  if (existing && !force && process.env.SAMPLE_IOS_REBUILD !== "1") {
    console.log(`Using existing WebView app: ${existing}`);
    return existing;
  }

  if (!existsSync(IOS_XCODEPROJ)) {
    throw new Error(`Cannot build WebView app — missing Xcode project at ${IOS_XCODEPROJ}`);
  }

  const xcodebuild = resolveXcodebuild();
  if (!xcodebuild) {
    throw new Error(xcodeInstallHint());
  }

  console.log(`Building WebView app with ${xcodebuild}`);
  console.log(`  project: ${IOS_XCODEPROJ}`);
  console.log(`  scheme:  ${IOS_SCHEME}`);
  console.log(`  derived: ${IOS_DERIVED}`);

  const r = spawnSync(
    xcodebuild,
    [
      "-project",
      IOS_XCODEPROJ,
      "-scheme",
      IOS_SCHEME,
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      IOS_DERIVED,
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=-",
      "COMPILER_INDEX_STORE_ENABLE=NO",
      "build",
    ],
    {
      cwd: IOS_PROJECT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if ((r.status ?? 1) !== 0) {
    throw new Error(`xcodebuild failed (${r.status})`);
  }
  const app = findSimulatorApp();
  if (!app) {
    throw new Error(
      "xcodebuild finished but no Simulator .app was found under ios/DerivedData/Build/Products/Debug-iphonesimulator",
    );
  }
  return app;
}

export function installWebViewApp(xcrun, udid, app) {
  const r = spawnSync(xcrun, ["simctl", "install", udid, app], { encoding: "utf8" });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  if ((r.status ?? 1) !== 0) {
    throw new Error((text || "simctl install failed").trim());
  }
}

export function launchWebViewApp(xcrun, udid, url = iosDemoUrl()) {
  spawnSync(xcrun, ["simctl", "terminate", udid, IOS_APP_ID], { encoding: "utf8" });
  const r = spawnSync(xcrun, ["simctl", "launch", udid, IOS_APP_ID, "-url", url], {
    encoding: "utf8",
  });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  if ((r.status ?? 1) !== 0) {
    throw new Error((text || "simctl launch failed").trim());
  }
}

export function packageInstalled(xcrun, udid, appId = IOS_APP_ID) {
  try {
    const out = execFileSync(xcrun, ["simctl", "get_app_container", udid, appId], {
      encoding: "utf8",
    });
    return Boolean(out && out.trim());
  } catch {
    return false;
  }
}

/**
 * Build if needed, install, and launch the WebView app. Never opens Safari.
 * @returns {{ app: string, appId: string, url: string }}
 */
export function installAndLaunchWebView({ xcrun, udid, url = iosDemoUrl(), open = true } = {}) {
  if (!xcrun) throw new Error("xcrun not found");
  if (!udid) throw new Error("no Simulator UDID");

  const app = buildWebViewApp();
  installWebViewApp(xcrun, udid, app);
  waitSync(1000);
  if (!packageInstalled(xcrun, udid)) {
    throw new Error(`simctl install reported success but ${IOS_APP_ID} is not installed`);
  }
  if (open) {
    let launched = false;
    let lastErr = "";
    for (let i = 0; i < 5 && !launched; i++) {
      try {
        launchWebViewApp(xcrun, udid, url);
        launched = true;
      } catch (e) {
        lastErr = e.message || String(e);
        if (i === 4) throw new Error(`Could not launch WebView app: ${lastErr}`);
        waitSync(2000);
      }
    }
  }
  return { app, appId: IOS_APP_ID, url };
}
