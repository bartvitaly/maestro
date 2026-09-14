#!/usr/bin/env node
// Shared device-tool probe for iOS Simulator / Android emulator / Maestro lanes.
// Prints a boxed report to stderr and writes artifacts/device-probe.log.
// Always includes === skipped (why) === : missing tool(s) → concrete action
// (boot Simulator, install iOS WebView app, boot AVD, install WebView APK, run Maestro YAML,
// serve demo), or none. java is resolved from Android Studio JBR / Homebrew, not
// only PATH (macOS /usr/bin/java is often a stub).
// Missing tools never fail the process unless --strict is passed
// or SAMPLE_REQUIRE_DEVICES=1. Then only required device tools fail the
// probe (xcrun, simctl, adb, emulator). Maestro / Java / python3 missing
// is reported but is not a probe failure.
// SAMPLE_HIDE_TOOLS=ios,android,maestro,java (or xcrun,simctl,adb,emulator)
// pretends those resolvers found nothing — for logs / CI, not for uninstalling.

import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS_DIR = join(ROOT, "artifacts");
const LOG_PATH = join(ARTIFACTS_DIR, "device-probe.log");

const TOOL_NAMES = ["xcrun", "simctl", "adb", "emulator", "java", "maestro", "python3"];

/** Probe `--strict` / SAMPLE_REQUIRE_DEVICES=1 fails only on these (not Maestro/JRE). */
export const REQUIRED_DEVICE_TOOLS = ["xcrun", "simctl", "adb", "emulator"];

const LANES = [
  { id: "ios-simulator", tools: ["xcrun", "simctl"], blocked: "did not boot Simulator" },
  { id: "ios-app", tools: ["xcrun", "simctl"], blocked: "did not install/launch WebView app" },
  { id: "android-emulator", tools: ["adb", "emulator"], blocked: "did not boot AVD" },
  { id: "android-app", tools: ["adb"], blocked: "did not install/launch WebView APK" },
  { id: "maestro", tools: ["maestro", "java"], blocked: "did not run Maestro YAML" },
  { id: "python3", tools: ["python3"], blocked: "did not serve demo" },
];

const LANE_BY_ID = new Map(LANES.map((lane) => [lane.id, lane]));

function enrichSkipped(lane, present) {
  const raw = typeof lane === "string" ? { id: lane } : { ...lane };
  const def = LANE_BY_ID.get(raw.id);
  const missing = Array.isArray(raw.missing)
    ? raw.missing
    : def
      ? def.tools.filter((tool) => !present.has(tool))
      : [];
  return {
    id: raw.id,
    missing,
    blocked: raw.blocked || def?.blocked,
  };
}

/** Comma list: ios, android, maestro, java, or concrete names (xcrun, adb, …). */
export function hiddenTools() {
  const raw = process.env.SAMPLE_HIDE_TOOLS || "";
  const set = new Set();
  for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (token === "ios") {
      set.add("xcrun");
      set.add("simctl");
      continue;
    }
    if (token === "android") {
      set.add("adb");
      set.add("emulator");
      continue;
    }
    set.add(token);
  }
  return set;
}

export function isToolHidden(name) {
  return hiddenTools().has(name);
}

export function findOnPath(bin) {
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export function which(bin) {
  const fromPath = findOnPath(bin);
  if (fromPath) return fromPath;
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  if (r.status === 0 && out) return out.split("\n")[0];
  return null;
}

export function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export function androidSdkRoots() {
  const home = process.env.HOME || homedir();
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_SDK,
    home && join(home, "Library/Android/sdk"),
    home && join(home, "Android/Sdk"),
    home && join(home, ".android/sdk"),
  ].filter(Boolean);
}

export function resolveXcrun() {
  if (isToolHidden("xcrun")) return null;
  return which("xcrun") || firstExisting(["/usr/bin/xcrun"]);
}

