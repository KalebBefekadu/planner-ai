import { describe, expect, it } from 'vitest';
import {
  attachmentSize,
  attachmentStatus,
  attachmentTypeName,
  restorableUntil,
} from '@/lib/notes/attachment-display';

describe('attachment size', () => {
  it('counts bytes exactly while they are still readable as bytes', () => {
    expect(attachmentSize(512)).toBe('512 bytes');
  });

  it('switches to kilobytes at the kilobyte boundary', () => {
    expect(attachmentSize(1024)).toBe('1 KB');
  });

  it('switches to megabytes at the megabyte boundary', () => {
    expect(attachmentSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('keeps one decimal place for the largest files it accepts', () => {
    expect(attachmentSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('what a person is told about a file', () => {
  /* "Security review pending" used to be shown for every attachment forever,
     describing a review that was never going to run on a file that could never
     be opened. Each state below is something actually true of the stored file. */
  it('says a file is being checked while the check has not happened', () => {
    expect(
      attachmentStatus({ mediaType: 'application/pdf', byteSize: 2048, scanState: 'quarantined' })
    ).toBe('Checking this file');
  });

  it('names the type the bytes failed to be', () => {
    expect(
      attachmentStatus({ mediaType: 'application/pdf', byteSize: 2048, scanState: 'rejected' })
    ).toBe('Not available: contents do not match a PDF');
  });

  it('falls back to "file" for a type it has no name for', () => {
    expect(
      attachmentStatus({ mediaType: 'application/zip', byteSize: 2048, scanState: 'rejected' })
    ).toBe('Not available: contents do not match a file');
  });

  it('shows the size once the file is known to be what it claims', () => {
    expect(
      attachmentStatus({ mediaType: 'image/png', byteSize: 2048, scanState: 'approved' })
    ).toBe('2 KB');
  });

  it('names every type the upload accepts', () => {
    expect(attachmentTypeName('image/jpeg')).toBe('JPEG image');
    expect(attachmentTypeName('text/markdown')).toBe('Markdown file');
    expect(attachmentTypeName('text/plain')).toBe('text file');
  });
});

describe('the restore window', () => {
  it('gives a date while the file can still be brought back', () => {
    expect(restorableUntil('2026-10-15T00:00:00.000Z')).toMatch(/^Restore by .+\.$/);
  });

  /* A removed attachment with no purge deadline is one the lifecycle job has
     already taken, so offering a date would promise something that is gone. */
  it('says so plainly when there is no window left', () => {
    expect(restorableUntil(null)).toBe('Restore is no longer available.');
  });
});
