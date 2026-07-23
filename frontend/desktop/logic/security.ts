import * as electron from "electron";
import { isHttpUrl } from "../helpers/url";

export type PermissionPolicyInput = {
  appOrigin: string;
  isMainFrame: boolean;
  mainWebContents: object;
  mediaTypes: readonly string[] | undefined;
  permission: string;
  requestingOrigin: string | undefined;
  requestingUrl: string | undefined;
  requestingWebContents: object | null;
};

function isTrustedMainFrameRequest(input: PermissionPolicyInput): boolean {
  const appOrigin = safeOrigin(input.appOrigin);
  return (
    appOrigin !== null &&
    input.requestingWebContents === input.mainWebContents &&
    input.isMainFrame &&
    safeOrigin(input.requestingOrigin) === appOrigin &&
    safeOrigin(input.requestingUrl) === appOrigin
  );
}

export function allowsPermission(input: PermissionPolicyInput): boolean {
  if (!isTrustedMainFrameRequest(input)) return false;
  if (input.permission === "clipboard-sanitized-write") return true;
  return (
    input.permission === "media" &&
    input.mediaTypes?.length === 1 &&
    input.mediaTypes[0] === "audio"
  );
}

export function registerPermissionPolicy(window: electron.BrowserWindow, appOrigin: string): void {
  const mainWebContents = window.webContents;
  const session = mainWebContents.session;

  session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
    const securityOrigin =
      "securityOrigin" in details ? details.securityOrigin : details.requestingUrl;
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      allowsPermission({
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
      allowsPermission({
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

function safeOrigin(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const origin = new URL(input).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
