/**
 * Perceptual image hashing (dHash) for "is this the same cake photo?" detection.
 *
 * Goal: when a customer's cake photo closely matches one that was already
 * saved (SavedCakeDesign.image_phash), surface it to the user for CONFIRMATION
 * before spending an AI call / before trusting it — never auto-apply. A dHash
 * tolerates re-compression/resizing (e.g. WhatsApp forwards) far better than a
 * raw byte hash, but it is still only a hint, not proof it's the same cake.
 *
 * Supports JPEG (via the pure-JS `jpeg-js`) and PNG (a small hand-rolled
 * chunk parser here + `pako` for the zlib inflate step). Both are Metro-safe:
 * no native module/rebuild, and no Node core modules (`stream`/`zlib`/`util`)
 * that Metro can't resolve — that ruled out `pngjs`, which looks pure-JS but
 * actually requires those under the hood. Any unsupported format (or PNG with
 * a palette/16-bit/interlaced layout we don't bother handling) is skipped —
 * computeDHash returns null and the caller falls back to a normal AI
 * analysis with no match check.
 */
import jpeg from 'jpeg-js';
import pako from 'pako';
import type {SavedCakeDesign} from '../types';

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, 4 bytes/pixel
}

const HASH_W = 9; // one extra column so we get 8 horizontal comparisons per row
const HASH_H = 8;

/** Default: how close two dHashes (out of 64 bits) must be to count as "likely the same photo". */
export const DEFAULT_MATCH_THRESHOLD = 10;

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure-JS base64 -> bytes, since RN/Hermes doesn't reliably expose atob/Buffer. */
function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const val = BASE64_CHARS.indexOf(c);
    if (val === -1) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function bitsToHex(bits: string): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function decodeJpeg(bytes: Uint8Array): DecodedImage | null {
  try {
    const decoded = jpeg.decode(bytes, {useTArray: true});
    return {width: decoded.width, height: decoded.height, data: decoded.data};
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Minimal PNG decoder: parses IHDR/IDAT chunks, inflates with pako, and
 * un-filters scanlines per the PNG spec. Only handles the common case —
 * 8-bit depth, non-interlaced, colorType 0/2/4/6 (grayscale/RGB/GA/RGBA).
 * Palette (colorType 3), 16-bit, and Adam7-interlaced images return null.
 */
function decodePng(bytes: Uint8Array): DecodedImage | null {
  try {
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let interlace = 0;
    const idatChunks: Uint8Array[] = [];

    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset, false);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
      );
      const dataStart = offset + 8;

      if (type === 'IHDR') {
        width = view.getUint32(dataStart, false);
        height = view.getUint32(dataStart + 4, false);
        bitDepth = bytes[dataStart + 8];
        colorType = bytes[dataStart + 9];
        interlace = bytes[dataStart + 12];
      } else if (type === 'IDAT') {
        idatChunks.push(bytes.subarray(dataStart, dataStart + length));
      } else if (type === 'IEND') {
        break;
      }

      offset = dataStart + length + 4; // skip CRC
    }

    let channels: number;
    if (colorType === 0) channels = 1;
    else if (colorType === 2) channels = 3;
    else if (colorType === 4) channels = 2;
    else if (colorType === 6) channels = 4;
    else return null; // palette (3), or malformed IHDR

    if (!width || !height || bitDepth !== 8 || interlace !== 0 || idatChunks.length === 0) {
      return null;
    }

    let totalLen = 0;
    for (const c of idatChunks) totalLen += c.length;
    const compressed = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of idatChunks) {
      compressed.set(c, pos);
      pos += c.length;
    }
    const raw = pako.inflate(compressed);

    const bpp = channels; // bytes per pixel at 8-bit depth
    const rowBytes = width * bpp;
    const pixels = new Uint8Array(width * height * 4);
    let prevRow = new Uint8Array(rowBytes);
    let rawPos = 0;

    for (let y = 0; y < height; y++) {
      const filterType = raw[rawPos];
      rawPos += 1;
      const row = new Uint8Array(rowBytes);
      for (let x = 0; x < rowBytes; x++) {
        const filt = raw[rawPos + x];
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = prevRow[x];
        const c = x >= bpp ? prevRow[x - bpp] : 0;
        let recon: number;
        switch (filterType) {
          case 0: recon = filt; break;
          case 1: recon = filt + a; break;
          case 2: recon = filt + b; break;
          case 3: recon = filt + Math.floor((a + b) / 2); break;
          case 4: recon = filt + paethPredictor(a, b, c); break;
          default: return null; // unknown filter type
        }
        row[x] = recon & 0xff;
      }
      rawPos += rowBytes;

      for (let x = 0; x < width; x++) {
        const srcIdx = x * bpp;
        const dstIdx = (y * width + x) * 4;
        if (channels === 1) {
          const g = row[srcIdx];
          pixels[dstIdx] = g;
          pixels[dstIdx + 1] = g;
          pixels[dstIdx + 2] = g;
          pixels[dstIdx + 3] = 255;
        } else if (channels === 2) {
          const g = row[srcIdx];
          pixels[dstIdx] = g;
          pixels[dstIdx + 1] = g;
          pixels[dstIdx + 2] = g;
          pixels[dstIdx + 3] = row[srcIdx + 1];
        } else if (channels === 3) {
          pixels[dstIdx] = row[srcIdx];
          pixels[dstIdx + 1] = row[srcIdx + 1];
          pixels[dstIdx + 2] = row[srcIdx + 2];
          pixels[dstIdx + 3] = 255;
        } else {
          pixels[dstIdx] = row[srcIdx];
          pixels[dstIdx + 1] = row[srcIdx + 1];
          pixels[dstIdx + 2] = row[srcIdx + 2];
          pixels[dstIdx + 3] = row[srcIdx + 3];
        }
      }
      prevRow = row;
    }

    return {width, height, data: pixels};
  } catch {
    return null;
  }
}

