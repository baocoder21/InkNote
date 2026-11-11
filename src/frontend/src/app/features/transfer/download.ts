/** Hands a file made in the browser to the user: the browser's "save as" (or its downloads folder). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not at once: some browsers start reading the address only after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
