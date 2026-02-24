import type { HookContext, EvaluationDetails, FlagValue } from '@openfeature/server-sdk';
import { PendoTelemetryHook } from '../src/PendoTelemetryHook';

describe('PendoTelemetryHook', () => {
  let hook: PendoTelemetryHook;
  let mockFetch: jest.Mock;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    originalFetch = global.fetch;
    global.fetch = mockFetch;

    hook = new PendoTelemetryHook({
      trackEventSecret: 'test-secret',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const createHookContext = (overrides: Partial<HookContext<FlagValue>> = {}): HookContext<FlagValue> => ({
    flagKey: 'test-flag',
    defaultValue: false,
    flagValueType: 'boolean',
    context: {
      targetingKey: 'user-123',
    },
    clientMetadata: {
      name: 'test-client',
      providerMetadata: {
        name: 'pendo-server-provider',
      },
    },
    providerMetadata: {
      name: 'pendo-server-provider',
    },
    logger: console,
    hookData: {},
    ...overrides,
  } as HookContext<FlagValue>);

  const createEvaluationDetails = (overrides: Partial<EvaluationDetails<FlagValue>> = {}): EvaluationDetails<FlagValue> => ({
    value: true,
    variant: 'on',
    reason: 'TARGETING_MATCH',
    flagKey: 'test-flag',
    flagMetadata: {},
    ...overrides,
  });

  describe('after hook', () => {
    it('sends track event to Pendo API', async () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      hook.after(hookContext, evaluationDetails);

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
      expect(body.event).toBe('flag_evaluated');
      expect(body.visitorId).toBe('user-123');
      expect(body.properties).toEqual({
        flag_key: 'test-flag',
        flag_variant: 'on',
        flag_reason: 'TARGETING_MATCH',
        flag_value: 'true',
        provider_name: 'pendo-server-provider',
      });
    });

    it('includes accountId when provided', async () => {
      const hookContext = createHookContext({
        context: {
          targetingKey: 'user-123',
          accountId: 'account-456',
        },
      });
      const evaluationDetails = createEvaluationDetails();

      hook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.accountId).toBe('account-456');
    });

    it('skips tracking when no targetingKey', () => {
      const hookContext = createHookContext({
        context: {},
      });
      const evaluationDetails = createEvaluationDetails();

      hook.after(hookContext, evaluationDetails);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses custom event name when configured', async () => {
      const customHook = new PendoTelemetryHook({
        trackEventSecret: 'test-secret',
        eventName: 'custom_flag_event',
      });

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      customHook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event).toBe('custom_flag_event');
    });

    it('uses custom baseUrl when configured', async () => {
      const customHook = new PendoTelemetryHook({
        trackEventSecret: 'test-secret',
        baseUrl: 'https://custom.pendo.io',
      });

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      customHook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.pendo.io/data/track',
        expect.anything()
      );
    });
  });

  describe('flagFilter', () => {
    it('tracks flag when filter returns true', async () => {
      const filterHook = new PendoTelemetryHook({
        trackEventSecret: 'test-secret',
        flagFilter: (flagKey) => flagKey.startsWith('track-'),
      });

      const hookContext = createHookContext({ flagKey: 'track-this-flag' });
      const evaluationDetails = createEvaluationDetails({ flagKey: 'track-this-flag' });

      filterHook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalled();
    });

    it('skips tracking when filter returns false', () => {
      const filterHook = new PendoTelemetryHook({
        trackEventSecret: 'test-secret',
        flagFilter: (flagKey) => flagKey.startsWith('track-'),
      });

      const hookContext = createHookContext({ flagKey: 'skip-this-flag' });
      const evaluationDetails = createEvaluationDetails({ flagKey: 'skip-this-flag' });

      filterHook.after(hookContext, evaluationDetails);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('value stringification', () => {
    it.each([
      [true, 'true'],
      [false, 'false'],
      ['on', 'on'],
      ['off', 'off'],
      [1, '1'],
      [0, '0'],
      [42, '42'],
      [null, 'null'],
      [{ enabled: true }, '{"enabled":true}'],
      [{ nested: { value: 123 } }, '{"nested":{"value":123}}'],
    ])('stringifies %p to "%s"', async (value, expected) => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ value });

      hook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.properties.flag_value).toBe(expected);
    });
  });

  describe('error handling', () => {
    it('handles fetch errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockFetch.mockRejectedValue(new Error('Network error'));

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      // Should not throw
      expect(() => hook.after(hookContext, evaluationDetails)).not.toThrow();

      // Allow fire-and-forget to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[PendoTelemetryHook] Failed to track flag evaluation:',
        expect.any(Error)
      );
    });
  });

  describe('evaluation details handling', () => {
    it('uses "unknown" for missing variant', async () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ variant: undefined });

      hook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.properties.flag_variant).toBe('unknown');
    });

    it('uses "UNKNOWN" for missing reason', async () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ reason: undefined });

      hook.after(hookContext, evaluationDetails);

      await new Promise(resolve => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.properties.flag_reason).toBe('UNKNOWN');
    });
  });
});
