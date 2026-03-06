import type {
  Provider,
  ProviderMetadata,
  ResolutionDetails,
  EvaluationContext,
  JsonValue,
  Hook,
  TrackingEventDetails,
} from "@openfeature/web-sdk";
import {
  ClientProviderStatus,
  OpenFeatureEventEmitter,
  ProviderEvents,
} from "@openfeature/web-sdk";
import "./types";

export interface PendoProviderOptions {
  /**
   * Timeout in milliseconds to wait for Pendo to be ready.
   * Default: 5000ms
   */
  readyTimeout?: number;
}

/**
 * OpenFeature provider for Pendo feature flags.
 *
 * This provider integrates with the Pendo Web SDK's segment-flags plugin
 * to evaluate feature flags based on segment membership.
 *
 * Prerequisites:
 * - Pendo Web SDK must be installed and initialized on the page
 * - `requestSegmentFlags: true` must be set in the Pendo configuration
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/web-sdk';
 * import { PendoProvider } from '@pendo/openfeature-web-provider';
 *
 * // Pendo must be initialized with requestSegmentFlags enabled:
 * // pendo.initialize({
 * //   visitor: { id: 'user-123' },
 * //   account: { id: 'account-456' },
 * //   requestSegmentFlags: true
 * // });
 *
 * await OpenFeature.setProviderAndWait(new PendoProvider());
 *
 * const client = OpenFeature.getClient();
 * const enabled = client.getBooleanValue('myFeature', false);
 * ```
 */
export class PendoProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    name: "pendo-provider",
  };

  readonly events = new OpenFeatureEventEmitter();
  status: ClientProviderStatus = ClientProviderStatus.NOT_READY;
  hooks?: Hook[];

  private options: Required<PendoProviderOptions>;
  private flagChangeDetectionSetup = false;
  private flagChangeHandler: (() => void) | null = null;

  constructor(options: PendoProviderOptions = {}) {
    this.options = {
      readyTimeout: 5000,
      ...options,
    };
  }

  /**
   * Initialize the provider.
   * Waits for Pendo to be ready and sets up flag change detection.
   */
  async initialize(): Promise<void> {
    // Listen for pendo_ready to set up detection even if we timeout initially
    if (typeof document !== "undefined") {
      document.addEventListener(
        "pendo_ready",
        () => this.setupFlagChangeDetection(),
        { once: true }
      );
    }

    await this.waitForPendo();
    this.setupFlagChangeDetection();
    this.status = ClientProviderStatus.READY;
  }

  /**
   * Wait for Pendo to be ready with timeout.
   */
  private async waitForPendo(): Promise<void> {
    const timeout = this.options.readyTimeout;
    const startTime = Date.now();

    return new Promise((resolve) => {
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
          console.warn(
            "[PendoProvider] Pendo not ready within timeout. Flags will use default values."
          );
          resolve();
          return;
        }

        // Try again
        setTimeout(check, 100);
      };

      // Also listen for pendo_ready event
      if (typeof document !== "undefined") {
        document.addEventListener(
          "pendo_ready",
          () => resolve(),
          { once: true }
        );
      }

      check();
    });
  }

  /**
   * Set up detection for when segment flags change.
   * Listens for the segmentFlagsUpdated event from Pendo.
   * Idempotent - only runs once.
   */
  private setupFlagChangeDetection(): void {
    if (this.flagChangeDetectionSetup) {
      return;
    }

    if (typeof window === "undefined" || !window.pendo?.Events?.segmentFlagsUpdated) {
      return;
    }

    this.flagChangeDetectionSetup = true;

    // Create handler and store reference for cleanup
    this.flagChangeHandler = () => {
      this.events.emit(ProviderEvents.ConfigurationChanged);
    };

    // Subscribe to Pendo's segmentFlagsUpdated event
    window.pendo.Events.segmentFlagsUpdated.on(this.flagChangeHandler);
  }

  /**
   * Shutdown the provider.
   */
  async onClose(): Promise<void> {
    // Unsubscribe from Pendo events
    if (
      typeof window !== "undefined" &&
      window.pendo?.Events?.segmentFlagsUpdated &&
      this.flagChangeHandler
    ) {
      window.pendo.Events.segmentFlagsUpdated.off(this.flagChangeHandler);
    }

    this.status = ClientProviderStatus.NOT_READY;
    this.flagChangeHandler = null;
    this.flagChangeDetectionSetup = false;
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

    if (flags === null) {
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
   * Track a custom event in Pendo.
   *
   * Delegates to the Pendo Web SDK's track function.
   */
  track(
    trackingEventName: string,
    _context: EvaluationContext,
    trackingEventDetails: TrackingEventDetails
  ): void {
    if (typeof window === "undefined" || !window.pendo?.track) {
      console.warn("[PendoProvider] Pendo Web SDK not available for tracking");
      return;
    }

    // Convert TrackingEventDetails to Record<string, string> for Pendo Web SDK
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(trackingEventDetails)) {
      if (value !== undefined && value !== null) {
        properties[key] = String(value);
      }
    }

    window.pendo.track(trackingEventName, properties);
  }

  /**
   * Get the segment flags array from Pendo.
   * Returns null if Pendo is not available or flags haven't been loaded.
   */
  private getSegmentFlags(): string[] | null {
    if (typeof window === "undefined" || !window.pendo) {
      return null;
    }

    const flags = window.pendo.segmentFlags;

    // Return null if flags haven't been loaded yet (undefined)
    // Return the array (even if empty) if flags have been loaded
    return flags === undefined ? null : flags;
  }
}
