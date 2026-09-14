#!/usr/bin/env node
// Stand-in for WKWebView inspector: Runtime.evaluate → getElementById(id).click()

import { chromium } from "@playwright/test";

const id = process.argv[2] || "nav-pipeline";
const url = process.env.SAMPLE_URL || "http://127.0.0.1:4173/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url);
await page.evaluate((targetId) => {
  const el = document.getElementById(targetId);
  if (!el) throw new Error(`No element #${targetId}`);
  el.click();
}, id);
const visible = await page.evaluate(
  () => document.getElementById("heading-pipeline")?.textContent ?? "",
);
console.log(`tapped #${id}; heading-pipeline="${visible}"`);
await browser.close();
if (!visible) process.exit(1);
