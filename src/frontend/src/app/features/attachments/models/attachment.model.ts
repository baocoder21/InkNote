/** What the server says about an attached file. */
export interface AttachmentDto {
  id: string;
  noteId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  createdAt: string;
}

/** A short-lived address to download a file from (see the server's presigned URLs). */
export interface AttachmentUrl {
  url: string;
  expiresAt: string;
  contentType: string;
  fileName: string;
  isImage: boolean;
}

// ---- the rules, as the server has them ----
// The server is the one that decides (it looks at the bytes of the file). These checks only save the user a pointless
// upload, and a pointless wait: the same size, and the same kinds of file.

/** Same as the server's default (Attachments:MaxFileBytes). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.log', '.json'];

export const isImageType = (type: string): boolean => type.startsWith('image/');

/**
 * Is this file worth sending? Returns the reason for a refusal, or null.
 * (A browser says "application/octet-stream", or nothing, for files it does not know: only the name is left then.)
 */
export function attachmentProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) {
    return 'The file is empty.';
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `The file is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`;
  }
  const name = file.name.toLowerCase();
  const allowed =
    IMAGE_TYPES.includes(file.type) ||
    file.type === 'application/pdf' ||
    name.endsWith('.pdf') ||
    TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
  return allowed ? null : 'This kind of file is not allowed (images, PDF and text files only).';
}

/**
 * The MIME type a file name suggests, for files that come with no type (the ones inside a zip): images and PDF.
 * '' when the name says nothing. (The server looks at the BYTES, so this only has to be good enough for the checks
 * made here.)
 */
export function typeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return '';
}

/** The MIME type to keep with a file: what the browser said, or one worked out from the name when it said nothing useful. */
export function typeOf(file: { name: string; type: string }): string {
  if (IMAGE_TYPES.includes(file.type) || file.type === 'application/pdf') {
    return file.type;
  }
  return file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain';
}

/**
 * The Markdown that refers to an attached file: an image is shown, anything else is a link.
 * Brackets and backslashes are taken out of the name: they would end the link text early.
 */
export function markdownFor(id: string, name: string, isImage: boolean): string {
  const clean = name.replace(/[[\]\\\r\n]/g, '').trim() || 'file';
  if (isImage) {
    const alt = clean.replace(/\.[^.]+$/, '') || clean; // "photo.png" shows as "photo"
    return `![${alt}](attachment:${id})`;
  }
  return `[${clean}](attachment:${id})`;
}
