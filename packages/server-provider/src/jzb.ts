import pako from "pako";

/**
 * JZB encoding: JSON → Zlib → Base64 (URL-safe)
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

  // Step 3: Convert to base64
  const base64 = Buffer.from(compressed).toString("base64");

  // Step 4: Make URL-safe (replace + with -, / with _, remove padding =)
  const urlSafe = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return urlSafe;
}
