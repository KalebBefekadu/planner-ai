// What a person is told about a file they attached.
//
// These read as presentation, but each one is a claim about a stored object,
// and a wrong claim here is how "Security review pending" came to be shown for
// every attachment forever -- describing a review that was never going to run,
// on a file that could never be opened. Kept apart from the Workspace so each
// state can be checked against what is actually true of the file.

export type AttachmentDisplayState = {
  mediaType: string;
  byteSize: number;
  scanState: string;
};

const attachmentTypeNames: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'text/markdown': 'Markdown file',
  'text/plain': 'text file',
};

export function attachmentTypeName(mediaType: string) {
  return attachmentTypeNames[mediaType] ?? 'file';
}

export function attachmentSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} bytes`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentStatus(attachment: AttachmentDisplayState) {
  if (attachment.scanState === 'rejected') {
    return `Not available: contents do not match a ${attachmentTypeName(attachment.mediaType)}`;
  }
  if (attachment.scanState === 'quarantined') return 'Checking this file';
  return attachmentSize(attachment.byteSize);
}

export function restorableUntil(purgeAfter: string | null) {
  if (!purgeAfter) return 'Restore is no longer available.';
  return `Restore by ${new Date(purgeAfter).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}.`;
}
