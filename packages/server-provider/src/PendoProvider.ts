import type {
  Provider,
  ProviderMetadata,
  ResolutionDetails,
  EvaluationContext,
  JsonValue,
  Hook,
  TrackingEventDetails,
} from "@openfeature/server-sdk";
import { ServerProviderStatus, ErrorCode } from "@openfeature/server-sdk";
import { encodeJzb } from "./jzb";
import { PendoRuntimeError, isTransientStatus, reportRuntimeError } from "./errors";
import type { PendoErrorHandler } from "./errors";

export interface PendoProviderOptions {
  /**
   * Pendo API key for server-side evaluation.
   */
  apiKey: string;

  /**
   * The URL of the page being evaluated. Required for server-side evaluation
   * since there's no browser context.
   */
  defaultUrl: string;

  /**
   * Pendo data host URL.
   * Default: https://data.pendo.io
   */
  baseUrl?: string;

  /**
   * Cache TTL in milliseconds for segment membership.
   * Default: 60000 (1 minute)
   */
  cacheTtl?: number;

  /**
   * Track event secret for server-side track events.
   * Required to use the track() method.
   */
  trackEventSecret?: string;

  /**
   * Handler for runtime failures (network errors, HTTP errors, unparseable
   * responses). When set, these are not written to the console; when unset,
   * they are console.error'd. Configuration mistakes are always console.warn'd.
   * If the handler throws or rejects, its error and the original are console.error'd.
   */
  onError?: PendoErrorHandler;
}

interface CacheEntry {
  flags: string[];
  expiresAt: number;
}

interface SegmentFlagResponse {
  /** Live shape: map of flag name to enabled state. */
  flags?: Record<string, boolean>;
  /** Legacy shape: array of enabled flag names. */
  segmentFlags?: string[];
  hash?: string;
}

/**
 * OpenFeature provider for Pendo feature flags (server-side).
 *
 * This provider evaluates feature flags by calling the Pendo API to check
 * segment membership for a given visitor/account context.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/server-sdk';
 * import { PendoProvider } from '@pendo/openfeature-server-provider';
 *
 * const pendoProvider = new PendoProvider({
 *   apiKey: process.env.PENDO_API_KEY!,
 *   defaultUrl: 'https://myapp.example.com',
 *   trackEventSecret: process.env.PENDO_TRACK_SECRET,
 * });
 *
 * OpenFeature.setProvider(pendoProvider);
 *
 * const client = OpenFeature.getClient();
 * const enabled = await client.getBooleanValue('myFeature', false, {
 *   targetingKey: 'user-123',
 *   accountId: 'account-456',
 * });
 *
 * // Track a custom event
 * client.track('feature_used', { targetingKey: 'user-123' }, { value: 1 });
 * ```
 */
