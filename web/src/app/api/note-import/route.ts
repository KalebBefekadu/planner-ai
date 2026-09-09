import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  candidatesFromVaultOrFiles,
  filesFromZip,
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE_MESSAGE,
  formatImportBytes,
  type ImportSourceFile,
} from '@/lib/notes/import-bundle';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The platform rejects anything past this before the handler runs, so the
// handler must not advertise a ceiling above it.
const requestBytes = IMPORT_LIMITS.requestBytes;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

async function importContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: jsonError('Authentication required.', 401) } as const;
  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return { error: jsonError('Notes import is unavailable before data migration.', 503) } as const;
  }
  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !workspace) {
    return { error: jsonError('Workspace is unavailable.', 503) } as const;
  }
  return { supabase, workspaceId: workspace.id as string } as const;
}

// A report is only reopenable if the owner can find it again, and a job id
// exists nowhere in the browser after a reload. History is that index. It is
// bounded because a workspace accumulates jobs forever (#168) and an unbounded
// list would grow into the response until it stopped loading at all.
const HISTORY_PAGE_SIZE = 10;
const MAX_HISTORY_PAGE_SIZE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readHistory(
  context: Awaited<ReturnType<typeof importContext>> & { workspaceId: string },
  options: { limit: number; before?: string }
) {
  // One row past the page is read so the client can be told whether another
  // page exists without a second round trip or a count over the whole table.
  let request = context.supabase
    .from('note_import_jobs')
    .select(
      'id,source_name,source_type,status,total_count,create_count,duplicate_count,unsupported_count,committed_count,created_at,completed_at'
    )
    .eq('workspace_id', context.workspaceId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit + 1);
  if (options.before) request = request.lt('created_at', options.before);
  const { data, error } = await request;
  if (error) throw new Error('Import history could not be loaded.');
  const rows = data ?? [];
  const page = rows.slice(0, options.limit);
  return {
    entries: page.map((row) => ({
      id: row.id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      status: row.status,
      totalCount: row.total_count,
      createCount: row.create_count,
      duplicateCount: row.duplicate_count,
      unsupportedCount: row.unsupported_count,
      committedCount: row.committed_count,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
    // The cursor is the last row's own timestamp, so paging never depends on
    // an offset that shifts when a new import starts mid-read.
    nextCursor:
      rows.length > options.limit && page.length ? page[page.length - 1].created_at : null,
  };
}

async function readJob(
  context: Awaited<ReturnType<typeof importContext>> & { workspaceId: string },
  jobId?: string
) {
  let request = context.supabase
    .from('note_import_jobs')
    .select('*')
    .eq('workspace_id', context.workspaceId);
  request = jobId
    ? request.eq('id', jobId)
    : request.in('status', ['preview', 'committing']).order('created_at', { ascending: false });
  const { data: job, error } = await request.limit(1).maybeSingle();
  if (error) throw new Error('Import preview could not be loaded.');
  if (!job) return null;
  const { data: items, error: itemsError } = await context.supabase
    .from('note_import_items')
    .select('id,source_path,parent_source_path,title,disposition,reason,target_note_id,sort_order')
    .eq('workspace_id', context.workspaceId)
    .eq('job_id', job.id)
    .order('sort_order');
  if (itemsError) throw new Error('Import items could not be loaded.');
  return {
    job: {
      id: job.id,
      sourceName: job.source_name,
      sourceType: job.source_type,
      status: job.status,
      totalCount: job.total_count,
      createCount: job.create_count,
      duplicateCount: job.duplicate_count,
      unsupportedCount: job.unsupported_count,
      committedCount: job.committed_count,
    },
    items: (items ?? []).map((item) => ({
      id: item.id,
      sourcePath: item.source_path,
      parentSourcePath: item.parent_source_path,
      title: item.title,
      disposition: item.disposition,
      reason: item.reason,
      imported: Boolean(item.target_note_id),
    })),
  };
}

export async function GET(request: Request) {
  const context = await importContext();
  if ('error' in context) return context.error;
  // A committed job is no longer in 'preview' or 'committing', so the report
  // can only be re-read by naming the job. readJob stays scoped to the
  // caller's workspace, so an unknown or foreign id reads as no job at all.
  const params = new URL(request.url).searchParams;
  const jobIdParam = params.get('jobId');
  const requestedJobId = jobIdParam && UUID_PATTERN.test(jobIdParam) ? jobIdParam : undefined;
  const limitParam = Number(params.get('historyLimit') ?? '');
  const limit = Number.isInteger(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_HISTORY_PAGE_SIZE)
    : HISTORY_PAGE_SIZE;
  // An unparseable cursor is treated as no cursor rather than an error: the
  // worst case is the first page again, never a failed dialog.
  const beforeParam = params.get('historyBefore');
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? beforeParam : undefined;
  try {
    const [current, history] = await Promise.all([
      readJob(context, requestedJobId),
      readHistory(context, { limit, before }),
    ]);
    return NextResponse.json(
      { ...(current ?? { job: null, items: [] }), history },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return jsonError('Import preview could not be loaded.', 500);
  }
}

export async function POST(request: Request) {
  const context = await importContext();
  if ('error' in context) return context.error;
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > requestBytes) {
    return jsonError(IMPORT_TOO_LARGE_MESSAGE, 413);
  }
  if (
    !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')
  ) {
    return jsonError('Choose Notes files or a ZIP archive.', 415);
  }

  try {
    const formData = await request.formData();
    const sourceType = formData.get('sourceType');
    if (!['notion', 'obsidian', 'generic'].includes(String(sourceType))) {
      return jsonError('Choose a supported import source.', 400);
    }
    const uploads = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File);
    if (!uploads.length || uploads.length > IMPORT_LIMITS.candidates) {
      return jsonError(`Choose between 1 and ${IMPORT_LIMITS.candidates} files.`, 400);
    }
    const pathsValue = formData.get('paths');
    const paths = typeof pathsValue === 'string' ? (JSON.parse(pathsValue) as unknown) : null;
    if (!Array.isArray(paths) || paths.length !== uploads.length) {
      return jsonError('The selected file paths could not be read.', 400);
    }
    const totalBytes = uploads.reduce((total, file) => total + file.size, 0);
    // Content-Length is a claim by the client. The parsed sizes are the fact,
    // so the bound is enforced again here.
    if (totalBytes > IMPORT_LIMITS.archiveBytes) {
      return jsonError(IMPORT_TOO_LARGE_MESSAGE, 413);
    }

    const zipUpload = uploads.find(
      (file) => path.posix.extname(file.name).toLowerCase() === '.zip'
    );
    let sourceFiles: ImportSourceFile[];
    let sourceName: string;
    if (zipUpload) {
      if (uploads.length !== 1) return jsonError('Import one ZIP archive at a time.', 400);
      sourceFiles = await filesFromZip(Buffer.from(await zipUpload.arrayBuffer()));
      sourceName = zipUpload.name;
    } else {
      if (totalBytes > IMPORT_LIMITS.expandedBytes) {
        return jsonError(
          `Selected files exceed the ${formatImportBytes(IMPORT_LIMITS.expandedBytes)} text limit.`,
          413
        );
      }
      sourceFiles = await Promise.all(
        uploads.map(async (file, index) => ({
          path: String(paths[index] || file.name),
          bytes: Buffer.from(await file.arrayBuffer()),
        }))
      );
      const firstPath = String(paths[0] || uploads[0].name);
      sourceName = firstPath.includes('/') ? firstPath.split('/')[0] : uploads[0].name;
    }
    const items = candidatesFromVaultOrFiles(sourceFiles);
    if (!items.length) return jsonError('No supported Notes were found.', 400);
    const result = await executeOperation(
      context.supabase,
      'note.import-preview.v1',
      {
        sourceName: sourceName.slice(0, 255),
        sourceType: sourceType as 'notion' | 'obsidian' | 'generic',
        items,
      },
      { idempotencyKey: randomUUID(), surface: 'ui' }
    );
    const staged = await readJob(context, result.jobId);
    const history = await readHistory(context, { limit: HISTORY_PAGE_SIZE });
    return NextResponse.json(
      { ...(staged ?? { job: null, items: [] }), history },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safeMessage = /^(ZIP|The import|The expanded import|An import|One import)/.test(message)
      ? message
      : 'Planner AI could not inspect this import.';
    return jsonError(safeMessage, 400);
  }
}
