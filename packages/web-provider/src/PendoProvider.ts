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
import { encodeJzb } from "./jzb";
import "./types";

export interface PendoProviderOptions {
  /**
   * Pendo API key. Required for API-based flag evaluation.
   */
  apiKey: string;

  /**
   * Pendo data host URL.
   * Default: https://data.pendo.io
   */
  baseUrl?: string;

  /**
   * Cache TTL in milliseconds for segment flags.
   * Default: 60000 (1 minute)
   */
  cacheTtl?: number;
}

interface CacheEntry {
  flags: string[];
  expiresAt: number;
}

/**
 * OpenFeature provider for Pendo feature flags.
 *
 * This provider evaluates feature flags by calling the Pendo API directly
 * to check segment membership for a given visitor/account context.
 *
 * @example
 * ```typescript
 * import { OpenFeature } from '@openfeature/web-sdk';
 * import { PendoProvider } from '@pendo/openfeature-web-provider';
 *
 * // Set context first (required for API call)
 * await OpenFeature.setContext({
 *   targetingKey: user.id,    // visitorId (required)
 *   accountId: org.id,        // accountId (optional)
 * });
 *
 * // Initialize provider with API key
 * await OpenFeature.setProviderAndWait(new PendoProvider({
 *   apiKey: 'your-pendo-api-key',
 * }));
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
  private cache: Map<string, CacheEntry> = new Map();
  private currentFlags: string[] | null = null;

  constructor(options: PendoProviderOptions) {
    if (!options.apiKey) {
      throw new Error("Pendo API key is required");
    }

    this.options = {
      baseUrl: "https://data.pendo.io",
      cacheTtl: 60000,
      ...options,
    };
  }

  /**
   * Initialize the provider.
   * Fetches initial flags based on the current context.
   */
  async initialize(context: EvaluationContext): Promise<void> {
    try {
      await this.fetchAndCacheFlags(context);
      this.status = ClientProviderStatus.READY;
    } catch (error) {
      // Log error but don't fail initialization
      // Flags will return defaults until successful fetch
      console.warn("[PendoProvider] Failed to fetch initial flags:", error);
      this.status = ClientProviderStatus.READY;
    }
  }

  /**
   * Handle context changes by re-fetching flags.
   * Called by the SDK when OpenFeature.setContext() is called.
   */
  async onContextChange(
    _oldContext: EvaluationContext,
    newContext: EvaluationContext
  ): Promise<void> {
    try {
      await this.fetchAndCacheFlags(newContext);
      // Emit configuration changed event so React/Angular SDKs re-render
      this.events.emit(ProviderEvents.ConfigurationChanged);
    } catch (error) {
      console.error("[PendoProvider] Failed to fetch flags on context change:", error);
      // Don't emit error event - just keep using cached/default values
    }
  }

  /**
   * Shutdown the provider.
   */
  async onClose(): Promise<void> {
    this.status = ClientProviderStatus.NOT_READY;
    this.cache.clear();
    this.currentFlags = null;
  }

  /**
   * Resolve a boolean flag value.
   *
   * Checks if the flagKey exists in the fetched segment flags.
   */
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext
  ): ResolutionDetails<boolean> {
    if (this.currentFlags === null) {
      return {
        value: defaultValue,
        reason: "DEFAULT",
        variant: "default",
      };
    }

    const enabled = this.currentFlags.includes(flagKey);

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
   * Track a custom event.
   *
   * Note: Server-side tracking requires a track event secret. For web usage,
   * consider using the Pendo Web SDK's track function directly if available.
   */
  track(
    trackingEventName: string,
    _context: EvaluationContext,
    _trackingEventDetails: TrackingEventDetails
  ): void {
    // Web provider doesn't support server-side tracking
    // Users should use window.pendo.track() directly if the agent is available
    console.warn(
      "[PendoProvider] track() is not supported in the web provider. " +
        "Use window.pendo.track() if the Pendo agent is loaded."
    );
  }

  /**
   * Fetch and cache flags for the given context.
   */
  private async fetchAndCacheFlags(context: EvaluationContext): Promise<void> {
    const visitorId = context.targetingKey;
    const accountId = context.accountId as string | undefined;

    if (!visitorId) {
      // No visitor ID - can't fetch flags
      this.currentFlags = null;
      return;
    }

    // Check cache
    const cacheKey = `${visitorId}:${accountId || ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.currentFlags = cached.flags;
      return;
    }

    // Fetch from API
    const flags = await this.fetchSegmentFlags(visitorId, accountId);

    // Cache the result
    this.cache.set(cacheKey, {
      flags,
      expiresAt: Date.now() + this.options.cacheTtl,
    });

    this.currentFlags = flags;
  }

  /**
   * Fetch segment flags from Pendo API using JZB-encoded payload.
   */
  private async fetchSegmentFlags(
    visitorId: string,
    accountId?: string
  ): Promise<string[]> {
    const jzbPayload = encodeJzb({
      visitorId,
      accountId,
      url: typeof window !== "undefined" ? window.location.href : "",
    });

    const url = `${this.options.baseUrl}/data/segmentflag.json/${this.options.apiKey}?jzb=${jzbPayload}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    // Handle Pendo-specific status codes
    if (response.status === 202) {
      // Visitor not yet known to Pendo, return empty flags
      return [];
    }

    if (response.status === 429) {
      throw new Error("Pendo API rate limit exceeded");
    }

    if (response.status === 451) {
      // Visitor has opted out or is blocked
      return [];
    }

    if (!response.ok) {
      throw new Error(`Pendo API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { segmentFlags?: string[] };

    // Response format: { segmentFlags: ["flag1", "flag2"] }
    return data.segmentFlags || [];
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
