import type { StudioModelRecommendation, StudioModuleDefaults } from "./types";

export interface StudioModuleConfig {
  defaults: StudioModuleDefaults;
  recommendations: StudioModelRecommendation[];
}