export function resolveSimctl(xcrunPath) {
  if (isToolHidden("simctl")) return null;
  if (!xcrunPath) return null;
  const found = spawnSync(xcrunPath, ["--find", "simctl"], { encoding: "utf8" });
  const foundPath = (found.stdout || "").trim();
  if (found.status === 0 && foundPath) return `${xcrunPath} simctl → ${foundPath}`;
  const help = spawnSync(xcrunPath, ["simctl", "help"], { encoding: "utf8" });
  if (help.status === 0) return `${xcrunPath} simctl`;
  return null;
}

export function resolveAdb() {
  if (isToolHidden("adb")) return null;
  return (
    which("adb") ||
    firstExisting(androidSdkRoots().map((root) => join(root, "platform-tools", "adb")))
  );
}

export function resolveEmulator() {
  if (isToolHidden("emulator")) return null;
  return (
    which("emulator") ||
    firstExisting(androidSdkRoots().map((root) => join(root, "emulator", "emulator")))
  );
}

export function resolveMaestro() {
  if (isToolHidden("maestro")) return null;
  return which("maestro") || firstExisting([join(process.env.HOME || "", ".maestro", "bin", "maestro")]);
}

function javaWorks(bin) {
  if (!bin) return false;
  try {
    accessSync(bin, constants.X_OK);
  } catch {
    return false;
  }
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  const text = `${r.stderr || ""}${r.stdout || ""}`;
  if (/Unable to locate a Java Runtime/i.test(text)) return false;
  return r.status === 0;
}

/**
 * JDK home (directory that contains bin/java). Prefer Android Studio JBR —
 * Homebrew OpenJDK 26 is often too new for AGP, and /usr/bin/java is a macOS stub.
 */
export function resolveJavaHome() {
  if (isToolHidden("java")) return null;
  const envHome = process.env.JAVA_HOME;
  if (envHome && javaWorks(join(envHome, "bin", "java"))) return envHome;

  const home = process.env.HOME || homedir();
  const candidates = [
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    join(home, "Applications/Android Studio.app/Contents/jbr/Contents/Home"),
    "/Applications/Android Studio.app/Contents/jre/Contents/Home",
    "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home",
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
    join(home, "homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"),
    join(home, "homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"),
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
    join(home, "homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"),
    "/opt/homebrew/opt/openjdk",
    join(home, "homebrew/opt/openjdk"),
  ];
  for (const dir of candidates) {
    if (javaWorks(join(dir, "bin", "java"))) return dir;
  }

  const fromPath = which("java");
  if (fromPath && javaWorks(fromPath)) {
    const homeGuess = resolve(fromPath, "..", "..");
    if (javaWorks(join(homeGuess, "bin", "java"))) return homeGuess;
  }
  return null;
}

export function resolveJava() {
  const home = resolveJavaHome();
  return home ? join(home, "bin", "java") : null;
}

export function resolveAndroidSdk() {
  for (const root of androidSdkRoots()) {
    try {
      accessSync(join(root, "platform-tools"), constants.R_OK);
      return root;
    } catch {
      // try next
    }
  }
  return null;
}

export function javaInstallHint() {
  return [
    "Maestro and the Android WebView APK build need a JRE/JDK 17+.",
    "/usr/bin/java on macOS is a stub unless a JDK is installed.",
    "This machine can use Android Studio's bundled JBR (the device scripts look there), or:",
    "  brew install openjdk@21",
    "  export JAVA_HOME=\"$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home\"",
  ].join("\n");
}

/** Indented continuation under a SKIP: line. */
export function iosXcodeHint() {
  return [
    "Need full Xcode (Command Line Tools alone cannot boot a Simulator).",
    "Install Xcode, then:",
    "  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
    "If no iPhone runtime: Xcode → Window → Devices and Simulators → +",
    "  or: xcodebuild -downloadPlatform iOS",
    "Chromium `npm test` (Pixel 7 / iPhone 14 viewports) is a separate gate and does not need Xcode.",
  ].join("\n      ");
}