/**
 * Compute a 64-bit dHash (as a 16-char hex string) from a base64 JPEG or PNG.
 * Returns null for unsupported formats or if decoding fails — caller should
 * just skip the similarity check in that case, not treat it as an error.
 */
export function computeDHash(base64: string, mimeType: string): string | null {
  const mime = (mimeType || '').toLowerCase();
  const isJpeg = mime.includes('jpeg') || mime.includes('jpg');
  const isPng = mime.includes('png');
  if (!base64 || !(isJpeg || isPng)) {
    return null;
  }

  const bytes = base64ToUint8Array(base64);
  const decoded = isJpeg ? decodeJpeg(bytes) : decodePng(bytes);
  if (!decoded || !decoded.width || !decoded.height) {
    return null;
  }
  const {width, height, data} = decoded;

  // Downsample to HASH_W x HASH_H grayscale via nearest-neighbor sampling.
  const gray = new Array<number>(HASH_W * HASH_H);
  for (let y = 0; y < HASH_H; y++) {
    const srcY = Math.min(height - 1, Math.floor((y * height) / HASH_H));
    for (let x = 0; x < HASH_W; x++) {
      const srcX = Math.min(width - 1, Math.floor((x * width) / HASH_W));
      const idx = (srcY * width + srcX) * 4; // RGBA
      gray[y * HASH_W + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // dHash: for each row, 1 if pixel is darker than its right neighbor, else 0.
  let bits = '';
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      bits += gray[y * HASH_W + x] < gray[y * HASH_W + x + 1] ? '1' : '0';
    }
  }
  return bitsToHex(bits); // 64 bits -> 16 hex chars
}

/** Hamming distance between two same-length hex hashes (lower = more similar). */
export function hammingDistanceHex(hexA: string, hexB: string): number {
  if (!hexA || !hexB || hexA.length !== hexB.length) {
    return Infinity;
  }
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    let x = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/**
 * Find the closest saved design to a given dHash, if any is within threshold.
 * Returns null when nothing is close enough — caller proceeds with a normal
 * AI analysis in that case.
 */
export function findClosestSavedDesign(
  hash: string,
  designs: SavedCakeDesign[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): {design: SavedCakeDesign; distance: number} | null {
  let best: {design: SavedCakeDesign; distance: number} | null = null;
  for (const design of designs) {
    if (!design.image_phash) {
      continue;
    }
    const distance = hammingDistanceHex(hash, design.image_phash);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = {design, distance};
    }
  }
  return best;
}
