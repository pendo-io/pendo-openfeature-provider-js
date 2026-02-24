import pako from 'pako';
import { encodeJzb } from '../src/jzb';

describe('encodeJzb', () => {
  it('encodes a simple payload correctly', () => {
    const payload = { visitorId: 'user-123' };
    const encoded = encodeJzb(payload);

    // Verify it's URL-safe (no +, /, or =)
    expect(encoded).not.toMatch(/[+/=]/);

    // Verify we can decode it back
    const decoded = decodeJzb(encoded);
    expect(decoded).toEqual(payload);
  });

  it('encodes visitor and account IDs', () => {
    const payload = {
      visitorId: 'user-456',
      accountId: 'account-789',
    };
    const encoded = encodeJzb(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeJzb(encoded)).toEqual(payload);
  });

  it('encodes payload with URL', () => {
    const payload = {
      visitorId: 'user-123',
      accountId: 'account-456',
      url: 'https://example.com/path?query=value',
    };
    const encoded = encodeJzb(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeJzb(encoded)).toEqual(payload);
  });

  it('produces URL-safe Base64 output', () => {
    // Create a payload that would produce +, /, or = in regular base64
    // Use a larger payload to increase likelihood of these characters
    const payload = {
      visitorId: 'test-user-with-long-id-12345678901234567890',
      accountId: 'test-account-with-long-id-12345678901234567890',
      url: 'https://example.com/very/long/path/that/should/produce/special/chars?query=value&another=param',
    };
    const encoded = encodeJzb(payload);

    // URL-safe base64 should only contain: A-Z, a-z, 0-9, -, _
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('handles empty object', () => {
    const payload = {};
    const encoded = encodeJzb(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeJzb(encoded)).toEqual(payload);
  });

  it('handles special characters in values', () => {
    const payload = {
      visitorId: 'user@example.com',
      accountId: 'account/with/slashes',
      url: 'https://example.com/path?email=user+test@example.com',
    };
    const encoded = encodeJzb(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeJzb(encoded)).toEqual(payload);
  });

  it('handles unicode characters', () => {
    const payload = {
      visitorId: 'user-日本語',
      accountId: 'account-émoji-🚀',
    };
    const encoded = encodeJzb(payload);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeJzb(encoded)).toEqual(payload);
  });
});

/**
 * Helper function to decode JZB for testing.
 * Reverses the encoding: URL-safe Base64 → Zlib decompress → JSON parse
 */
function decodeJzb(encoded: string): Record<string, unknown> {
  // Restore standard base64 characters
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 += '='.repeat(4 - padding);
  }

  // Decode base64 to bytes
  const compressed = Buffer.from(base64, 'base64');

  // Decompress
  const jsonString = pako.inflate(compressed, { to: 'string' });

  // Parse JSON
  return JSON.parse(jsonString);
}
