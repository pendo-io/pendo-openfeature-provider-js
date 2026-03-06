/**
 * Type declarations for Pendo Web SDK integration.
 */

interface PendoEventEmitter {
  on: (handler: (data?: unknown) => void) => void;
  off: (handler: (data?: unknown) => void) => void;
  trigger: (data?: unknown) => void;
}

declare global {
  interface Window {
    pendo?: {
      segmentFlags?: string[] | null;
      isReady?: () => boolean;
      initialize?: (options: unknown) => void;
      track?: (event: string, properties?: Record<string, string>) => void;
      Events?: {
        segmentFlagsUpdated?: PendoEventEmitter;
      };
    };
  }
}

// This export makes this file a module
export {};
