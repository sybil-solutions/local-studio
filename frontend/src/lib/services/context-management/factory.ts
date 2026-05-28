import { ContextManagementService } from "./service";
import {
  DEFAULT_CONTEXT_CONFIG,
  type ContextConfig,
  type IContextManagementService,
} from "./types";

let defaultInstance: IContextManagementService | null = null;

export class ContextManagementServiceFactory {
  create(config: Partial<ContextConfig>): IContextManagementService {
    const fullConfig: ContextConfig = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
    };
    return new ContextManagementService(fullConfig);
  }

  createDefault(): IContextManagementService {
    if (!defaultInstance) {
      defaultInstance = new ContextManagementService(DEFAULT_CONTEXT_CONFIG);
    }
    return defaultInstance;
  }
}

export const contextManagementServiceFactory = new ContextManagementServiceFactory();
