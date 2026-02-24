/**
 * @jest-environment jsdom
 */
import type { HookContext, EvaluationDetails, FlagValue } from '@openfeature/web-sdk';
import { PendoTelemetryHook } from '../src/PendoTelemetryHook';

describe('PendoTelemetryHook', () => {
  let hook: PendoTelemetryHook;
  let mockTrack: jest.Mock;

  beforeEach(() => {
    mockTrack = jest.fn();
    (window as any).pendo = {
      track: mockTrack,
    };

    hook = new PendoTelemetryHook();
  });

  afterEach(() => {
    delete (window as any).pendo;
    jest.restoreAllMocks();
  });

  const createHookContext = (overrides: Partial<HookContext<FlagValue>> = {}): HookContext<FlagValue> => ({
    flagKey: 'test-flag',
    defaultValue: false,
    flagValueType: 'boolean',
    context: {},
    clientMetadata: {
      name: 'test-client',
      providerMetadata: {
        name: 'pendo-provider',
      },
    },
    providerMetadata: {
      name: 'pendo-provider',
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
    it('calls pendo.track with correct properties', () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      hook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'flag_evaluated',
        {
          flag_key: 'test-flag',
          flag_variant: 'on',
          flag_reason: 'TARGETING_MATCH',
          flag_value: 'true',
          provider_name: 'pendo-provider',
        }
      );
    });

    it('uses custom event name when configured', () => {
      const customHook = new PendoTelemetryHook({
        eventName: 'custom_flag_event',
      });

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      customHook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'custom_flag_event',
        expect.any(Object)
      );
    });

    it('skips tracking when pendo.track is not available', () => {
      delete (window as any).pendo.track;

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      // Should not throw
      expect(() => hook.after(hookContext, evaluationDetails)).not.toThrow();
      expect(mockTrack).not.toHaveBeenCalled();
    });

    it('skips tracking when pendo is undefined', () => {
      delete (window as any).pendo;

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      expect(() => hook.after(hookContext, evaluationDetails)).not.toThrow();
    });

    it('skips tracking when window is undefined', () => {
      const originalWindow = global.window;
      delete (global as any).window;

      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      expect(() => hook.after(hookContext, evaluationDetails)).not.toThrow();

      (global as any).window = originalWindow;
    });
  });

  describe('flagFilter', () => {
    it('tracks flag when filter returns true', () => {
      const filterHook = new PendoTelemetryHook({
        flagFilter: (flagKey) => flagKey.startsWith('track-'),
      });

      const hookContext = createHookContext({ flagKey: 'track-this-flag' });
      const evaluationDetails = createEvaluationDetails({ flagKey: 'track-this-flag' });

      filterHook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalled();
    });

    it('skips tracking when filter returns false', () => {
      const filterHook = new PendoTelemetryHook({
        flagFilter: (flagKey) => flagKey.startsWith('track-'),
      });

      const hookContext = createHookContext({ flagKey: 'skip-this-flag' });
      const evaluationDetails = createEvaluationDetails({ flagKey: 'skip-this-flag' });

      filterHook.after(hookContext, evaluationDetails);

      expect(mockTrack).not.toHaveBeenCalled();
    });

    it('tracks all flags when no filter is configured', () => {
      const hookContext = createHookContext({ flagKey: 'any-flag' });
      const evaluationDetails = createEvaluationDetails({ flagKey: 'any-flag' });

      hook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalled();
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
    ])('stringifies %p to "%s"', (value, expected) => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ value });

      hook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'flag_evaluated',
        expect.objectContaining({
          flag_value: expected,
        })
      );
    });
  });

  describe('evaluation details handling', () => {
    it('uses "unknown" for missing variant', () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ variant: undefined });

      hook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'flag_evaluated',
        expect.objectContaining({
          flag_variant: 'unknown',
        })
      );
    });

    it('uses "UNKNOWN" for missing reason', () => {
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails({ reason: undefined });

      hook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'flag_evaluated',
        expect.objectContaining({
          flag_reason: 'UNKNOWN',
        })
      );
    });
  });

  describe('default options', () => {
    it('uses "flag_evaluated" as default event name', () => {
      const defaultHook = new PendoTelemetryHook();
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      defaultHook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalledWith(
        'flag_evaluated',
        expect.any(Object)
      );
    });

    it('works with empty options object', () => {
      const emptyOptionsHook = new PendoTelemetryHook({});
      const hookContext = createHookContext();
      const evaluationDetails = createEvaluationDetails();

      emptyOptionsHook.after(hookContext, evaluationDetails);

      expect(mockTrack).toHaveBeenCalled();
    });
  });
});