export class PendoProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    name: "pendo-server-provider",
  };

  readonly rulesChanged?: () => void;
  status: ServerProviderStatus = ServerProviderStatus.NOT_READY;
  hooks?: Hook[];

  private options: Required<
    Omit<PendoProviderOptions, "trackEventSecret" | "onError">
  > & {
    trackEventSecret?: string;
    onError?: PendoErrorHandler;
  };
  private cache: Map<string, CacheEntry> = new Map();

  constructor(options: PendoProviderOptions) {
    this.options = {
      baseUrl: "https://data.pendo.io",
      cacheTtl: 60000,
      ...options,
    };
  }

  /**
   * Initialize the provider.
   */
  async initialize(): Promise<void> {
    if (!this.options.apiKey) {
      throw new Error("Pendo API key is required");
    }

    if (!this.options.defaultUrl) {
      throw new Error("Pendo defaultUrl is required for server-side evaluation");
    }

    this.status = ServerProviderStatus.READY;
  }

  /**
   * Shutdown the provider.
   */
  async onClose(): Promise<void> {
    this.status = ServerProviderStatus.NOT_READY;
    this.cache.clear();
  }

  /**
   * Track a custom event in Pendo.
   *
   * This method sends a track event to Pendo's server-side tracking endpoint.
   * Requires `trackEventSecret` to be configured.
   *
   * @param trackingEventName - The name of the event to track
   * @param context - Evaluation context containing targetingKey (visitorId) and optional accountId
   * @param trackingEventDetails - Optional additional event properties
   */
  track(
    trackingEventName: string,
    context: EvaluationContext,
    trackingEventDetails: TrackingEventDetails
  ): void {
    if (!this.options.trackEventSecret) {
      console.warn("[PendoProvider] trackEventSecret is required to track events");
      return;
    }

    const visitorId = context.targetingKey;
    if (!visitorId) {
      console.warn("[PendoProvider] targetingKey (visitorId) is required to track events");
      return;
    }

    const accountId = context.accountId as string | undefined;

    const payload = {
      type: "track",
      event: trackingEventName,
      visitorId,
      accountId,
      timestamp: Date.now(),
      properties: trackingEventDetails,
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
              message: `Pendo track request failed: ${response.status} ${response.statusText}`,
              source: "track",
              status: response.status,
              transient: isTransientStatus(response.status),
            })
          );
        }
      })
      .catch((error) => {
        this.report(
          new PendoRuntimeError({
            message: "Pendo track request failed",
            source: "track",
            transient: true,
            cause: error,
          })
        );
      });
  }

  /**
   * Resolve a boolean flag value.
   */
  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext
  ): Promise<ResolutionDetails<boolean>> {
    try {
      const flags = await this.getSegmentFlags(context);

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
    } catch (error) {
      const err =
        error instanceof PendoRuntimeError
          ? error
          : new PendoRuntimeError({
              message: error instanceof Error ? error.message : "Unknown error",
              source: "segmentflag",
              transient: false,
              cause: error,
            });
      this.report(err);
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: ErrorCode.GENERAL,
        // Failures with an underlying error surface that error's message.
        errorMessage: err.cause instanceof Error ? err.cause.message : err.message,
      };
    }
  }

  /**
   * Resolve a string flag value.
   */
  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): Promise<ResolutionDetails<string>> {
    const boolResult = await this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "ERROR") {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: boolResult.errorCode,
        errorMessage: boolResult.errorMessage,
      };
    }

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
   */
  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext
  ): Promise<ResolutionDetails<number>> {
    const boolResult = await this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "ERROR") {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: boolResult.errorCode,
        errorMessage: boolResult.errorMessage,
      };
    }

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
   */
  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext
  ): Promise<ResolutionDetails<T>> {
    const boolResult = await this.resolveBooleanEvaluation(flagKey, false, context);

    if (boolResult.reason === "ERROR") {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: boolResult.errorCode,
        errorMessage: boolResult.errorMessage,
      };
    }

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
   * Get segment flags for a given context.
   * Results are cached based on visitor/account ID.
   */
  private async getSegmentFlags(context: EvaluationContext): Promise<string[] | null> {
    const visitorId = context.targetingKey;
    const accountId = context.accountId as string | undefined;

    if (!visitorId) {
      console.warn("[PendoProvider] No targetingKey (visitor ID) provided in context");
      return null;
    }

    // Check cache
    const cacheKey = `${visitorId}:${accountId || ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.flags;
    }

    // Fetch from Pendo API
    const flags = await this.fetchSegmentFlags(visitorId, accountId);

    // Cache the result
    this.cache.set(cacheKey, {
      flags,
      expiresAt: Date.now() + this.options.cacheTtl,
    });

    return flags;
  }

  /**
   * Fetch segment flags from Pendo API using JZB-encoded payload.
   *
   * Uses the /data/segmentflag.json/:apiKey endpoint with JZB encoding.
   */
  private async fetchSegmentFlags(
    visitorId: string,
    accountId?: string
  ): Promise<string[]> {
    const jzbPayload = encodeJzb({
      visitorId,
      accountId,
      url: this.options.defaultUrl,
    });

    const url = `${this.options.baseUrl}/data/segmentflag.json/${this.options.apiKey}?jzb=${jzbPayload}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error) {
      throw new PendoRuntimeError({
        message: "Pendo segmentflag request failed",
        source: "segmentflag",
        transient: true,
        cause: error,
      });
    }

    // Handle Pendo-specific status codes
    if (response.status === 202) {
      // Visitor not yet known to Pendo, return empty flags
      return [];
    }

    if (response.status === 429) {
      throw new PendoRuntimeError({
        message: "Pendo API rate limit exceeded",
        source: "segmentflag",
        status: 429,
        transient: true,
      });
    }

    if (response.status === 451) {
      // Visitor has opted out or is blocked
      return [];
    }

    if (!response.ok) {
      throw new PendoRuntimeError({
        message: `Pendo API error: ${response.status} ${response.statusText}`,
        source: "segmentflag",
        status: response.status,
        transient: isTransientStatus(response.status),
      });
    }

    let data: SegmentFlagResponse;
    try {
      data = (await response.json()) as SegmentFlagResponse;
    } catch (error) {
      // json() throws SyntaxError for malformed JSON; anything else is a body read failure.
      const malformed = error instanceof SyntaxError;
      throw new PendoRuntimeError({
        message: malformed
          ? "Pendo segmentflag response could not be parsed"
          : "Pendo segmentflag response body could not be read",
        source: "segmentflag",
        status: response.status,
        transient: !malformed,
        cause: error,
      });
    }

    if (data.flags) {
      return Object.entries(data.flags)
        .filter(([, enabled]) => enabled === true)
        .map(([flagName]) => flagName);
    }

    return data.segmentFlags || [];
  }

  private report(error: PendoRuntimeError): void {
    reportRuntimeError(error, this.options.onError, "[PendoProvider]");
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
