# Device runtimes (iOS Simulator + Android emulator)

Harbor Lease is this repo: a **static HTML app** (`index.html`). “The app” on Android is a **thin WebView wrapper** (`android/`, `applicationId` `com.example.listings`) that loads `http://10.0.2.2:4173`. “The app” on iOS is a **thin WKWebView wrapper** (`ios/`, bundle id `com.example.listings`) that loads `http://127.0.0.1:4173`. Those are **not** Chrome / Safari, **not** store listings, and **not** Capacitor production binaries.

`npm test` is the **automated** gate: Playwright **Pixel 7 + iPhone 14 viewports** in Chromium (`test:android` / `test:ios` are those aliases — **not** emulators). The required handout path is Chromium **plus** a real Android emulator **plus** iOS Simulator (`npm run test:all`, with `SAMPLE_REQUIRE_DEVICES=1` on the device lane). There is no Appium.

## How this differs from Playwright viewports

| Lane | What actually runs |
|---|---|
| `npm test` / `test:android` / `test:ios` | Desktop Chromium, resized (Pixel 7 / iPhone 14). Not Safari. Not an emulator. |
| `npm run test:ios:webkit` | Optional Playwright WebKit. **Do not set `PLAYWRIGHT_IOS_WEBKIT=1` for device work.** Avast MITM often blocks the WebKit download (`SELF_SIGNED_CERT_IN_CHAIN`). Chromium Playwright is enough for the viewport gate. |
| `npm run boot:ios` | Real iOS Simulator + **install/launch** the WKWebView app (`com.example.listings`) pointing at `http://127.0.0.1:4173`. Avast does **not** block `xcrun simctl`. Does **not** open Safari. |
| `npm run boot:android` | Real Android emulator + **install/launch** the WebView APK (`com.example.listings`) pointing at `http://10.0.2.2:4173`. Does **not** open Chrome. |
| `npm run test:all` | `npm test` then `test:device`. Prefix `SAMPLE_REQUIRE_DEVICES=1` so SKIP is a failure (Maestro/JRE missing is optional if the app already launched). |
| `npm run test:device*` | Serve demo on `0.0.0.0:4173` → boot Simulator / AVD → WKWebView app on iOS, WebView APK on Android → `maestro test --platform` + `--device` if `maestro` **and** a JRE 17+ are available. |

Maestro `url:` (`.maestro/ios/shell-web.yaml`, `.maestro/android/shell-web.yaml`) launches **host Chromium** against `http://127.0.0.1:4173`. That is not the installed Simulator / emulator app. The device-lane Maestro flows are [`.maestro/android/shell.yaml`](.maestro/android/shell.yaml) and [`.maestro/ios/shell.yaml`](.maestro/ios/shell.yaml) (`appId` + `launchApp`). On older AVDs (API 24 / `pixel_24`) Chrome DevTools often cannot snapshot the WebView DOM; the Android flow then uses accessible names. Install/launch of the wrapper is the “app opened on device” evidence either way.

## Bind address

| Client | URL |
|---|---|
| Playwright / Maestro `url:` / iOS WKWebView app | `http://127.0.0.1:4173` |
| Android WebView APK (inside the AVD) | `http://10.0.2.2:4173` (host loopback from inside the emulator) |

`npm start` binds **127.0.0.1** (Playwright). Device lanes use `npm run serve:demo` → `0.0.0.0:4173` so `10.0.2.2` works. Same as `python3 -m http.server 4173 --bind 0.0.0.0`. Under `--strict` / `SAMPLE_REQUIRE_DEVICES=1`, a leftover **127.0.0.1-only** listener on 4173 is a device-lane failure.

## Skip behavior

Missing `xcrun simctl`, `xcodebuild`, `adb`/`emulator`, an AVD, a Simulator iPhone, a JDK for the APK build, or `maestro` → that piece prints `SKIP:` or fails the app-build step. **SKIP is not a pass.**

- **Required / handout:** `SAMPLE_REQUIRE_DEVICES=1 npm run test:device` (or `node scripts/test-device.mjs --strict`). Then SKIP **exits non-zero** for missing device tools (`xcrun`, `simctl`, `adb`, `emulator`), no AVD / iPhone runtime, a failed WebView install/launch, or a **127.0.0.1-only** demo bind. A **missing** Maestro CLI / JRE is **not** a failure when the iOS or Android WebView app already launched. A Maestro flow that **runs and fails** is a failure, not a skip. `npm run probe:devices -- --strict` (also honors `SAMPLE_REQUIRE_DEVICES=1`) fails only on those required device tools — not on a missing Maestro CLI or JRE.
- **Default without the env var:** SKIP still **exits 0** so Linux boxes without Xcode / Android SDK can run the server. That is **not** a device pass — the script says so.

No AVD listed → skip with create-in-Android-Studio instructions; the script will **not** create an AVD. No iPhone 14/15/16 listed → any other iPhone is used; if none exist, skip (no hard-coded UDID).

