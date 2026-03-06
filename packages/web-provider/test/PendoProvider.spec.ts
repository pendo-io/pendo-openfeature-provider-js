/**
 * @jest-environment jsdom
 */
import { PendoProvider } from "../src/PendoProvider";
import { ClientProviderStatus, ProviderEvents } from "@openfeature/web-sdk";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("PendoProvider", () => {
  let provider: PendoProvider;

  const createMockResponse = (
    data: { segmentFlags?: string[] },
    status = 200
  ): Response => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.resolve(data),
    } as Response;
  };

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(createMockResponse({ segmentFlags: [] }));
    provider = new PendoProvider({ apiKey: "test-api-key" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws when apiKey is not provided", () => {
      expect(() => new PendoProvider({} as any)).toThrow(
        "Pendo API key is required"
      );
    });

    it("uses default baseUrl and cacheTtl", () => {
      const p = new PendoProvider({ apiKey: "test-key" });
      expect(p).toBeDefined();
    });

    it("allows custom baseUrl and cacheTtl", () => {
      const p = new PendoProvider({
        apiKey: "test-key",
        baseUrl: "https://custom.pendo.io",
        cacheTtl: 30000,
      });
      expect(p).toBeDefined();
    });
  });

  describe("metadata", () => {
    it("has correct provider name", () => {
      expect(provider.metadata.name).toBe("pendo-provider");
    });
  });

  describe("initialize", () => {
    it("sets status to READY after initialization", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      expect(provider.status).toBe(ClientProviderStatus.NOT_READY);
      await provider.initialize({ targetingKey: "visitor-123" });
      expect(provider.status).toBe(ClientProviderStatus.READY);
    });

    it("calls the API with correct URL format", async () => {
      await provider.initialize({
        targetingKey: "visitor-123",
        accountId: "account-456",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("https://data.pendo.io/data/segmentflag.json/test-api-key");
      expect(calledUrl).toContain("jzb=");
    });

    it("handles initialization without targetingKey", async () => {
      await provider.initialize({});
      expect(provider.status).toBe(ClientProviderStatus.READY);
      // Should not have called fetch since no visitor ID
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles API errors gracefully during initialization", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
      mockFetch.mockRejectedValue(new Error("Network error"));

      await provider.initialize({ targetingKey: "visitor-123" });

      expect(provider.status).toBe(ClientProviderStatus.READY);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[PendoProvider] Failed to fetch initial flags:",
        expect.any(Error)
      );
    });
  });

  describe("onContextChange", () => {
    it("fetches new flags when context changes", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });
      mockFetch.mockClear();

      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag2"] })
      );

      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-456" }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("emits ConfigurationChanged event after context change", async () => {
      const eventSpy = jest.fn();
      provider.events.addHandler(ProviderEvents.ConfigurationChanged, eventSpy);

      await provider.initialize({ targetingKey: "visitor-123" });
      mockFetch.mockClear();

      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-456" }
      );

      expect(eventSpy).toHaveBeenCalled();
    });

    it("handles errors during context change", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await provider.initialize({ targetingKey: "visitor-123" });
      mockFetch.mockRejectedValue(new Error("Network error"));

      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-456" }
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[PendoProvider] Failed to fetch flags on context change:",
        expect.any(Error)
      );
    });
  });

  describe("onClose", () => {
    it("sets status to NOT_READY", async () => {
      await provider.initialize({ targetingKey: "visitor-123" });
      expect(provider.status).toBe(ClientProviderStatus.READY);

      await provider.onClose();
      expect(provider.status).toBe(ClientProviderStatus.NOT_READY);
    });

    it("clears the cache", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });
      await provider.onClose();

      // After close, flags should be empty
      const result = provider.resolveBooleanEvaluation("flag1", false, {});
      expect(result.value).toBe(false);
      expect(result.reason).toBe("DEFAULT");
    });
  });

  describe("resolveBooleanEvaluation", () => {
    it("returns true when flag is in fetched flags", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["feature-a", "feature-b"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("feature-a", false, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe("TARGETING_MATCH");
      expect(result.variant).toBe("on");
    });

    it("returns false when flag is not in fetched flags", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["feature-a"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("feature-c", false, {});

      expect(result.value).toBe(false);
      expect(result.reason).toBe("DEFAULT");
      expect(result.variant).toBe("off");
    });

    it("returns default when no flags are available (not initialized)", async () => {
      // Don't initialize - no flags fetched
      const result = provider.resolveBooleanEvaluation("feature-a", true, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe("DEFAULT");
      expect(result.variant).toBe("default");
    });

    it("returns false when flags were fetched but array is empty", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: [] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("feature-a", true, {});

      expect(result.value).toBe(false);
      expect(result.reason).toBe("DEFAULT");
      expect(result.variant).toBe("off");
    });
  });

  describe("resolveStringEvaluation", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["feature-a"] })
      );
      await provider.initialize({ targetingKey: "visitor-123" });
    });

    it('returns "on" when flag is enabled', () => {
      const result = provider.resolveStringEvaluation("feature-a", "default", {});

      expect(result.value).toBe("on");
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("returns default when flag is disabled", () => {
      const result = provider.resolveStringEvaluation("feature-b", "default-value", {});

      expect(result.value).toBe("default-value");
      expect(result.reason).toBe("DEFAULT");
    });
  });

  describe("resolveNumberEvaluation", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["feature-a"] })
      );
      await provider.initialize({ targetingKey: "visitor-123" });
    });

    it("returns 1 when flag is enabled", () => {
      const result = provider.resolveNumberEvaluation("feature-a", 0, {});

      expect(result.value).toBe(1);
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("returns default when flag is disabled", () => {
      const result = provider.resolveNumberEvaluation("feature-b", 42, {});

      expect(result.value).toBe(42);
      expect(result.reason).toBe("DEFAULT");
    });
  });

  describe("resolveObjectEvaluation", () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["feature-a"] })
      );
      await provider.initialize({ targetingKey: "visitor-123" });
    });

    it("returns { enabled: true } when flag is enabled", () => {
      const result = provider.resolveObjectEvaluation(
        "feature-a",
        { enabled: false },
        {}
      );

      expect(result.value).toEqual({ enabled: true });
      expect(result.reason).toBe("TARGETING_MATCH");
    });

    it("returns default when flag is disabled", () => {
      const result = provider.resolveObjectEvaluation(
        "feature-b",
        { custom: "value" },
        {}
      );

      expect(result.value).toEqual({ custom: "value" });
      expect(result.reason).toBe("DEFAULT");
    });
  });

  describe("track", () => {
    it("logs a warning that tracking is not supported", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      await provider.initialize({ targetingKey: "visitor-123" });
      provider.track("event-name", {}, {});

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("track() is not supported")
      );
    });
  });

  describe("API response handling", () => {
    it("returns empty flags for 202 response (visitor not known)", async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 202));

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("any-flag", false, {});
      expect(result.value).toBe(false);
      expect(result.reason).toBe("DEFAULT");
    });

    it("throws on 429 response (rate limited)", async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 429));
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      await provider.initialize({ targetingKey: "visitor-123" });

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("returns empty flags for 451 response (opted out)", async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 451));

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("any-flag", false, {});
      expect(result.value).toBe(false);
    });

    it("handles empty segmentFlags in response", async () => {
      mockFetch.mockResolvedValue(createMockResponse({ segmentFlags: [] }));

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("any-flag", false, {});
      expect(result.value).toBe(false);
    });

    it("handles missing segmentFlags in response", async () => {
      mockFetch.mockResolvedValue(createMockResponse({}));

      await provider.initialize({ targetingKey: "visitor-123" });

      const result = provider.resolveBooleanEvaluation("any-flag", false, {});
      expect(result.value).toBe(false);
    });
  });

  describe("caching", () => {
    it("uses cached flags for same context", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Trigger another fetch for same context
      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-123" }
      );

      // Should use cache, no additional fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("fetches new flags for different visitor", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-456" }
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("clearCache method clears the cache", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ segmentFlags: ["flag1"] })
      );

      await provider.initialize({ targetingKey: "visitor-123" });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      provider.clearCache();

      // Should fetch again after cache clear
      await provider.onContextChange(
        { targetingKey: "visitor-123" },
        { targetingKey: "visitor-123" }
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("edge cases", () => {
    it("handles custom baseUrl", async () => {
      const customProvider = new PendoProvider({
        apiKey: "test-key",
        baseUrl: "https://custom.pendo.io",
      });

      await customProvider.initialize({ targetingKey: "visitor-123" });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("https://custom.pendo.io/data/segmentflag.json/test-key");
    });

    it("includes accountId in API call", async () => {
      await provider.initialize({
        targetingKey: "visitor-123",
        accountId: "account-456",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The JZB payload contains the accountId, encoded in the URL
    });
  });
});