export function androidSdkHint() {
  return [
    "Need Android Studio SDK: platform-tools (adb) + emulator, then at least one AVD.",
    "  export ANDROID_HOME=\"$HOME/Library/Android/sdk\"",
    "  export PATH=\"$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH\"",
    "Create an AVD: Android Studio → Device Manager → Create Device (Pixel 7, API 34).",
    "This script does not create AVDs.",
    "Chromium `npm test` is a separate viewport gate and does not need an emulator.",
  ].join("\n      ");
}

export function avdCreateHint() {
  return [
    "No Android Virtual Device found. This script does not create AVDs.",
    "In Android Studio: Device Manager → Create Device (Pixel 7, API 34 is fine).",
    "Or CLI: sdkmanager \"system-images;android-34;google_apis;x86_64\"",
    "        avdmanager create avd -n Pixel_7_API_34 -k \"system-images;android-34;google_apis;x86_64\"",
    "Then: npm run boot:android",
    "Chromium `npm test` is a separate viewport gate and does not need an AVD.",
  ].join("\n      ");
}

/** One-line fix for a skipped lane's missing tokens. */
export function nextStepForMissing(missing = []) {
  const tokens = new Set((missing || []).map((m) => String(m)));
  if (tokens.has("xcrun") || tokens.has("simctl") || tokens.has("xcodebuild")) {
    return "Install full Xcode (not only CLT), then: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer";
  }
  if (tokens.has("iphone-runtime") || tokens.has("iPhone runtime") || tokens.has("simctl-list")) {
    return "Xcode → Devices and Simulators → +  (or: xcodebuild -downloadPlatform iOS)";
  }
  if (tokens.has("AVD")) {
    return "Android Studio → Device Manager → Create Device (Pixel 7, API 34)";
  }
  if (tokens.has("adb") || tokens.has("emulator")) {
    return "Install Android Studio SDK platform-tools + emulator; export ANDROID_HOME=$HOME/Library/Android/sdk";
  }
  if (tokens.has("webview-apk") || tokens.has("gradle")) {
    return "Need JDK 17+ (Android Studio JBR is fine) and ANDROID_HOME to build the WebView APK";
  }
  if (tokens.has("java")) {
    return "Need JRE/JDK 17+ (Android Studio JBR or: brew install openjdk@21). Maestro is optional if the app already launched.";
  }
  if (tokens.has("webview-app")) {
    return "Need xcodebuild (full Xcode) to build ios/ HarborLease for the Simulator";
  }
  if (tokens.has("boot-failed") || tokens.has("bootstatus")) {
    return "Runtime was selected but boot did not finish — check artifacts/emulator.log or `xcrun simctl bootstatus`";
  }
  if (tokens.has("maestro")) {
    return "Optional: https://maestro.mobile.dev — not required if the WebView app already launched";
  }
  if (tokens.has("demo-server") || tokens.has("loopback-bind")) {
    return "Port 4173 must bind 0.0.0.0 (`npm run serve:demo`), not 127.0.0.1-only (`npm start`)";
  }
  return "";
}

export function resolvePython3() {
  if (isToolHidden("python3")) return null;
  return which("python3") || firstExisting(["/usr/bin/python3", "/usr/local/bin/python3"]);
}

/** Fail on missing tools / SKIP. Same as `probe:devices --strict`. */
export function requireDevices(argv = process.argv) {
  return argv.includes("--strict") || process.env.SAMPLE_REQUIRE_DEVICES === "1";
}

function resolveTool(name, xcrunPath) {
  switch (name) {
    case "xcrun":
      return resolveXcrun();
    case "simctl":
      return resolveSimctl(xcrunPath);
    case "adb":
      return resolveAdb();
    case "emulator":
      return resolveEmulator();
    case "maestro":
      return resolveMaestro();
    case "java":
      return resolveJava();
    case "python3":
      return resolvePython3();
    default:
      return which(name);
  }
}

