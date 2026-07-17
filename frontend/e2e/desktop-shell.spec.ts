import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { _electron } from "playwright";
import { installProductFixtures } from "./product-fixtures";

const frontendRoot = process.cwd();
const desktopMain = resolve(frontendRoot, "desktop", "dist", "main.js");
const electronExecutable = () => {
  if (process.platform === "darwin") {
    return resolve(
      frontendRoot,
      "node_modules",
      "electron",
      "dist",
      "Electron.app",
      "Contents",
      "MacOS",
      "Electron",
    );
  }
  if (process.platform === "win32") {
    return resolve(frontendRoot, "node_modules", "electron", "dist", "electron.exe");
  }
  return resolve(frontendRoot, "node_modules", "electron", "dist", "electron");
};

const processEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

test("the desktop shell launches and renders the recorded product surface", async ({}, testInfo) => {
  const artifacts = testInfo.outputPath("electron-artifacts");
  const savedVideo = testInfo.outputPath("desktop-shell.webm");
  const userData = await mkdtemp(join(tmpdir(), "local-studio-e2e-"));
  await mkdir(artifacts, { recursive: true });
  const app = await _electron.launch({
    executablePath: electronExecutable(),
    args: [desktopMain],
    cwd: frontendRoot,
    artifactsDir: artifacts,
    recordVideo: {
      dir: artifacts,
      size: { width: 1440, height: 960 },
      showActions: { duration: 650, position: "bottom-right", fontSize: 14 },
    },
    env: {
      ...processEnvironment(),
      LOCAL_STUDIO_DESKTOP_APP_NAME: "Local Studio E2E",
      LOCAL_STUDIO_DESKTOP_USER_DATA_DIR: userData,
      LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE: "true",
      LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:43210",
    },
  });
  const desktopPage = await app.firstWindow();
  const video = desktopPage.video();

  try {
    await installProductFixtures(desktopPage);
    await test.step("Load the desktop Usage surface", async () => {
      await desktopPage.goto("http://127.0.0.1:43210/usage");
      await expect(desktopPage.getByRole("heading", { name: "Usage" })).toBeVisible();
      await expect(desktopPage.getByText("1.50B", { exact: true })).toBeVisible();
    });

    await test.step("Verify the Electron bridge and desktop navigation", async () => {
      await expect
        .poll(() => desktopPage.evaluate(() => Boolean(window.localStudioDesktop)))
        .toBe(true);
      await desktopPage.getByTitle("Configure").click();
      await expect(
        desktopPage.getByRole("heading", { name: "Configure", exact: true }),
      ).toBeVisible();
    });
  } finally {
    await app.close();
    if (video) {
      await video.saveAs(savedVideo);
      await testInfo.attach("desktop-shell-video", { path: savedVideo, contentType: "video/webm" });
    }
    await rm(userData, { recursive: true, force: true });
  }
});
