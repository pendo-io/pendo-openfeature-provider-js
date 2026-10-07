import { PendoRuntimeError, isTransientStatus } from '../src/errors';

describe('isTransientStatus', () => {
  it.each([
    [undefined, true],
    [500, true],
    [502, true],
    [503, true],
    [599, true],
    [429, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [451, false],
    [499, false],
    [200, false],
  ])('isTransientStatus(%p) is %p', (status, expected) => {
    expect(isTransientStatus(status)).toBe(expected);
  });
});

describe('PendoRuntimeError', () => {
  it('carries structured fields and is an Error', () => {
    const cause = new Error('inner');
    const err = new PendoRuntimeError({
      message: 'boom',
      source: 'track',
      status: 502,
      transient: true,
      cause,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PendoRuntimeError);
    expect(err.name).toBe('PendoRuntimeError');
    expect(err.message).toBe('boom');
    expect(err.source).toBe('track');
    expect(err.status).toBe(502);
    expect(err.transient).toBe(true);
    expect(err.cause).toBe(cause);
  });
});
