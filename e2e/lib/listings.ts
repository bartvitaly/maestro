import { expect, type Page } from "@playwright/test";

/** Same DOM ids Android Maestro uses (`androidWebViewHierarchy: devtools`). */
export async function runLeaseApplicationAndStopAtDeposit(page: Page) {
  await page.goto("/");
  await expect(page.locator("#heading-inventory")).toBeVisible();

  await page.locator("#select-city").selectOption("BA");
  await page.locator("#select-beds").selectOption("2");
  await page.locator("#input-max-rent").fill("1500");
  await page.locator("#btn-search").click();

  await expect(page.locator("#lbl-result-count")).toHaveText("1 unit in filter");
  await expect(page.locator("#card-unit-hl1042")).toBeVisible();
  await expect(page.locator("#card-unit-hl2210")).toHaveCount(0);

  await page.locator("#btn-open-hl1042").click();
  await expect(page.locator("#lbl-detail-ref")).toHaveText("HL-1042");
  await expect(page.locator("#heading-detail")).toHaveText(/Dunajská 18/);

  await page.locator("#select-slot").selectOption("Tue 16 Sep · 17:30");
  await page.locator("#btn-book-viewing").click();
  await expect(page.locator("#lbl-viewing-confirm")).toContainText("Tue 16 Sep · 17:30");
  await expect(page.locator("#lbl-viewing-confirm")).toContainText("HL-1042");

  await page.locator("#btn-start-application").click();
  await expect(page.locator("#heading-apply")).toBeVisible();
  await page.locator("#input-legal-name").fill("Ada Kovacs");
  await page.locator("#input-email").fill("ada.kovacs@example.com");
  await page.locator("#input-income").fill("2400");
  await page.locator("#select-employment").selectOption("employed");
  await page.locator("#input-occupants").fill("2");
  await page.locator("#chk-accuracy").check();
  await page.locator("#btn-submit-application").click();

  await expect(page.locator("#lbl-deposit-status")).toHaveText("Awaiting holding deposit");
  await expect(page.locator("#btn-pay-deposit")).toBeVisible();
  await expect(page.locator("#btn-pay-deposit")).toBeEnabled();

  await page.locator("#nav-pipeline").click();
  await expect(page.locator("#lbl-case-ref")).toHaveText("HL-1042");
  await expect(page.locator("#lbl-case-status")).toHaveText("Awaiting holding deposit");
}
