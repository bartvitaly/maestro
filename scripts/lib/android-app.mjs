// Build / install / launch the thin Harbor Lease WebView APK.
// Not a Capacitor or Play Store binary. Loads the static demo at 10.0.2.2.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  javaInstallHint,
  resolveAdb,
  resolveAndroidSdk,
  resolveJavaHome,
  which,
} from "../device-probe.mjs";
import { ANDROID_ACTIVITY, ANDROID_APP_ID, androidDemoUrl, waitSync } from "./demo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ANDROID_PROJECT = join(ROOT, "android");

export function findDebugApk(projectDir = ANDROID_PROJECT) {
  const dir = join(projectDir, "build", "outputs", "apk", "debug");
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => n.endsWith(".apk") && !n.endsWith(".apk.idsig"));
  if (!names.length) return null;
  names.sort((a, b) => {
    const pa = join(dir, a);
    const pb = join(dir, b);
    return statSync(pb).mtimeMs - statSync(pa).mtimeMs;
  });
  return join(dir, names[0]);
}

function walkForGradle(root, depth = 0) {
  if (!root || !existsSync(root) || depth > 6) return null;
  const bin = join(root, "bin", "gradle");
  if (existsSync(bin)) return bin;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = walkForGradle(join(root, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

export function resolveGradle(projectDir = ANDROID_PROJECT) {
  const wrapper = join(projectDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (existsSync(wrapper)) return wrapper;
  const fromPath = which("gradle");
  if (fromPath) return fromPath;
  const dists = join(process.env.HOME || homedir(), ".gradle", "wrapper", "dists");
  return walkForGradle(dists);
}

function toolEnv() {
  const javaHome = resolveJavaHome();
  const sdk = resolveAndroidSdk();
  const env = { ...process.env };
  if (javaHome) env.JAVA_HOME = javaHome;
  if (sdk) {
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
  }
  return { env, javaHome, sdk };
}

function writeLocalProperties(projectDir, sdk) {
  const escaped = sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  writeFileSync(join(projectDir, "local.properties"), `sdk.dir=${escaped}\n`, "utf8");
}

export function buildWebViewApk({ force = false } = {}) {
  const existing = findDebugApk();
  if (existing && !force && process.env.SAMPLE_ANDROID_REBUILD !== "1") {
    console.log(`Using existing WebView APK: ${existing}`);
    return existing;
  }

  const { env, javaHome, sdk } = toolEnv();
  if (!javaHome) {
    throw new Error(`Cannot build WebView APK — no JDK.\n${javaInstallHint()}`);
  }
  if (!sdk) {
    throw new Error(
      "Cannot build WebView APK — Android SDK not found. Set ANDROID_HOME or install Android Studio.",
    );
  }
  const gradle = resolveGradle();
  if (!gradle) {
    throw new Error(
      "Cannot build WebView APK — Gradle not found. Install a JDK and run the Android Gradle wrapper, or place Gradle on PATH.",
    );
  }

  writeLocalProperties(ANDROID_PROJECT, sdk);
  console.log(`Building WebView APK with ${gradle}`);
  console.log(`  JAVA_HOME=${javaHome}`);
  console.log(`  ANDROID_HOME=${sdk}`);

  const r = spawnSync(gradle, ["assembleDebug", "--warning-mode", "none"], {
    cwd: ANDROID_PROJECT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if ((r.status ?? 1) !== 0) {
    throw new Error(`Gradle assembleDebug failed (${r.status})`);
  }
  const apk = findDebugApk();
  if (!apk) throw new Error("Gradle finished but no debug APK was found under android/build/outputs/apk/debug");
  return apk;
}

function adbOut(adb, args) {
  return execFileSync(adb, args, { encoding: "utf8" });
}

export function installWebViewApk(adb, serial, apk) {
  const r = spawnSync(adb, ["-s", serial, "install", "-r", "-t", apk], { encoding: "utf8" });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  if ((r.status ?? 1) !== 0 && !/Success/i.test(text)) {
    throw new Error((text || "adb install failed").trim());
  }
}

export function launchWebViewApk(adb, serial, url = androidDemoUrl()) {
  const r = spawnSync(
    adb,
    [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-n",
      `${ANDROID_APP_ID}/${ANDROID_ACTIVITY}`,
      "--es",
      "url",
      url,
    ],
    { encoding: "utf8" },
  );
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  if ((r.status ?? 1) !== 0 || /Error/i.test(text)) {
    throw new Error((text || "am start failed").trim());
  }
}

export function packageInstalled(adb, serial, appId = ANDROID_APP_ID) {
  try {
    const out = adbOut(adb, ["-s", serial, "shell", "pm", "path", appId]);
    return /package:/i.test(out);
  } catch {
    return false;
  }
}

/**
 * Build if needed, install, and launch the WebView app. Never opens Chrome.
 * @returns {{ apk: string, appId: string, url: string }}
 */
export function installAndLaunchWebView({ adb, serial, url = androidDemoUrl(), open = true } = {}) {
  if (!adb) adb = resolveAdb();
  if (!adb) throw new Error("adb not found");
  if (!serial) throw new Error("no emulator serial");

  const apk = buildWebViewApk();
  installWebViewApk(adb, serial, apk);
  waitSync(1000);
  if (!packageInstalled(adb, serial)) {
    throw new Error(`adb install reported success but ${ANDROID_APP_ID} is not installed`);
  }
  if (open) {
    let launched = false;
    let lastErr = "";
    for (let i = 0; i < 5 && !launched; i++) {
      try {
        launchWebViewApk(adb, serial, url);
        launched = true;
      } catch (e) {
        lastErr = e.message || String(e);
        if (i === 4) throw new Error(`Could not launch WebView app: ${lastErr}`);
        waitSync(2000);
      }
    }
  }
  return { apk, appId: ANDROID_APP_ID, url };
}
