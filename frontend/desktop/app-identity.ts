import { app } from "electron";
import path from "node:path";

const devAppName = process.env.VLLM_STUDIO_DESKTOP_APP_NAME?.trim();
const devUserDataDir = process.env.VLLM_STUDIO_DESKTOP_USER_DATA_DIR?.trim();

if (devAppName) {
  app.setName(devAppName);
  process.title = devAppName;
}

if (devUserDataDir) {
  app.setPath("userData", path.resolve(devUserDataDir));
}
