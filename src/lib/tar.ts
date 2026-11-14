import { gunzipSync } from "node:zlib";

export type TarEntry = { path: string; data: Buffer };

const BLOCK = 512;

function readString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("utf8");
}

function readOctal(buf: Buffer, start: number, length: number): number {
  const text = readString(buf, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Reads `path=` from a pax extended header block. */
function paxPath(data: Buffer): string | null {
  const text = data.toString("utf8");
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(" ", i);
    if (space === -1) break;
    const length = parseInt(text.slice(i, space), 10);
    if (!length) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path") return record.slice(eq + 1);
    i += length;
  }
  return null;
}

/**
 * Reads regular files out of a .tar.gz held in memory.
 * `keep` is asked before a file's bytes are copied, so large or unwanted files cost nothing.
 */
export function untarGz(gz: Buffer, keep: (path: string, size: number) => boolean): { entries: TarEntry[]; skipped: number } {
  const tar = gunzipSync(gz);
  const entries: TarEntry[] = [];
  let skipped = 0;
  let offset = 0;
  let longPath: string | null = null;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const dataStart = offset + BLOCK;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      longPath = paxPath(tar.subarray(dataStart, dataStart + size));
    } else if (type === "L") {
      longPath = readString(tar, dataStart, size);
    } else if (type === "0" || type === "\0") {
      const full = longPath ?? (prefix ? `${prefix}/${name}` : name);
      longPath = null;
      // GitHub archives wrap everything in one top folder. Drop it.
      const path = full.slice(full.indexOf("/") + 1);
      if (path && keep(path, size)) {
        entries.push({ path, data: Buffer.from(tar.subarray(dataStart, dataStart + size)) });
      } else if (path) {
        skipped += 1;
      }
    } else if (type !== "g") {
      longPath = null;
    }
    offset = next;
  }
  return { entries, skipped };
}
