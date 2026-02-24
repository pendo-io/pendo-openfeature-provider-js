import type {
  Provider,
  ProviderMetadata,
  ResolutionDetails,
  EvaluationContext,
  JsonValue,
  Hook,
  TrackingEventDetails,
} from "@openfeature/web-sdk";
import { ClientProviderStatus } from "@openfeature/web-sdk";

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

export interface PendoProviderOptions {
  /**
   * Optional: Pendo API key for initialization.
   * If not provided, assumes Pendo is already initialized on the page.
   */
  apiKey?: string;

  /**
   * Optional: Timeout in milliseconds to wait for Pendo to be ready.
   * Default: 5000ms
   */
  readyTimeout?: number;
}

/**
 * OpenFeature provider for Pendo feature flags.
 *
 * This provider evaluates feature flags by checking the `pendo.segmentFlags` array
 * which is populated by the Pendo agent based on segment membership.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/web-sdk';
 * import { PendoProvider } from '@pendo/openfeature-web-provider';
 *
 * await OpenFeature.setProviderAndWait(new PendoProvider());
 *
 * const client = OpenFeature.getClient();
 * const enabled = await client.getBooleanValue('myFeature', false);
 * ```
 */
export class PendoProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    name: "pendo-provider",
  };

  readonly rulesChanged?: () => void;
  status: ClientProviderStatus = ClientProviderStatus.NOT_READY;
  hooks?: Hook[];

  private options: PendoProviderOptions;
  private readyPromise: Promise<void> | null = null;

  constructor(options: PendoProviderOptions = {}) {
    this.options = {
      readyTimeout: 5000,
      ...options,
    };
  }

  /**
   * Initialize the provider.
   * Waits for Pendo to be ready before resolving.
   */
  async initialize(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.waitForPendo();
    await this.readyPromise;
    this.status = ClientProviderStatus.READY;
  }

  /**
   * Wait for Pendo to be ready with timeout.
   */
  private async waitForPendo(): Promise<void> {
    const timeout = this.options.readyTimeout ?? 5000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        // Check if pendo is available and ready
        if (typeof window !== "undefined" && window.pendo) {
          if (window.pendo.isReady?.() || window.pendo.segmentFlags !== undefined) {
            resolve();
            return;
          }
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          // Don't reject - just resolve and work without Pendo
          // Flags will default to false
          console.warn(
            "[PendoProvider] Pendo not ready within timeout. Flags will use default values."
          );
          resolve();
          return;
        }

        // Try again
        setTimeout(check, 100);
      };

      // Also listen for pendo:ready event
      if (typeof document !== "undefined") {
        document.addEventListener(
          "pendo:ready",
          () => {
            resolve();
          },
          { once: true }
        );
      }

      check();
    });
  }

  /**
   * Shutdown the provider.
   */
  async onClose(): Promise<void> {
    this.status = ClientProviderStatus.NOT_READY;
    this.readyPromise = null;
  }

  /**
   * Resolve a boolean flag value.
   *
   * Checks if the flagKey exists in pendo.segmentFlags array.
   */
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext
  ): ResolutionDetails<boolean> {
    const flags = this.getSegmentFlags();

    if (!flags) {
      return {
        value: defaultValue,
        reason: "DEFAULT",
        variant: "default",
      };
    }

    const enabled = flags.includes(flagKey);

    return {
      value: enabled,
      reason: enabled ? "TARGETING_MATCH" : "DEFAULT",
      variant: enabled ? "on" : "off",
    };
  }

  /**
   * Resolve a string flag value.
   *
   * For Pendo flags, this returns "on" if the flag is enabled, "off" otherwise.
   */
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): ResolutionDetails<string> {
    const boolResult = this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "DEFAULT" && !boolResult.value) {
      return {
        value: defaultValue,
        reason: "DEFAULT",
        variant: "default",
      };
    }

    return {
      value: boolResult.value ? "on" : "off",
      reason: boolResult.reason,
      variant: boolResult.variant,
    };
  }

  /**
   * Resolve a number flag value.
   *
   * For Pendo flags, this returns 1 if enabled, 0 if disabled.
   */
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext
  ): ResolutionDetails<number> {
    const boolResult = this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "DEFAULT" && !boolResult.value) {
      return {
        value: defaultValue,
        reason: "DEFAULT",
        variant: "default",
      };
    }

    return {
      value: boolResult.value ? 1 : 0,
      reason: boolResult.reason,
      variant: boolResult.variant,
    };
  }

  /**
   * Resolve an object flag value.
   *
   * For Pendo flags, this returns { enabled: true/false }.
   */
  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext
  ): ResolutionDetails<T> {
    const boolResult = this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "DEFAULT" && !boolResult.value) {
      return {
        value: defaultValue,
        reason: "DEFAULT",
        variant: "default",
      };
    }

    return {
      value: { enabled: boolResult.value } as unknown as T,
      reason: boolResult.reason,
      variant: boolResult.variant,
    };
  }

  /**
   * Get the segment flags array from Pendo.
   */
  private getSegmentFlags(): string[] | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }

    return window.pendo?.segmentFlags;
  }

  /**
   * Track a custom event in Pendo.
   *
   * This method delegates to the Pendo agent's track function.
   * The Pendo agent must be initialized on the page for this to work.
   *
   * @param trackingEventName - The name of the event to track
   * @param _context - Evaluation context (unused in web provider, Pendo agent handles visitor context)
   * @param trackingEventDetails - Optional additional event properties
   */
  track(
    trackingEventName: string,
    _context: EvaluationContext,
    trackingEventDetails: TrackingEventDetails
  ): void {
    if (typeof window === "undefined" || !window.pendo?.track) {
      console.warn("[PendoProvider] Pendo agent not available for tracking");
      return;
    }

    // Convert TrackingEventDetails to Record<string, string> for Pendo agent
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(trackingEventDetails)) {
      if (value !== undefined && value !== null) {
        properties[key] = String(value);
      }
    }

    // Fire-and-forget: delegate to Pendo agent
    window.pendo.track(trackingEventName, properties);
  }
}
