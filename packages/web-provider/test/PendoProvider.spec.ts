/**
 * @jest-environment jsdom
 */
import { PendoProvider } from '../src/PendoProvider';
import { ClientProviderStatus } from '@openfeature/web-sdk';

describe('PendoProvider', () => {
  let provider: PendoProvider;

  beforeEach(() => {
    // Reset window.pendo
    delete (window as any).pendo;
    provider = new PendoProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('metadata', () => {
    it('has correct provider name', () => {
      expect(provider.metadata.name).toBe('pendo-provider');
    });
  });

  describe('initialize', () => {
    it('sets status to READY when pendo.isReady() returns true', async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: ['flag1'],
      };

      expect(provider.status).toBe(ClientProviderStatus.NOT_READY);
      await provider.initialize();
      expect(provider.status).toBe(ClientProviderStatus.READY);
    });

    it('sets status to READY when segmentFlags is defined', async () => {
      (window as any).pendo = {
        segmentFlags: ['flag1'],
      };

      await provider.initialize();
      expect(provider.status).toBe(ClientProviderStatus.READY);
    });

    it('handles pendo:ready event', async () => {
      (window as any).pendo = {};

      const initPromise = provider.initialize();

      // Simulate pendo:ready event after a short delay
      setTimeout(() => {
        document.dispatchEvent(new Event('pendo:ready'));
      }, 50);

      await initPromise;
      expect(provider.status).toBe(ClientProviderStatus.READY);
    });

    it('times out gracefully when pendo is not ready', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const shortTimeoutProvider = new PendoProvider({
        readyTimeout: 100,
      });

      await shortTimeoutProvider.initialize();

      expect(provider.status).toBe(ClientProviderStatus.NOT_READY);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pendo not ready within timeout')
      );
    });

    it('only initializes once', async () => {
      (window as any).pendo = {
        isReady: () => true,
      };

      await provider.initialize();
      await provider.initialize();

      expect(provider.status).toBe(ClientProviderStatus.READY);
    });
  });

  describe('onClose', () => {
    it('sets status to NOT_READY', async () => {
      (window as any).pendo = { isReady: () => true };

      await provider.initialize();
      expect(provider.status).toBe(ClientProviderStatus.READY);

      await provider.onClose();
      expect(provider.status).toBe(ClientProviderStatus.NOT_READY);
    });
  });

  describe('resolveBooleanEvaluation', () => {
    beforeEach(async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: ['feature-a', 'feature-b'],
      };
      await provider.initialize();
    });

    it('returns true when flag is in segmentFlags', () => {
      const result = provider.resolveBooleanEvaluation('feature-a', false, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe('TARGETING_MATCH');
      expect(result.variant).toBe('on');
    });

    it('returns false when flag is not in segmentFlags', () => {
      const result = provider.resolveBooleanEvaluation('feature-c', false, {});

      expect(result.value).toBe(false);
      expect(result.reason).toBe('DEFAULT');
      expect(result.variant).toBe('off');
    });

    it('returns default when pendo is undefined', () => {
      delete (window as any).pendo;

      const result = provider.resolveBooleanEvaluation('feature-a', true, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe('DEFAULT');
      expect(result.variant).toBe('default');
    });

    it('returns default when segmentFlags is undefined', () => {
      (window as any).pendo = { isReady: () => true };

      const result = provider.resolveBooleanEvaluation('feature-a', true, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('resolveStringEvaluation', () => {
    beforeEach(async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: ['feature-a'],
      };
      await provider.initialize();
    });

    it('returns "on" when flag is enabled', () => {
      const result = provider.resolveStringEvaluation('feature-a', 'default', {});

      expect(result.value).toBe('on');
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns default when flag is disabled', () => {
      const result = provider.resolveStringEvaluation('feature-b', 'default-value', {});

      expect(result.value).toBe('default-value');
      expect(result.reason).toBe('DEFAULT');
    });

    it('returns default when pendo is unavailable', () => {
      delete (window as any).pendo;

      const result = provider.resolveStringEvaluation('feature-a', 'my-default', {});

      expect(result.value).toBe('my-default');
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('resolveNumberEvaluation', () => {
    beforeEach(async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: ['feature-a'],
      };
      await provider.initialize();
    });

    it('returns 1 when flag is enabled', () => {
      const result = provider.resolveNumberEvaluation('feature-a', 0, {});

      expect(result.value).toBe(1);
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns 0 when flag is disabled', () => {
      const result = provider.resolveNumberEvaluation('feature-b', 0, {});

      expect(result.value).toBe(0);
    });

    it('returns default when pendo is unavailable', () => {
      delete (window as any).pendo;

      const result = provider.resolveNumberEvaluation('feature-a', 42, {});

      expect(result.value).toBe(42);
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('resolveObjectEvaluation', () => {
    beforeEach(async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: ['feature-a'],
      };
      await provider.initialize();
    });

    it('returns { enabled: true } when flag is enabled', () => {
      const result = provider.resolveObjectEvaluation('feature-a', { enabled: false }, {});

      expect(result.value).toEqual({ enabled: true });
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('returns { enabled: false } when flag is disabled', () => {
      const result = provider.resolveObjectEvaluation('feature-b', { enabled: false }, {});

      expect(result.value).toEqual({ enabled: false });
    });

    it('returns default when pendo is unavailable', () => {
      delete (window as any).pendo;

      const result = provider.resolveObjectEvaluation('feature-a', { custom: 'value' }, {});

      expect(result.value).toEqual({ custom: 'value' });
      expect(result.reason).toBe('DEFAULT');
    });
  });

  describe('track', () => {
    let mockTrack: jest.Mock;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(async () => {
      mockTrack = jest.fn();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: [],
        track: mockTrack,
      };
      await provider.initialize();
    });

    it('delegates to pendo.track', () => {
      provider.track(
        'button_clicked',
        { targetingKey: 'user-123' },
        { value: 42 }
      );

      expect(mockTrack).toHaveBeenCalledWith(
        'button_clicked',
        { value: '42' }
      );
    });

    it('converts properties to strings', () => {
      provider.track(
        'event',
        {},
        {
          stringProp: 'hello',
          numberProp: 123,
          boolProp: true,
        }
      );

      expect(mockTrack).toHaveBeenCalledWith(
        'event',
        {
          stringProp: 'hello',
          numberProp: '123',
          boolProp: 'true',
        }
      );
    });

    it('omits null and undefined properties', () => {
      provider.track(
        'event',
        {},
        {
          valid: 'value',
          nullProp: null,
          undefinedProp: undefined,
        } as any
      );

      expect(mockTrack).toHaveBeenCalledWith(
        'event',
        { valid: 'value' }
      );
    });

    it('warns when pendo.track is not available', () => {
      delete (window as any).pendo.track;

      provider.track('event', {}, {});

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pendo agent not available')
      );
    });

    it('warns when pendo is not defined', () => {
      delete (window as any).pendo;

      provider.track('event', {}, {});

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pendo agent not available')
      );
    });
  });

  describe('edge cases', () => {
    it('handles empty segmentFlags array', async () => {
      (window as any).pendo = {
        isReady: () => true,
        segmentFlags: [],
      };
      await provider.initialize();

      const result = provider.resolveBooleanEvaluation('any-flag', false, {});

      expect(result.value).toBe(false);
      expect(result.reason).toBe('DEFAULT');
    });

    it('handles SSR environment (no window)', () => {
      const originalWindow = global.window;
      delete (global as any).window;

      const ssrProvider = new PendoProvider();
      const result = ssrProvider.resolveBooleanEvaluation('flag', true, {});

      expect(result.value).toBe(true);
      expect(result.reason).toBe('DEFAULT');

      (global as any).window = originalWindow;
    });
  });
});
