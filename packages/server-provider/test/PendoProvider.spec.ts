import { PendoProvider } from '../src/PendoProvider';
import { ServerProviderStatus, ErrorCode } from '@openfeature/server-sdk';

describe('PendoProvider', () => {
  let provider: PendoProvider;
  let mockFetch: jest.Mock;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    originalFetch = global.fetch;
    global.fetch = mockFetch;

    provider = new PendoProvider({
      apiKey: 'test-api-key',
      defaultUrl: 'https://example.com',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has correct provider name', () => {
      expect(provider.metadata.name).toBe('pendo-server-provider');
    });
  });

  describe('initialize', () => {
    it('sets status to READY on success', async () => {
      expect(provider.status).toBe(ServerProviderStatus.NOT_READY);
      await provider.initialize();
      expect(provider.status).toBe(ServerProviderStatus.READY);
    });

    it('throws if apiKey is missing', async () => {
      const badProvider = new PendoProvider({
        apiKey: '',
        defaultUrl: 'https://example.com',
      });
      await expect(badProvider.initialize()).rejects.toThrow('Pendo API key is required');
    });

    it('throws if defaultUrl is missing', async () => {
      const badProvider = new PendoProvider({
        apiKey: 'test-key',
        defaultUrl: '',
      });
      await expect(badProvider.initialize()).rejects.toThrow('Pendo defaultUrl is required');
    });
  });

  describe('onClose', () => {
    it('sets status to NOT_READY and clears cache', async () => {
      await provider.initialize();
      expect(provider.status).toBe(ServerProviderStatus.READY);

      await provider.onClose();
      expect(provider.status).toBe(ServerProviderStatus.NOT_READY);
    });
  });

  describe('resolveBooleanEvaluation', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('returns true when flag is in segmentFlags', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-a', 'feature-b'] }),
      });

      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe('TARGETING_MATCH');
      expect(result.variant).toBe('on');
    });

    it('returns false when flag is not in segmentFlags', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-a', 'feature-b'] }),
      });

      const result = await provider.resolveBooleanEvaluation(
        'feature-c',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe('DEFAULT');
      expect(result.variant).toBe('off');
    });

    it('returns default value when no targetingKey provided', async () => {
      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        true,
        {}
      );

      expect(result.value).toBe(true);
      expect(result.reason).toBe('DEFAULT');
      expect(result.variant).toBe('default');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns default value with true default when no targetingKey', async () => {
      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        true,
        {}
      );

      expect(result.value).toBe(true);
    });
  });

  describe('API response handling', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('handles 200 response with flags', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['flag1', 'flag2'] }),
      });

      const result = await provider.resolveBooleanEvaluation(
        'flag1',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(true);
    });

    it('handles 202 response (visitor unknown)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 202,
        json: async () => ({}),
      });

      const result = await provider.resolveBooleanEvaluation(
        'any-flag',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false);
    });

    it('handles 451 response (opted out)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 451,
        json: async () => ({}),
      });

      const result = await provider.resolveBooleanEvaluation(
        'any-flag',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false);
    });

    it('handles 429 rate limit error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe('ERROR');
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
      expect(result.errorMessage).toContain('rate limit');
    });

    it('handles generic API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        false,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(false);
      expect(result.reason).toBe('ERROR');
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await provider.resolveBooleanEvaluation(
        'feature-a',
        true,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(true); // returns default
      expect(result.reason).toBe('ERROR');
      expect(result.errorCode).toBe(ErrorCode.GENERAL);
      expect(result.errorMessage).toBe('Network error');
    });
  });

  describe('resolveStringEvaluation', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('returns "on" when flag is enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-a'] }),
      });

      const result = await provider.resolveStringEvaluation(
        'feature-a',
        'default',
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe('on');
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns default when flag is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-b'] }),
      });

      const result = await provider.resolveStringEvaluation(
        'feature-a',
        'default-value',
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe('default-value');
      expect(result.reason).toBe('DEFAULT');
    });

    it('returns default when no targetingKey', async () => {
      const result = await provider.resolveStringEvaluation(
        'feature-a',
        'my-default',
        {}
      );

      expect(result.value).toBe('my-default');
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('resolveNumberEvaluation', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('returns 1 when flag is enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-a'] }),
      });

      const result = await provider.resolveNumberEvaluation(
        'feature-a',
        0,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(1);
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns 0 when flag is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-b'] }),
      });

      const result = await provider.resolveNumberEvaluation(
        'feature-a',
        0,
        { targetingKey: 'user-123' }
      );

      expect(result.value).toBe(0);
    });

    it('returns default when no targetingKey', async () => {
      const result = await provider.resolveNumberEvaluation(
        'feature-a',
        42,
        {}
      );

      expect(result.value).toBe(42);
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('resolveObjectEvaluation', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('returns { enabled: true } when flag is enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-a'] }),
      });

      const result = await provider.resolveObjectEvaluation(
        'feature-a',
        { enabled: false },
        { targetingKey: 'user-123' }
      );

      expect(result.value).toEqual({ enabled: true });
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns { enabled: false } when flag is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['feature-b'] }),
      });

      const result = await provider.resolveObjectEvaluation(
        'feature-a',
        { enabled: false },
        { targetingKey: 'user-123' }
      );

      expect(result.value).toEqual({ enabled: false });
    });

    it('returns default when no targetingKey', async () => {
      const result = await provider.resolveObjectEvaluation(
        'feature-a',
        { custom: 'value' },
        {}
      );

      expect(result.value).toEqual({ custom: 'value' });
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('caching', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('caches results for same visitor/account', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['flag1'] }),
      });

      // First call
      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
        accountId: 'account-456',
      });

      // Second call with same context
      await provider.resolveBooleanEvaluation('flag2', false, {
        targetingKey: 'user-123',
        accountId: 'account-456',
      });

      // Should only have made one API call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('makes separate calls for different visitors', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['flag1'] }),
      });

      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
      });

      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-456',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clearCache removes cached entries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['flag1'] }),
      });

      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
      });

      provider.clearCache();

      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('respects cache TTL expiration', async () => {
      const shortTtlProvider = new PendoProvider({
        apiKey: 'test-api-key',
        defaultUrl: 'https://example.com',
        cacheTtl: 100, // 100ms TTL
      });
      await shortTtlProvider.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: ['flag1'] }),
      });

      await shortTtlProvider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
      });

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      await shortTtlProvider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('track', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    it('sends track event to Pendo API', async () => {
      const trackProvider = new PendoProvider({
        apiKey: 'test-api-key',
        defaultUrl: 'https://example.com',
        trackEventSecret: 'test-secret',
      });

      mockFetch.mockResolvedValue({ ok: true });

      trackProvider.track(
        'button_clicked',
        { targetingKey: 'user-123', accountId: 'account-456' },
        { value: 42 }
      );

      // Allow fire-and-forget to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://data.pendo.io/data/track',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-pendo-track-event-secret': 'test-secret',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('track');
      expect(body.event).toBe('button_clicked');
      expect(body.visitorId).toBe('user-123');
      expect(body.accountId).toBe('account-456');
      expect(body.properties).toEqual({ value: 42 });
    });

    it('warns when trackEventSecret is not configured', () => {
      provider.track(
        'button_clicked',
        { targetingKey: 'user-123' },
        {}
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('trackEventSecret is required')
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('warns when targetingKey is not provided', () => {
      const trackProvider = new PendoProvider({
        apiKey: 'test-api-key',
        defaultUrl: 'https://example.com',
        trackEventSecret: 'test-secret',
      });

      trackProvider.track('button_clicked', {}, {});

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('targetingKey (visitorId) is required')
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('API request format', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('uses JZB encoding in API request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ segmentFlags: [] }),
      });

      await provider.resolveBooleanEvaluation('flag1', false, {
        targetingKey: 'user-123',
        accountId: 'account-456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/data\.pendo\.io\/data\/segmentflag\.json\/test-api-key\?jzb=/),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );

      // Verify JZB parameter is URL-safe
      const url = mockFetch.mock.calls[0][0];
      const jzbParam = new URL(url).searchParams.get('jzb');
      expect(jzbParam).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
