// CRITICAL
/**
 * Message Parsing Service Factory
 * Creates configured instances of MessageParsingService
 */

import { MessageParsingService } from "./service";
import type {
  IMessageParsingService,
  IMessageParsingServiceFactory,
  MessageParsingConfig,
} from "./types";

// Default configuration
const DEFAULT_MESSAGE_PARSING_CONFIG: MessageParsingConfig = {
  enableArtifacts: true,
  enableThinkingExtraction: true,
  enableMcpXmlStripping: true,
  enableBoxTagStripping: true,
  cacheSize: 100,
};

// Singleton instance for default configuration
let defaultInstance: IMessageParsingService | null = null;

export class MessageParsingServiceFactory implements IMessageParsingServiceFactory {
  /**
   * Create a new service instance with custom configuration
   */
  create(config: Partial<MessageParsingConfig>): IMessageParsingService {
    const fullConfig: MessageParsingConfig = {
      ...DEFAULT_MESSAGE_PARSING_CONFIG,
      ...config,
    };
    return new MessageParsingService(fullConfig);
  }

  /**
   * Create or return the default service instance (singleton)
   */
  createDefault(): IMessageParsingService {
    if (!defaultInstance) {
      defaultInstance = new MessageParsingService(DEFAULT_MESSAGE_PARSING_CONFIG);
    }
    return defaultInstance;
  }

  /**
   * Create a lightweight service for server-side use
   * (no artifacts, minimal features)
   */
  createForServer(): IMessageParsingService {
    return new MessageParsingService({
      enableArtifacts: false,
      enableThinkingExtraction: false,
      enableMcpXmlStripping: true,
      enableBoxTagStripping: true,
      cacheSize: 50,
    });
  }

  /**
   * Create a service optimized for streaming messages
   * (caching disabled, all features enabled)
   */
  createForStreaming(): IMessageParsingService {
    return new MessageParsingService({
      enableArtifacts: true,
      enableThinkingExtraction: true,
      enableMcpXmlStripping: true,
      enableBoxTagStripping: true,
      cacheSize: 0, // No caching for streaming
    });
  }

  /**
   * Reset the default singleton instance
   * Useful for testing or reconfiguration
   */
  resetDefault(): void {
    defaultInstance = null;
  }
}

// Export singleton factory instance
export const messageParsingServiceFactory = new MessageParsingServiceFactory();

// Convenience function to get default service
export function getMessageParsingService(): IMessageParsingService {
  return messageParsingServiceFactory.createDefault();
}
