import { test, expect } from "@playwright/test";
import { runLeaseApplicationAndStopAtDeposit } from "./lib/listings";

test("inventory filter → viewing → application → stop at deposit", async ({ page }, testInfo) => {
  await runLeaseApplicationAndStopAtDeposit(page);
  expect(
    testInfo.project.name === "android-pixel7" || testInfo.project.name === "ios-iphone14",
  ).toBe(true);
});

test("bottom nav stays on a phone viewport", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator("nav.bottom");
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box?.y).toBeGreaterThan(400);
});
