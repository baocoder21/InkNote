import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

export interface ZipEntry {
  /** Path inside the zip, split into segments (no empty, "." or ".." segments). */
  path: string[];
  bytes: Uint8Array;
}

export interface ZipLimits {
  maxEntries: number;
  /** Everything together, AFTER unpacking. */
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
};

export interface ZipContents {
  files: ZipEntry[];
  /** Folders, including the empty ones (a notebook with no notes). */
  directories: string[][];
  /** Entries that were left out, and why (too large, unsafe path, unreadable). */
  skipped: { path: string; reason: string }[];
}

/** The zip as a whole cannot be imported (not a zip, or beyond the limits). */
export class ZipError extends Error {}

/**
 * Unpacks a zip file that somebody else made, with defences:
 *  - the sizes written in the zip are NEVER trusted (a "zip bomb" says 1 KB and unpacks to gigabytes): the bytes that
 *    really come out are counted as they come, and an entry that grows past the limit is dropped on the spot;
 *  - too many entries, or too many bytes in total, is an error for the whole zip;
 *  - paths are cut into segments and an entry with ".." in its path is left out (it would try to leave the folder
 *    the zip is unpacked to; here nothing is written to disk, but nothing downstream may ever see such a path);
 *  - junk added by systems (macOS "__MACOSX", ".DS_Store", "Thumbs.db") and hidden folders (".obsidian", ".git") are left out.
 */
export function readZip(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipContents {
  const result: ZipContents = { files: [], directories: [], skipped: [] };
  let entries = 0;
  let total = 0;
  let fatal: string | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough); // files that are stored, not compressed

  unzip.onfile = (file) => {
    if (fatal) {
      return;
    }
    if (++entries > limits.maxEntries) {
      fatal = `The zip has more than ${limits.maxEntries} files.`;
      return;
    }

    const isDirectory = file.name.endsWith('/');
    const path = splitPath(file.name);
    if (path === null) {
      result.skipped.push({ path: file.name, reason: 'its path is not safe' });
      return;
    }
    if (isJunk(path)) {
      return;
    }
    if (isDirectory) {
      if (path.length > 0) result.directories.push(path);
      return;
    }
    if (path.length === 0) {
      return;
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    let dropped = false;
    file.ondata = (error, chunk, final) => {
      if (dropped || fatal) {
        return;
      }
      if (error) {
        dropped = true;
        result.skipped.push({ path: file.name, reason: 'it could not be unpacked' });
        return;
      }

      // The limit of ONE entry comes first: an entry that is too large is dropped, and what it had already added is
      // taken back, so that it never counts against the other entries.
      if (size + chunk.length > limits.maxEntryBytes) {
        dropped = true;
        total -= size;
        result.skipped.push({ path: file.name, reason: `it is larger than ${megabytes(limits.maxEntryBytes)}` });
        file.terminate();
        return;
      }

      size += chunk.length;
      total += chunk.length;
      if (total > limits.maxTotalBytes) {
        fatal = `The zip is larger than ${megabytes(limits.maxTotalBytes)} once unpacked.`;
        file.terminate();
        return;
      }

      chunks.push(chunk);
      if (final) {
        result.files.push({ path, bytes: concat(chunks, size) });
      }
    };
    file.start();
  };

  try {
    unzip.push(data, true);
  } catch {
    throw new ZipError('This file is not a valid zip archive.');
  }

  if (fatal) {
    throw new ZipError(fatal);
  }
  return result;
}

const megabytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(2))} MB`;
};

/** "a/b/c.md" -> ["a","b","c.md"]; null when the path tries to climb with "..". */
function splitPath(name: string): string[] | null {
  const parts: string[] = [];
  for (const segment of name.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    parts.push(segment);
  }
  return parts;
}

function isJunk(path: string[]): boolean {
  const last = path[path.length - 1]?.toLowerCase();
  return (
    path.some((segment) => segment.startsWith('.') || segment === '__MACOSX') ||
    last === 'thumbs.db' ||
    last === 'desktop.ini'
  );
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}
