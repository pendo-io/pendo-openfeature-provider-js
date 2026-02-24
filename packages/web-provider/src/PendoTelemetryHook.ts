import type {
  Hook,
  HookContext,
  EvaluationDetails,
  FlagValue,
} from "@openfeature/web-sdk";

export interface PendoTelemetryHookOptions {
  /**
   * Event name for flag evaluation tracking.
   * Default: "flag_evaluated"
   */
  eventName?: string;

  /**
   * Optional filter function to selectively track flags.
   * Return true to track the flag, false to skip.
   */
  flagFilter?: (flagKey: string) => boolean;
}

/**
 * OpenFeature hook that automatically tracks flag evaluations to Pendo.
 *
 * This hook sends an event to Pendo after each flag evaluation, allowing you
 * to analyze feature flag usage alongside your other Pendo analytics.
 *
 * The hook uses the Pendo agent's track function, so the Pendo agent must be
 * initialized on the page for tracking to work.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/web-sdk';
 * import { PendoProvider, PendoTelemetryHook } from '@pendo/openfeature-web-provider';
 *
 * const provider = new PendoProvider();
 * const telemetryHook = new PendoTelemetryHook();
 *
 * await OpenFeature.setProviderAndWait(provider);
 * OpenFeature.addHooks(telemetryHook);
 * ```
 */
export class PendoTelemetryHook implements Hook {
  private options: Required<Omit<PendoTelemetryHookOptions, "flagFilter">> & {
    flagFilter?: (flagKey: string) => boolean;
  };

  constructor(options: PendoTelemetryHookOptions = {}) {
    this.options = {
      eventName: "flag_evaluated",
      ...options,
    };
  }

  /**
   * Called after a flag is successfully evaluated.
   * Sends the evaluation result to Pendo as a track event.
   */
  after(
    hookContext: Readonly<HookContext<FlagValue>>,
    evaluationDetails: EvaluationDetails<FlagValue>
  ): void {
    const { flagKey } = hookContext;

    // Check if this flag should be tracked
    if (this.options.flagFilter && !this.options.flagFilter(flagKey)) {
      return;
    }

    // Check if Pendo agent is available
    if (typeof window === "undefined" || !window.pendo?.track) {
      return;
    }

    const properties: Record<string, string> = {
      flag_key: flagKey,
      flag_variant: evaluationDetails.variant || "unknown",
      flag_reason: evaluationDetails.reason || "UNKNOWN",
      flag_value: this.stringifyValue(evaluationDetails.value),
      provider_name: hookContext.providerMetadata.name,
    };

    // Fire-and-forget: delegate to Pendo agent
    window.pendo.track(this.options.eventName, properties);
  }

  /**
   * Convert a flag value to a string for tracking.
   */
  private stringifyValue(value: FlagValue): string {
    if (value === null) {
      return "null";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }
}
