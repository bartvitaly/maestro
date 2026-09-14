#!/usr/bin/env node
// Playwright browser install that survives a corporate / Avast HTTPS MITM on macOS.
// Symptom: SELF_SIGNED_CERT_IN_CHAIN or UNABLE_TO_GET_ISSUER_CERT_LOCALLY while
// downloading WebKit. Node does not use the System keychain; dump SystemRoot +
// System into a PEM and set NODE_EXTRA_CA_CERTS before `playwright install`.
// Same recipe as Step Swap docs/AGENT_MAC_PLAYWRIGHT.md (both keychains — SystemRoot
// alone misses the Avast / MITM root).

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const want = process.argv.slice(2);
const browsers = want.length ? want : ["chromium", "chromium-headless-shell", "webkit"];

const KEYCHAINS = [
  "/System/Library/Keychains/SystemRootCertificates.keychain",
  "/Library/Keychains/System.keychain",
];

function dumpMacosCaBundle() {
  const dir = join(root, "node_modules", ".cache", "maestro-sample");
  mkdirSync(dir, { recursive: true });
  const pem = join(dir, "macos-root-ca-full.pem");
  const security = existsSync("/usr/bin/security") ? "/usr/bin/security" : "security";
  const parts = [];

  for (const keychain of KEYCHAINS) {
    try {
      const out = execFileSync(security, ["find-certificate", "-a", "-p", keychain], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      if (out.trim()) parts.push(out.trimEnd());
    } catch (e) {
      console.warn(
        `Could not dump ${keychain}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (!parts.length) {
    console.warn(
      "No macOS keychain PEMs dumped. Playwright install may fail with SELF_SIGNED_CERT_IN_CHAIN.",
    );
    return null;
  }

  writeFileSync(pem, `${parts.join("\n")}\n`, "utf8");
  return pem;
}

if (process.platform === "darwin") {
  const pem = process.env.NODE_EXTRA_CA_CERTS || dumpMacosCaBundle();
  if (pem) {
    process.env.NODE_EXTRA_CA_CERTS = pem;
    console.log(`Using extra CAs: ${pem}`);
  }
}

function resolvePlaywrightCli() {
  const require = createRequire(import.meta.url);
  for (const spec of ["playwright/cli.js", "@playwright/test/cli.js"]) {
    try {
      return require.resolve(spec);
    } catch {
      // try next
    }
  }
  return null;
}

const cli = resolvePlaywrightCli();
if (!cli) {
  console.error("Playwright CLI not found. From the sample root run: npm install");
  process.exit(1);
}

let exitCode = 0;
for (const browser of browsers) {
  console.log(`Installing ${browser}…`);
  const result = spawnSync(process.execPath, [cli, "install", browser], {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
  if (result.error) {
    console.error(result.error.message);
    exitCode = 1;
    continue;
  }
  if (result.status) {
    console.error(`Failed to install ${browser} (exit ${result.status}).`);
    if (browser === "webkit") {
      console.error(
        "Chromium is enough for local `npm test` (iPhone 14 viewport). Retry WebKit after the CA dump, or leave WebKit to CI (`PLAYWRIGHT_IOS_WEBKIT=1`).",
      );
    }
    exitCode = result.status;
  }
}

process.exit(exitCode);
