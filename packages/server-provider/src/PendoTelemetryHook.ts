import type {
  Hook,
  HookContext,
  EvaluationDetails,
  FlagValue,
} from "@openfeature/server-sdk";
import { PendoRuntimeError, isTransientStatus, reportRuntimeError } from "./errors";
import type { PendoErrorHandler } from "./errors";

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

  /**
   * Track event secret for server-side track events.
   * Required for the hook to send events to Pendo.
   */
  trackEventSecret: string;

  /**
   * Pendo data host URL.
   * Default: https://data.pendo.io
   */
  baseUrl?: string;

  /**
   * Handler for runtime failures (network errors, HTTP errors, unparseable
   * responses). When set, these are not written to the console; when unset,
   * they are console.error'd. Configuration mistakes are always console.warn'd.
   * If the handler throws or rejects, its error and the original are console.error'd.
   */
  onError?: PendoErrorHandler;
}

/**
 * OpenFeature hook that automatically tracks flag evaluations to Pendo.
 *
 * This hook sends an event to Pendo after each flag evaluation, allowing you
 * to analyze feature flag usage alongside your other Pendo analytics.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/server-sdk';
 * import { PendoProvider, PendoTelemetryHook } from '@pendo/openfeature-server-provider';
 *
 * const provider = new PendoProvider({
 *   apiKey: process.env.PENDO_API_KEY!,
 *   defaultUrl: 'https://myapp.example.com',
 * });
 *
 * const telemetryHook = new PendoTelemetryHook({
 *   trackEventSecret: process.env.PENDO_TRACK_SECRET!,
 * });
 *
 * OpenFeature.setProvider(provider);
 * OpenFeature.addHooks(telemetryHook);
 * ```
 */
export class PendoTelemetryHook implements Hook {
  private options: Required<
    Omit<PendoTelemetryHookOptions, "flagFilter" | "onError">
  > & {
    flagFilter?: (flagKey: string) => boolean;
    onError?: PendoErrorHandler;
  };

  constructor(options: PendoTelemetryHookOptions) {
    this.options = {
      eventName: "flag_evaluated",
      baseUrl: "https://data.pendo.io",
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

    const visitorId = hookContext.context.targetingKey;
    if (!visitorId) {
      // Can't track without a visitor ID
      return;
    }

    const accountId = hookContext.context.accountId as string | undefined;

    const properties = {
      flag_key: flagKey,
      flag_variant: evaluationDetails.variant || "unknown",
      flag_reason: evaluationDetails.reason || "UNKNOWN",
      flag_value: this.stringifyValue(evaluationDetails.value),
      provider_name: hookContext.providerMetadata.name,
    };

    const payload = {
      type: "track",
      event: this.options.eventName,
      visitorId,
      accountId,
      timestamp: Date.now(),
      properties,
    };

    // Fire-and-forget: don't await
    fetch(`${this.options.baseUrl}/data/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-track-event-secret": this.options.trackEventSecret,
      },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) {
          this.report(
            new PendoRuntimeError({
              message: `Pendo telemetry request failed: ${response.status} ${response.statusText}`,
              source: "telemetry",
              status: response.status,
              transient: isTransientStatus(response.status),
            })
          );
        }
      })
      .catch((error) => {
        this.report(
          new PendoRuntimeError({
            message: "Pendo telemetry request failed",
            source: "telemetry",
            transient: true,
            cause: error,
          })
        );
      });
  }

  private report(error: PendoRuntimeError): void {
    reportRuntimeError(error, this.options.onError, "[PendoTelemetryHook]");
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
