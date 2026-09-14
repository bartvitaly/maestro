# Harbor Lease — Android + iOS smoke sample

Public, secret-free demo of a **leasing-desk business path** on both phones.

The path under test:

1. Filter inventory (city, bedrooms, max rent)
2. Open unit **HL-1042** (Dunajská 18, Bratislava)
3. Book a viewing slot
4. Submit a tenant application (income, employment, occupants, terms)
5. Case moves to **Awaiting holding deposit**
6. **Stop when Pay is visible** — smoke never charges

That is the same shape I use on a hybrid Capacitor app: one selector contract, two drivers.

| Lane | How UI is driven | What you can run here |
|---|---|---|
| **Playwright (both)** | Chromium, Pixel 7 + iPhone 14 **viewports**. `test:android` / `test:ios` are those projects — **not** emulators. | `npm test` |
| **Device lane** | Boot a real Android emulator + iOS Simulator. Android **installs and launches** a thin WebView APK (`com.example.listings`). iOS **installs and launches** a thin WKWebView app (`com.example.listings`). Maestro uses `appId` + `launchApp` when a JRE is available. | `npm run test:device` + [`.maestro/android/shell.yaml`](.maestro/android/shell.yaml) / [`.maestro/ios/shell.yaml`](.maestro/ios/shell.yaml) |

Playwright Chromium is the **real automated** business-path check. The device lane is the required visual/runtime path (emulator + Simulator). Android’s intended path is the **installed WebView app**, not Chrome. iOS’s intended path is the **installed WKWebView app**, not Safari. Both wrappers load the static demo — not Play Store / App Store / Capacitor production binaries.

I do **not** use Appium here. WebKit is **not** the default (`PLAYWRIGHT_IOS_WEBKIT=1` is optional and often blocked by TLS MITM).