**Java / Maestro:** `maestro` on PATH is not enough. The Homebrew/Gradle launcher needs a real JRE 17+. macOS `/usr/bin/java` is often a stub (“Unable to locate a Java Runtime”). Probe resolves Java from Android Studio’s bundled JBR or Homebrew OpenJDK and sets `JAVA_HOME` when running Maestro or Gradle. If no JRE is found, Maestro is skipped with install instructions — it is **not** reported as a missing `shell-web.yaml`. The Android APK build uses the same JDK.

```bash
brew install openjdk@21
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
```

Or install Android Studio (the device scripts look at `Android Studio.app/Contents/jbr`).

## Commands (repo root)

```bash
npm install
npx playwright install chromium
npm run probe:devices
unset PLAYWRIGHT_IOS_WEBKIT
SAMPLE_REQUIRE_DEVICES=1 npm run test:all
```

or equivalently:

```bash
npm test
SAMPLE_REQUIRE_DEVICES=1 npm run test:device
```

```bash
# Viewport aliases (Chromium). Not an emulator / Simulator.
npm run test:android
npm run test:ios

# Device lane pieces
npm run test:device
npm run test:device:ios
npm run test:device:android
SAMPLE_REQUIRE_DEVICES=1 npm run test:device
```

Pieces:

```bash
npm run serve:demo          # 0.0.0.0:4173 (leave running)
npm run boot:ios            # prints UDID; builds/installs/launches com.example.listings
npm run boot:android        # prints serial; builds/installs/launches com.example.listings

# If Maestro + a JRE 17+ are available. Always pass --platform and --device
# so iOS YAML cannot attach to the Android AVD (both use com.example.listings).
# Resolve ids dynamically — do not hard-code a Simulator UDID:
#   xcrun simctl list devices booted
#   adb devices
maestro --platform android --device emulator-5554 test .maestro/android/shell.yaml
maestro --platform ios --device "$IOS_UDID" test .maestro/ios/shell.yaml
```

`scripts/test-device.mjs` resolves the booted Simulator UDID and the online emulator serial the same way as the boot scripts, then passes `--platform` + `--device`. Install Maestro separately: [maestro.mobile.dev](https://maestro.mobile.dev). Not required for the “app opened on device” story when the CLI or JRE is missing and the WebView wrapper already launched.

Work from the repo root. There is one app tree.

## Tooling

| Need | Tool |
|---|---|
| iOS boot | Xcode → `xcrun simctl` (prefer a listed iPhone 16/15/14) |
| iOS WebView app | Xcode + `xcodebuild` (unsigned Simulator `ios/` target) |
| Android boot | Android Studio SDK: `adb` + `emulator` + at least one AVD |
| Android WebView APK | JDK 17+ (Android Studio JBR is fine) + SDK `platforms` / `build-tools` + Gradle (wrapper cache or `gradle` on PATH) |
| Maestro | `maestro` on PATH **and** a JRE 17+ (`JAVA_HOME`) |

`npm run probe:devices` prints what is on PATH **and** resolved JDK/SDK helpers (`artifacts/device-probe.log`). The report always ends with **what was missing → what that prevented from running**. `--strict` / `SAMPLE_REQUIRE_DEVICES=1` fail the probe only when a **required device tool** is missing (`xcrun`, `simctl`, `adb`, `emulator`). Maestro / Java / python3 **missing** is reported and does **not** fail the probe.

To simulate a missing toolchain **without uninstalling** Xcode or the Android SDK, set `SAMPLE_HIDE_TOOLS` (comma-separated). Aliases: `ios` (`xcrun` + `simctl`), `android` (`adb` + `emulator`), `maestro`, `java`. Concrete names work too (`xcrun`, `simctl`, `adb`, `emulator`, `python3`). The probe then treats those resolvers as not found — for logs / CI, not for uninstalling.

```bash
SAMPLE_HIDE_TOOLS=ios SAMPLE_REQUIRE_DEVICES=1 node scripts/test-device.mjs ios
```

Example on a Linux box with only `python3`. `when:` is a timestamp:

```text
============================================================
=== device probe ===
============================================================
when: 2026-09-14T09:25:48.185Z
tools found:
  python3      FOUND     /usr/bin/python3
tools missing:
  xcrun        NOT FOUND
  simctl       NOT FOUND
  adb          NOT FOUND
  emulator     NOT FOUND
  java         NOT FOUND
  maestro      NOT FOUND
lanes ran:
  python3
lanes skipped:
  ios-simulator         missing: xcrun, simctl
  ios-app               missing: xcrun, simctl
  android-emulator      missing: adb, emulator
  android-app           missing: adb
  maestro               missing: maestro, java
=== skipped (why) ===
missing xcrun, simctl → did not boot Simulator
missing xcrun, simctl → did not install/launch WebView app
missing adb, emulator → did not boot AVD
missing adb → did not install/launch WebView APK
missing maestro, java → did not run Maestro YAML
============================================================
log: artifacts/device-probe.log
============================================================
```

If every lane ran:

```text
=== skipped (why) ===
none
```

Each skipped line is `missing tool(s) →` a concrete action that did not happen: boot Simulator, install/launch iOS WebView app, boot AVD, install/launch WebView APK, run Maestro YAML, serve demo.
