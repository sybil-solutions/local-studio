// Ambient declarations for the standalone tsc build (tsconfig.build.json)
// only. The Next/frontend program gets these globals from its own type
// environment (Electron augments Process; the desktop runtime sets
// resourcesPath). This file is NOT part of the transpilePackages surface —
// nothing imports it; it is included solely via tsconfig.build.json.

declare namespace NodeJS {
  interface Process {
    /** Electron-only: absolute path to the app's resources directory. */
    resourcesPath?: string;
  }
}
