import { test, expect } from "@playwright/test";

test("iOS-style tapById via evaluate", async ({ page }, info) => {
  test.skip(info.project.name !== "ios-iphone14", "This spec is the iOS CDP story");
  await page.goto("/");
  await page.evaluate(() => {
    const el = document.getElementById("nav-pipeline");
    if (!el) throw new Error("missing #nav-pipeline");
    el.click();
  });
  await expect(page.locator("#heading-pipeline")).toBeVisible();
});
