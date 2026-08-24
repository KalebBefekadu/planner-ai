import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  candidatesFromFiles,
  filesFromZip,
  IMPORT_LIMITS,
  type ImportSourceFile,
} from '@/lib/notes/import-bundle';
import { executeOperation } from '@/lib/operations';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestBytes = IMPORT_LIMITS.archiveBytes + 1024 * 1024;

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

export async function GET() {
  const context = await importContext();
  if ('error' in context) return context.error;
  try {
    return NextResponse.json(await readJob(context), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return jsonError('Import preview could not be loaded.', 500);
  }
}

export async function POST(request: Request) {
  const context = await importContext();
  if ('error' in context) return context.error;
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > requestBytes) {
    return jsonError('Import upload exceeds 25 MB.', 413);
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
      return jsonError('Choose between 1 and 500 files.', 400);
    }
    const pathsValue = formData.get('paths');
    const paths = typeof pathsValue === 'string' ? (JSON.parse(pathsValue) as unknown) : null;
    if (!Array.isArray(paths) || paths.length !== uploads.length) {
      return jsonError('The selected file paths could not be read.', 400);
    }
    const totalBytes = uploads.reduce((total, file) => total + file.size, 0);
    if (totalBytes > IMPORT_LIMITS.archiveBytes) {
      return jsonError('Import upload exceeds 25 MB.', 413);
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
        return jsonError('Selected files exceed the 10 MB text limit.', 413);
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
    const items = candidatesFromFiles(sourceFiles);
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
    return NextResponse.json(await readJob(context, result.jobId), {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safeMessage = /^(ZIP|The import|The expanded import|An import|One import)/.test(message)
      ? message
      : 'Planner AI could not inspect this import.';
    return jsonError(safeMessage, 400);
  }
}
