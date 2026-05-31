import { expect, test, type Page } from "@playwright/test";

test.describe("FPV space-crowding view", () => {
  async function openReadyApp(page: Page) {
    await page.goto("/?fpvTest=1");
    await expect(page.getByTestId("fpv-panel")).toBeVisible();
    await expect(page.locator("#load-cover")).toHaveClass(/hidden/);
  }

  async function sampleRenderedCanvas(page: Page) {
    return page.evaluate(() => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");

      if (!canvas || !gl) {
        return { nonBlackPixels: 0, colorVariance: 0 };
      }

      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      let nonBlackPixels = 0;
      let colorSamples = 0;
      let colorTotal = 0;
      let colorTotalSquared = 0;
      const step = Math.max(1, Math.floor(width / 160));

      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const index = (y * width + x) * 4;
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const brightness = red + green + blue;

          if (brightness > 18) {
            nonBlackPixels += 1;
            const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
            colorTotal += colorSpread;
            colorTotalSquared += colorSpread * colorSpread;
            colorSamples += 1;
          }
        }
      }

      const colorMean = colorSamples > 0 ? colorTotal / colorSamples : 0;
      return {
        nonBlackPixels,
        colorVariance: colorSamples > 0 ? (colorTotalSquared / colorSamples) - (colorMean * colorMean) : 0,
      };
    });
  }

  test("enables the LEO camera, time warp, range filtering, and HUD metrics", async ({ page }) => {
    await openReadyApp(page);

    await page.getByTestId("fpv-speed-1000").click();
    await page.getByTestId("fpv-range-100").click();

    await expect(page.locator("body")).toHaveClass(/fpv-active/);
    await expect(page.getByTestId("fpv-observer")).toContainText("Custom LEO observer");

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.timeScale);
    }).toBe(1000);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.rangeKm);
    }).toBe(100);

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
    await expect(page.getByTestId("fpv-range-100")).toBeVisible();
    await expect(page.getByTestId("fpv-range-100m")).toBeVisible();
    await expect(page.locator(".fpv-range")).toHaveText(["All", "100 km", "100 m"]);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__stuffInSpaceFpv?.settings.rangeKm);
    }).toBe("all");
  });

  test("changes Earth angular size when altitude changes", async ({ page }) => {
    await openReadyApp(page);
    await page.waitForFunction(() => (window as any).__stuffInSpaceFpv?.observer !== null);

    await page.getByTestId("fpv-altitude").fill("120");
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.observer?.earthAngularDiameterDeg ?? 0
    ))).toBeGreaterThan(150);
    const lowAltitudeDiameter = await page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.observer?.earthAngularDiameterDeg ?? 0
    ));

    await page.getByTestId("fpv-altitude").fill("2000");
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.observer?.earthAngularDiameterDeg ?? 999
    ))).toBeLessThan(lowAltitudeDiameter - 20);
  });

  test("shows synthetic dust separately within the selected view distance", async ({ page }) => {
    await openReadyApp(page);

    await expect(page.getByTestId("fpv-dust-count")).toHaveText("Off");
    await page.getByTestId("fpv-dust-enabled").check();

    await expect.poll(async () => page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.dust?.countWithinView ?? 0
    ))).toBeGreaterThan(2000);

    const allDustCount = await page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.dust?.countWithinView ?? 0
    ));

    await page.getByTestId("fpv-range-100").click();
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.dust?.countWithinView ?? 0
    ))).toBeLessThan(allDustCount);
    const hundredKmDustCount = await page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.dust?.countWithinView ?? 0
    ));

    await page.getByTestId("fpv-range-100m").click();
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__stuffInSpaceFpv?.dust?.countWithinView ?? 0
    ))).toBeLessThan(hundredKmDustCount);
    await expect(page.getByTestId("fpv-dust-count")).not.toHaveText("Off");
  });

  test("changes FPV pitch by dragging the canvas vertically", async ({ page }) => {
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
    await page.mouse.move(startX, startY - 120);
    await page.mouse.up();

    await expect.poll(async () => {
      const look = await page.evaluate(() => (window as any).__stuffInSpaceFpv?.look);
      return Math.abs((look?.pitchDeg ?? 0) - (initialLook?.pitchDeg ?? 0));
    }).toBeGreaterThan(10);
  });

  test("renders visible Earth landmass detail", async ({ page }) => {
    const earthTextureResponse = page.waitForResponse((response) => (
      response.url().includes("8081_earthmap4k.jpg") && response.ok()
    ));

    await openReadyApp(page);
    await earthTextureResponse;
    await page.addStyleTag({ content: "#fpv-panel, #menu-right, .release-date-holder { display: none !important; }" });
    await page.waitForFunction(() => (window as any).__stuffInSpaceFpv?.observer !== null);

    await expect.poll(async () => {
      const stats = await sampleRenderedCanvas(page);
      return stats.nonBlackPixels > 400 && stats.colorVariance > 20;
    }, {
      timeout: 20_000,
    }).toBe(true);

    const earthStats = await sampleRenderedCanvas(page);
    expect(earthStats.nonBlackPixels).toBeGreaterThan(400);
    expect(earthStats.colorVariance).toBeGreaterThan(20);
  });
});
