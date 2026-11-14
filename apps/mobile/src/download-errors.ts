/**
 * What a hiker reads when a download fails. The native task rejects with text
 * like "Call to function 'FileSystemDownloadTask.start' has been rejected.
 * Caused by: Unable to download a file: HTTP 404", shown as-is until #198's
 * phone check. Our own messages ("arrived damaged") pass through.
 */
export function downloadError(e: unknown): Error {
  const text = e instanceof Error ? e.message : String(e);
  if (!/FileSystemDownloadTask|Unable to download|HTTP \d{3}|network|timeout|timed out|connection|socket|host/i.test(text)) {
    return e instanceof Error ? e : new Error(text);
  }
  const status = /HTTP (\d{3})/.exec(text)?.[1];
  if (status === '404' || status === '410') return new Error('That download isn’t available right now. Try again later.');
  if (status !== undefined && status.startsWith('5')) return new Error('The download server isn’t answering right now. Try again in a few minutes.');
  return new Error('The download stopped. Check your connection and tap Download again: what already arrived is kept.');
}
