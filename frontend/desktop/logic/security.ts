import * as electron from "electron";
import { isHttpUrl } from "../helpers/url";

export type MicrophonePermissionInput = {
  appOrigin: string;
  isMainFrame: boolean;
  mainWebContents: object;
  mediaTypes: readonly string[] | undefined;
  permission: string;
  requestingOrigin: string | undefined;
  requestingUrl: string | undefined;
  requestingWebContents: object | null;
};

export function allowsMicrophonePermission(input: MicrophonePermissionInput): boolean {
  const appOrigin = safeOrigin(input.appOrigin);
  return (
    appOrigin !== null &&
    input.permission === "media" &&
    input.requestingWebContents === input.mainWebContents &&
    input.isMainFrame &&
    safeOrigin(input.requestingOrigin) === appOrigin &&
    safeOrigin(input.requestingUrl) === appOrigin &&
    input.mediaTypes?.length === 1 &&
    input.mediaTypes[0] === "audio"
  );
}

export function registerMicrophonePermissionPolicy(
  window: electron.BrowserWindow,
  appOrigin: string,
): void {
  const mainWebContents = window.webContents;
  const session = mainWebContents.session;

  session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
    const securityOrigin =
      "securityOrigin" in details ? details.securityOrigin : details.requestingUrl;
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      allowsMicrophonePermission({
        appOrigin,
        isMainFrame: details.isMainFrame,
        mainWebContents,
        mediaTypes,
        permission,
        requestingOrigin: securityOrigin ?? details.requestingUrl,
        requestingUrl: details.requestingUrl,
        requestingWebContents,
      }),
    );
  });

  session.setPermissionCheckHandler(
    (requestingWebContents, permission, requestingOrigin, details) =>
      allowsMicrophonePermission({
        appOrigin,
        isMainFrame: details.isMainFrame,
        mainWebContents,
        mediaTypes: details.mediaType ? [details.mediaType] : undefined,
        permission,
        requestingOrigin,
        requestingUrl: details.requestingUrl ?? requestingOrigin,
        requestingWebContents,
      }),
  );
}

export function hardenWebContents(window: electron.BrowserWindow, appOrigin: string): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void electron.shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event) => {
    const targetUrl = event.url;
    const targetOrigin = safeOrigin(targetUrl);
    if (!targetOrigin || targetOrigin !== appOrigin) {
      event.preventDefault();
      if (isHttpUrl(targetUrl)) {
        void electron.shell.openExternal(targetUrl);
      }
    }
  });
}

export function registerNavigationPolicy(appOrigin: string): void {
  electron.app.on("web-contents-created", (_, contents: electron.WebContents) => {
    contents.on("will-attach-webview", (_event, webPreferences, _params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    });

    contents.on("will-navigate", (event) => {
      // Guest WebContents (the embedded browser webview plus cross-origin
      // iframes / OOPIFs) must be able to perform their own navigations.
      // Keep the app shell origin-locked, but do not turn the Computer browser
      // into a single-load preview.
      if (
        contents.getType() === "webview" ||
        electron.BrowserWindow.fromWebContents(contents) == null
      ) {
        return;
      }
      const targetUrl = event.url;
      const targetOrigin = safeOrigin(targetUrl);
      if (!targetOrigin || targetOrigin !== appOrigin) {
        event.preventDefault();
      }
    });
  });
}

function safeOrigin(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const origin = new URL(input).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
