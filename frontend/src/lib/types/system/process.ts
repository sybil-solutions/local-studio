/**
 * Process + health types shared across the app.
 */

export interface ProcessInfo {
  pid: number;
  backend: string;
  model_path: string | null;
  port: number;
  served_model_name?: string | null;
}
