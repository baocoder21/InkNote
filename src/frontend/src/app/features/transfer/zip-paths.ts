/**
 * Paths inside a zip file. Names that come from the user's notes (a notebook called "Work / 2026", a note called
 * "What? Why: now") must become names that every system accepts, and names that come from a zip made by somebody else
 * must never be trusted.
 */

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i; // names Windows refuses for a file

/** A name that is safe as ONE folder or file name (no separators, no characters Windows forbids, not empty). */
export function safeName(name: string, maxLength = 80, fallback = 'Untitled'): string {
  let clean = name
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '') // no leading or trailing dots and spaces (Windows drops them)
    .slice(0, maxLength)
    .replace(/[\s.]+$/g, '');
  if (!clean) {
    clean = fallback;
  }
  return RESERVED.test(clean) ? `${clean}_` : clean;
}

/** "Plan.md" - or "Plan (2).md", "Plan (3).md"... when the name is taken (names are compared ignoring case). Adds the result to `taken`. */
export function uniqueName(base: string, extension: string, taken: Set<string>): string {
  let candidate = `${base}${extension}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${base} (${n})${extension}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * The link from a file in folder `fromDir` to the file at `to`, as written in Markdown: "../_attachments/a%20b.png".
 * Each segment is percent-encoded (a space or a parenthesis in a name would end the link).
 */
export function relativeLink(fromDir: readonly string[], to: readonly string[]): string {
  const up = fromDir.map(() => '..');
  return [...up, ...to].map((segment) => (segment === '..' ? segment : encodeSegment(segment))).join('/');
}

// encodeURIComponent leaves ( and ) alone, but a lone parenthesis in a name would end a Markdown link early.
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * Where a link written in a note of folder `dir` points, as a path from the root of the zip; null when it is not a
 * plain relative path inside the zip: an address with a scheme (https:, data:, javascript:), an anchor, an empty
 * link, or a path that climbs out of the zip with "..".
 */
export function resolveLink(dir: readonly string[], href: string): string[] | null {
  let target = href.trim();
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1);
  }
  target = target.split(/[?#]/)[0];
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
    return null;
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    return null; // a broken %-sequence
  }

  const parts = target.startsWith('/') ? [] : [...dir];
  for (const segment of target.split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null; // above the root of the zip
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts : null;
}

/** A path as one lower-case string, for lookups ("Notes/A.md" and "notes/a.md" are the same file to most systems). */
export const pathKey = (parts: readonly string[]): string => parts.join('/').toLowerCase();
