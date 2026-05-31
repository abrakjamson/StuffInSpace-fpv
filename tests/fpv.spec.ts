import { expect, test, type Page } from "@playwright/test";

test.describe("FPV space-crowding view", () => {
  async function openReadyApp(page: Page) {
    await page.goto("/?fpvTest=1");
    await expect(page.getByTestId("fpv-panel")).toBeVisible();
    await expect(page.locator("#load-cover")).toHaveClass(/hidden/);
  }

  test("enables the LEO camera, time warp, range filtering, and HUD metrics", async ({ page }) => {
    await openReadyApp(page);

    await page.getByTestId("fpv-speed-1000").click();
    await page.getByTestId("fpv-range-10").click();

    await expect(page.locator("body")).toHaveClass(/fpv-active/);
    await expect(page.getByTestId("fpv-observer")).toContainText("Custom LEO observer");

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.timeScale);
    }).toBe(1000);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.rangeKm);
    }).toBe(10);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.metrics.nearestDistanceKm ?? null);
    }).not.toBeNull();

    const state = await page.evaluate(() => (window as any).__stuffInSpaceFpv);
    expect(state?.settings.enabled).toBe(true);
    expect(state?.observer?.altitudeKm).toBeGreaterThan(100);
    expect(state?.metrics.countWithin100Km).toBeGreaterThanOrEqual(0);
    expect(state?.metrics.nearestRelativeVelocityKmSec).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("fpv-nearest")).not.toContainText("Waiting");
  });

  test("rides along with the ISS when selected", async ({ page }) => {
    await openReadyApp(page);

    await page.getByTestId("fpv-mode").selectOption("iss");

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.observer?.label ?? "");
    }).toContain("ISS");

    await expect(page.getByTestId("fpv-observer")).toContainText("ISS");

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.metrics.nearestDistanceKm ?? null);
    }).not.toBeNull();

    const state = await page.evaluate(() => (window as any).__stuffInSpaceFpv);
    expect(state?.metrics.nearestObjectName).not.toBe(state?.observer?.label);
    expect(state?.metrics.nearestObjectId).not.toBe(state?.observer?.satelliteObjectId);
  });

  test("mounts the first-person canvas with FPV camera state", async ({ page }) => {
    await openReadyApp(page);

    await page.waitForFunction(() => (window as any).__stuffInSpaceFpv?.observer !== null);

    await expect(page.locator("body")).toHaveClass(/fpv-active/);
    await expect(page.locator("canvas")).toBeVisible();

    const state = await page.evaluate(() => (window as any).__stuffInSpaceFpv);
    expect(state?.settings.enabled).toBe(true);
    expect(state?.observer?.mode).toBe("custom");
    expect(state?.observer?.altitudeKm).toBeGreaterThan(100);
  });

  test("uses exactly the FPV-only distance filters", async ({ page }) => {
    await openReadyApp(page);

    await expect(page.getByTestId("fpv-range-all")).toBeVisible();
    await expect(page.getByTestId("fpv-range-10")).toBeVisible();
    await expect(page.getByTestId("fpv-range-100m")).toBeVisible();
    await expect(page.locator(".fpv-range")).toHaveText(["All", "10 km", "100 m"]);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.rangeKm);
    }).toBe("all");
  });

  test("changes FPV look direction by dragging the canvas", async ({ page }) => {
    await openReadyApp(page);
    await page.waitForFunction(() => (window as any).__stuffInSpaceFpv?.observer !== null);

    const initialLook = await page.evaluate(() => (window as any).__stuffInSpaceFpv?.look);
    const canvasBox = await page.locator("canvas").boundingBox();
    expect(canvasBox).not.toBeNull();

    if (!canvasBox) {
      return;
    }

    const startX = canvasBox.x + canvasBox.width * 0.7;
    const startY = canvasBox.y + canvasBox.height * 0.55;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 140, startY - 45);
    await page.mouse.up();

    await expect.poll(async () => {
      const look = await page.evaluate(() => (window as any).__stuffInSpaceFpv?.look);
      return Math.abs((look?.yawDeg ?? 0) - (initialLook?.yawDeg ?? 0));
    }).toBeGreaterThan(5);
  });
});
