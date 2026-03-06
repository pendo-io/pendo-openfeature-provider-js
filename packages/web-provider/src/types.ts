/**
 * Type declarations for Pendo Web SDK integration.
 */

declare global {
  interface Window {
    pendo?: {
      segmentFlags?: string[];
      isReady?: () => boolean;
      initialize?: (options: unknown) => void;
      track?: (event: string, properties?: Record<string, string>) => void;
    };
  }
}

// This export makes this file a module
export {};
