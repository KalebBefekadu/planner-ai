import { createHash } from 'node:crypto';
import { verifyAttachmentContent } from './attachment-content';

export const attachmentBucket = 'note-attachments';

type AdminClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => PromiseLike<{ data: Blob | null; error: unknown }>;
    };
  };
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: unknown }>;
    };
  };
};

export type StoredAttachment = {
  id: string;
  object_key: string;
  media_type: string;
  checksum_sha256: string;
  scan_state: string;
};

export type ResolvedAttachment =
  | { state: 'approved'; bytes: Buffer }
  // The row says the file exists but the object behind it does not. This is
  // reported rather than treated as a rejection, because nothing is wrong with
  // the file -- it is gone, which is a different thing to tell a person.
  | { state: 'missing' }
  | { state: 'rejected' };

/**
 * Answer whether an attachment can be handed back, doing the deferred content
 * check if it has not happened yet.
 *
 * Rows uploaded before content verification existed sit in `quarantined`
 * forever, and nothing was ever going to move them, which is why those files
 * had become permanently unreachable. Rather than a migration that would have
 * to re-read every object at once, a row is resolved the first time someone
 * asks for it and the answer is written back, so the cost is paid once and
 * only for files that are actually wanted.
 */
export async function resolveAttachment(
  admin: AdminClient,
  attachment: StoredAttachment
): Promise<ResolvedAttachment> {
  if (attachment.scan_state === 'rejected') return { state: 'rejected' };

  const { data, error } = await admin.storage
    .from(attachmentBucket)
    .download(attachment.object_key);
  if (error || !data) return { state: 'missing' };
  const bytes = Buffer.from(await data.arrayBuffer());

  if (attachment.scan_state === 'approved') {
    // An approved row is served on the strength of the earlier check, but the
    // stored checksum still has to hold. If the object behind the row is not
    // the object that was checked, the approval does not describe these bytes.
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== attachment.checksum_sha256) return { state: 'missing' };
    return { state: 'approved', bytes };
  }

  const state = verifyAttachmentContent(attachment.media_type, bytes);
  await admin.from('note_attachments').update({ scan_state: state }).eq('id', attachment.id);
  return state === 'approved' ? { state: 'approved', bytes } : { state: 'rejected' };
}