The live product this pattern comes from is [Step Swap](https://stepswap.eu) (private repo). This sample is a leasing desk so the flow looks like client work, not a toy.

Run everything from **this repo root**. There is one app tree: one `package.json`, one `e2e/`, one `.maestro/`, one `scripts/`.

## Run

**Default path** (handout): Playwright Chromium **and** a real Android emulator **and** iOS Simulator. A `SKIP:` is **not** a pass when devices are required.

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

- **`npm test`** — automated path in **Playwright Chromium** (Pixel 7 + iPhone 14 viewports).
- **`npm run test:android` / `test:ios`** — those same viewport projects. **Not** an emulator or Simulator.
- **`npm run test:device`** — serve static HTML on `0.0.0.0:4173`, boot emulator / Simulator, **install and launch the Android WebView APK and the iOS WKWebView app**. Android URL inside the app: `http://10.0.2.2:4173`. iOS Simulator URL: `http://127.0.0.1:4173`. Maestro/JRE missing is optional once the apps are up; a failed Maestro run is not. Android Maestro uses [`.maestro/android/shell.yaml`](.maestro/android/shell.yaml) (`appId: com.example.listings`) on the online emulator. iOS Maestro uses [`.maestro/ios/shell.yaml`](.maestro/ios/shell.yaml) (`appId: com.example.listings`) on the booted Simulator (`--platform` + `--device`).
- **`npm run test:all`** — `npm test` then the device lane.

`SAMPLE_REQUIRE_DEVICES=1` (or `node scripts/test-device.mjs --strict`) makes a missing Simulator, AVD, failed WebView install, or 127.0.0.1-only demo bind **exit non-zero**. Maestro / Java **missing** is **not** a device failure if the Android or iOS WebView app already launched. A Maestro flow that runs and fails **is** a failure. Without that env var, missing tools print `SKIP:` and exit 0 — that is **not** a device pass. `npm run probe:devices -- --strict` fails only on missing required device tools (`xcrun`, `simctl`, `adb`, `emulator`), not on a missing Maestro CLI or JRE.

To exercise a SKIP without uninstalling Xcode or the SDK: `SAMPLE_HIDE_TOOLS=ios,android,maestro,java` (aliases or concrete names; see [DEVICE.md](DEVICE.md)). Example: `SAMPLE_HIDE_TOOLS=ios SAMPLE_REQUIRE_DEVICES=1 node scripts/test-device.mjs ios`.

Do **not** set `PLAYWRIGHT_IOS_WEBKIT=1` for this path. No Appium. The Android wrapper is not a store listing.

[`.github/workflows/playwright.yml`](.github/workflows/playwright.yml) installs WebKit and sets `PLAYWRIGHT_IOS_WEBKIT=1` on CI. Local default `npm test` stays on Chromium.

Avast MITM does **not** block `simctl`. Full bind-address table, skip rules, and probe log example: [DEVICE.md](DEVICE.md).

Default `npm test` uses Chromium for the iPhone 14 **viewport** too, so a missing WebKit `pw_run.sh` does not matter unless you set `PLAYWRIGHT_IOS_WEBKIT=1`.

### WebKit download fails on a Mac (`SELF_SIGNED_CERT_IN_CHAIN`)

Avast (or another TLS inspector) MITMs HTTPS. Node does not trust the extra root, so `npx playwright install webkit` dies. Chromium is enough for `npm test`.

To install WebKit anyway (same fix as Step Swap `docs/AGENT_MAC_PLAYWRIGHT.md`: dump **SystemRoot + System** keychains — SystemRoot alone misses the Avast root):

```bash
npm run playwright:install
```

or the equivalent paste (no Node helper):

```bash
mkdir -p node_modules/.cache/maestro-sample
security find-certificate -a -p \
  /System/Library/Keychains/SystemRootCertificates.keychain \
  /Library/Keychains/System.keychain \
  > node_modules/.cache/maestro-sample/macos-root-ca-full.pem

NODE_EXTRA_CA_CERTS="$PWD/node_modules/.cache/maestro-sample/macos-root-ca-full.pem" \
  npx playwright install chromium chromium-headless-shell webkit
```

or the shell wrapper: [`scripts/macos-install-browsers.sh`](scripts/macos-install-browsers.sh).

Only after WebKit is on disk:

```bash
PLAYWRIGHT_IOS_WEBKIT=1 npm test
# or: npm run test:ios:webkit
```

Do **not** export `PLAYWRIGHT_IOS_WEBKIT=1` in your shell profile — that makes default `npm test` look for `pw_run.sh` again.

Last resort only: `NODE_TLS_REJECT_UNAUTHORIZED=0 npx playwright install webkit`.

Maestro ([CLI](https://maestro.mobile.dev)) needs a **JRE 17+**. macOS `/usr/bin/java` is often a stub; the device scripts use Android Studio’s bundled JBR when present (`JAVA_HOME`). If Maestro is missing or Java is missing, the lane still counts as a device pass when the Android or iOS WebView app already opened. A failed Maestro run does not. Piece-wise:

```bash
npm run serve:demo
npm run boot:android          # install + launch com.example.listings
npm run boot:ios              # install + launch com.example.listings
# Always pass --platform and --device (both apps share com.example.listings).
maestro --platform android --device emulator-5554 test .maestro/android/shell.yaml
maestro --platform ios --device "$IOS_UDID" test .maestro/ios/shell.yaml
```

`.maestro/android/shell.yaml` and `.maestro/ios/shell.yaml` match the installed wrappers (`appId: com.example.listings`). On API 24 (`pixel_24`) Android Maestro is an inventory smoke (DevTools DOM snapshot often fails); the full leasing path stays in [`.maestro/android/shell-web.yaml`](.maestro/android/shell-web.yaml) (host Chromium). iOS host-Chromium fallback: [`.maestro/ios/shell-web.yaml`](.maestro/ios/shell-web.yaml).

## Shared selector contract

[`selectors.json`](selectors.json) lists each control once: `id` (Android + iOS CDP + Playwright) and `name` (iOS Maestro / VoiceOver). Rename in HTML, both YAML folders, and the Playwright helper together.

## What this is not

- Not Step Swap source, keys, or staging
- Not Appium, a Play Store / Capacitor production binary, or Playwright `_android`
- The Android device lane **does** install a **thin WebView wrapper** APK (`android/`, `com.example.listings`) around the static demo
- The iOS device lane **does** install a **thin WKWebView wrapper** (`ios/`, `com.example.listings`) around the static demo — not an App Store / Capacitor binary
- `test:android` / `test:ios` are viewport aliases, not emulators

## Why iOS YAML is not a copy of Android YAML

Maestro's iOS driver reads the accessibility tree. `id: nav-inventory` works in an Android WebView and is invisible on iOS. Either give the control a stable accessible name, or tap the same id over JS (`scripts/tap-by-id.mjs`). Stripe-style card fields are name-only: [`.maestro/ios/card-a11y.yaml`](.maestro/ios/card-a11y.yaml).