function pad(label, width) {
  return label.length >= width ? label : `${label}${" ".repeat(width - label.length)}`;
}

function formatReport(result) {
  const lines = [
    "============================================================",
    "=== device probe ===",
    "============================================================",
    `when: ${result.when}`,
    "tools found:",
  ];

  if (result.found.length === 0) {
    lines.push("  (none)");
  } else {
    for (const tool of result.found) {
      lines.push(`  ${pad(tool.name, 12)} FOUND     ${tool.path}`);
    }
  }

  lines.push("tools missing:");
  if (result.missing.length === 0) {
    lines.push("  (none)");
  } else {
    for (const tool of result.missing) {
      lines.push(`  ${pad(tool.name, 12)} NOT FOUND`);
    }
  }

  lines.push("lanes ran:");
  if (result.ran.length === 0) {
    lines.push("  (none)");
  } else {
    for (const lane of result.ran) {
      lines.push(`  ${lane.id}`);
    }
  }

  lines.push("lanes skipped:");
  if (result.skipped.length === 0) {
    lines.push("  (none)");
  } else {
    for (const lane of result.skipped) {
      const why = lane.missing?.length ? `  missing: ${lane.missing.join(", ")}` : "";
      lines.push(`  ${pad(lane.id, 20)}${why}`);
    }
  }

  lines.push("=== skipped (why) ===");
  if (result.skipped.length === 0) {
    lines.push("none");
  } else {
    for (const lane of result.skipped) {
      const missing = lane.missing?.length ? lane.missing.join(", ") : "runtime (see SKIP: above)";
      const action = lane.blocked || lane.id;
      lines.push(`missing ${missing} → ${action}`);
      const next = nextStepForMissing(lane.missing || []);
      if (next) lines.push(`  next: ${next}`);
    }
  }

  lines.push("============================================================");
  lines.push(`log: ${result.logPath}`);
  lines.push("============================================================");
  return `${lines.join("\n")}\n`;
}

/**
 * Probe device tooling and print the standard device-run section.
 * @param {{ ran?: string[], skipped?: Array<string|{id:string,missing?:string[],blocked?:string}> }} [options]
 * @returns {{ found: object[], missing: object[], ran: object[], skipped: object[], report: string, logPath: string, when: string }}
 */
export function probeDevices(options = {}) {
  const when = new Date().toISOString();
  const xcrunPath = resolveXcrun();
  const tools = TOOL_NAMES.map((name) => {
    const path = resolveTool(name, xcrunPath);
    return path ? { name, found: true, path } : { name, found: false, path: null };
  });

  const found = tools.filter((t) => t.found);
  const missing = tools.filter((t) => !t.found);
  const present = new Set(found.map((t) => t.name));

  let ran;
  let skipped;
  if (options.ran || options.skipped) {
    ran = (options.ran || []).map((id) => (typeof id === "string" ? { id } : id));
    skipped = (options.skipped || []).map((lane) => enrichSkipped(lane, present));
  } else {
    ran = [];
    skipped = [];
    for (const lane of LANES) {
      const laneMissing = lane.tools.filter((tool) => !present.has(tool));
      if (laneMissing.length) skipped.push(enrichSkipped({ id: lane.id, missing: laneMissing }, present));
      else ran.push({ id: lane.id });
    }
  }

  const result = {
    when,
    found,
    missing,
    ran,
    skipped,
    logPath: LOG_PATH,
  };
  result.report = formatReport(result);

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(LOG_PATH, result.report, "utf8");
  process.stderr.write(result.report);

  return result;
}

function invokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (invokedAsCli()) {
  const result = probeDevices();
  if (!requireDevices()) process.exit(0);
  const blocking = result.missing.filter((t) => REQUIRED_DEVICE_TOOLS.includes(t.name));
  process.exit(blocking.length ? 1 : 0);
}
