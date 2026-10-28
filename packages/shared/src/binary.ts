/**
 * UTF-16 binary codec used for Web Push payloads.
 *
 * The server encodes a JSON string into a UTF-16 little-endian binary
 * string with `toBinary` (one JS char per byte, so the output is safe
 * to `btoa()`). The service worker reverses the transformation with
 * `fromBinary(atob(payload))`. Both halves share this module so the
 * wire format cannot drift (MILESTONE.md risk: "The push wire format
 * could drift").
 *
 * The behaviour is ported verbatim from
 * `app/backend/webpush/util.ts` (`toBinary`) and
 * `app/frontend/src/sw.js` (`fromBinary`). Non-ASCII input such as
 * CJK and emoji is handled correctly: each 16-bit code unit of the
 * input survives as two bytes (little-endian) in the output.
 *
 * Note: JavaScript strings are UTF-16; a code unit outside the BMP
 * (e.g. an emoji) is represented as a surrogate pair of two code
 * units, so a single astral character produces four bytes of output.
 * `fromBinary` restores the same surrogate pairs, which `String`
 * stitches back into the original character.
 */

/**
 * UTF-16 → little-endian binary string. The result's byte length is
 * `str.length * 2`.
 */
export function toBinary(str: string): string {
    const codeUnits = new Uint16Array(str.length);
    for (let i = 0; i < codeUnits.length; i++) {
        codeUnits[i] = str.charCodeAt(i);
    }
    const charCodes = new Uint8Array(codeUnits.buffer);
    let result = "";
    for (let i = 0; i < charCodes.byteLength; i++) {
        result += String.fromCharCode(charCodes[i]!);
    }
    return result;
}

/**
 * Little-endian binary string → UTF-16. Input length must be even
 * (two bytes per code unit); odd-length input silently drops the
 * trailing byte, matching the legacy service-worker behaviour.
 */
export function fromBinary(binary: string): string {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const charCodes = new Uint16Array(bytes.buffer);
    let result = "";
    for (let i = 0; i < charCodes.length; i++) {
        result += String.fromCharCode(charCodes[i]!);
    }
    return result;
}
