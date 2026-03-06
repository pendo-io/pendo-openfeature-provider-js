import pako from "pako";

/**
 * JZB encoding: JSON → Zlib → Base64 (URL-safe)
 *
 * Browser-compatible version using `btoa()` instead of Node's `Buffer`.
 *
 * This encoding is used by Pendo's segmentflag.json endpoint to pass
 * visitor/account context in a compressed, URL-safe format.
 *
 * @param payload - The object to encode
 * @returns URL-safe base64 encoded zlib-compressed JSON string
 */
export function encodeJzb(payload: Record<string, unknown>): string {
  // Step 1: Convert to JSON string
  const jsonString = JSON.stringify(payload);

  // Step 2: Compress with zlib (deflate)
  const compressed = pako.deflate(jsonString);

  // Step 3: Convert to base64 (browser-compatible)
  const binary = String.fromCharCode(...compressed);
  const base64 = btoa(binary);

  // Step 4: Make URL-safe (replace + with -, / with _, remove padding =)
  const urlSafe = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return urlSafe;
}
