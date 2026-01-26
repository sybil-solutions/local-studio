/**
 * Context Management Service Factory
 */

import { ContextManagementService } from "./service";
import type { IContextManagementService, ContextConfig } from "./types";

const DEFAULT_CONTEXT_MANAGEMENT_CONFIG: ContextConfig = {
  compactionThreshold: 0.8,
  targetAfterCompaction: 0.5,
  preserveRecentMessages: 4,
  autoCompact: true,
  checkInterval: 5000,
};

let defaultInstance: IContextManagementService | null = null;

export class ContextManagementServiceFactory {
  create(config: Partial<ContextConfig>): IContextManagementService {
    const fullConfig: ContextConfig = {
      ...DEFAULT_CONTEXT_MANAGEMENT_CONFIG,
      ...config,
    };
    return new ContextManagementService(fullConfig);
  }

  createDefault(): IContextManagementService {
    if (!defaultInstance) {
      defaultInstance = new ContextManagementService(DEFAULT_CONTEXT_MANAGEMENT_CONFIG);
    }
    return defaultInstance;
  }

  resetDefault(): void {
    defaultInstance = null;
  }
}

export const contextManagementServiceFactory = new ContextManagementServiceFactory();

export function getContextManagementService(): IContextManagementService {
  return contextManagementServiceFactory.createDefault();
}
