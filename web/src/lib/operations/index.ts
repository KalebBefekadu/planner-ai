import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const id = z.uuid();
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().positive();

const visionOutput = z
  .object({
    id,
    workspace_id: id,
    body_markdown: z.string(),
    version,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: timestamp.nullable(),
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const goalOutput = z
  .object({
    id,
    workspace_id: id,
    vision_id: id,
    horizon_id: id,
    parent_goal_id: id.nullable(),
    title: z.string(),
    description_markdown: z.string().nullable(),
    status: z.enum(['draft', 'active', 'paused', 'achieved', 'abandoned']),
    target_value: z.number().nullable(),
    current_value: z.number().nullable(),
    unit: z.string().nullable(),
    due_on: date.nullable(),
    version,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: timestamp.nullable(),
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const actionOutput = z
  .object({
    id,
    workspace_id: id,
    goal_id: id.nullable(),
    parent_action_id: id.nullable(),
    horizon_id: id,
    title: z.string(),
    description_markdown: z.string().nullable(),
    status: z.enum(['open', 'in_progress', 'blocked', 'done', 'dropped']),
    scheduled_on: date.nullable(),
    completed_at: timestamp.nullable(),
    version,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: timestamp.nullable(),
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const actionTemplateOutput = z
  .object({
    id,
    workspaceId: id,
    title: z.string(),
    cadence: z.enum(['weekly', 'monthly']),
    status: z.enum(['active', 'paused', 'archived']),
    nextOccurrenceOn: date,
    version,
    createdActionIds: z.array(id).max(100),
  })
  .strict();

const notificationOutput = z
  .object({
    id,
    workspaceId: id,
    kind: z.enum(['overdue_actions', 'weekly_review', 'recurring_actions', 'system']),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(500),
    href: z.string().startsWith('/').max(300),
    readAt: timestamp.nullable(),
    dismissedAt: timestamp.nullable(),
    version,
  })
  .strict();
const notificationRefreshOutput = z
  .object({
    createdCount: z.number().int().nonnegative().max(10),
    activeCount: z.number().int().nonnegative(),
  })
  .strict();
const notificationPreferencesOutput = z
  .object({
    workspaceId: id,
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    emailHour: z.number().int().min(0).max(23),
    quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

const conversationOutput = z
  .object({
    id,
    workspaceId: id,
    title: z.string().min(1).max(200),
    status: z.enum(['active', 'archived']),
    version,
    updatedAt: timestamp,
    archivedAt: timestamp.nullable(),
  })
  .strict();
const conversationDeleteOutput = z
  .object({
    id,
    deleted: z.literal(true),
  })
  .strict();

const captureProposalBatchOutput = z
  .object({
    id,
    captureId: id,
    status: z.enum(['pending', 'applied', 'dismissed', 'superseded', 'failed']),
    version,
    itemCount: z.number().int().nonnegative().max(10),
    updatedAt: timestamp,
    receiptIds: z.array(id).max(10).optional(),
  })
  .strict();
const captureProposalItemOutput = z
  .object({
    id,
    batchId: id,
    operationId: z.string(),
    input: z.record(z.string(), z.unknown()),
    summary: z.string().min(1).max(300),
    risk: z.enum(['low', 'medium', 'high']),
    version,
  })
  .strict();

const captureOutput = z
  .object({
    id,
    workspace_id: id,
    raw_text: z.string(),
    source: z.enum(['typed', 'voice', 'import']),
    state: z.enum(['new', 'proposed', 'reviewed', 'archived']),
    created_at: timestamp,
    archived_at: timestamp.nullable(),
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const noteOutput = z
  .object({
    id,
    workspace_id: id,
    parent_note_id: id.nullable(),
    title: z.string(),
    body_markdown: z.string(),
    sort_key: z.union([z.number(), z.string()]),
    ai_excluded: z.boolean(),
    version,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: timestamp.nullable(),
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const memoryOutput = z
  .object({
    id,
    workspace_id: id,
    statement: z.string(),
    source_type: z.enum(['user', 'conversation', 'capture', 'note', 'review']),
    source_id: id.nullable(),
    version,
    created_at: timestamp,
    updated_at: timestamp,
    trashed_at: timestamp.nullable(),
  })
  .passthrough();

const trashOutput = z
  .object({
    batchId: id.nullable(),
    affectedCount: z.number().int().nonnegative(),
    status: z.enum(['trashed', 'restored', 'emptied']),
  })
  .strict();
const operationUndoOutput = z
  .object({
    originalReceiptId: id,
    undoReceiptId: id,
    status: z.literal('undone'),
  })
  .strict();

const noteTagsOutput = z
  .object({ noteId: id, tags: z.array(z.string().min(1).max(80)).max(20) })
  .strict();
const noteLinkOutput = z
  .object({
    id,
    sourceNoteId: id,
    targetNoteId: id,
    relationType: z.enum(['related', 'supports', 'contradicts', 'continues']),
  })
  .strict();
const captureFileOutput = z
  .object({ captureId: id, noteId: id, state: z.literal('reviewed') })
  .strict();
const noteImportOutput = z
  .object({
    jobId: id,
    status: z.enum(['preview', 'committing', 'completed']),
    totalCount: z.number().int().nonnegative().max(500),
    createCount: z.number().int().nonnegative().max(500),
    duplicateCount: z.number().int().nonnegative().max(500),
    unsupportedCount: z.number().int().nonnegative().max(500),
    committedCount: z.number().int().nonnegative().max(500),
    remainingCount: z.number().int().nonnegative().max(500),
  })
  .strict();
const reviewCompleteOutput = z
  .object({
    reviewId: id,
    status: z.literal('completed'),
    resolvedCount: z.number().int().nonnegative(),
    priorityCount: z.number().int().min(0).max(5),
  })
  .strict();
const periodReviewCompleteOutput = z
  .object({
    reviewId: id,
    status: z.literal('completed'),
    kind: z.enum(['monthly', 'quarterly']),
  })
  .strict();
const notePlanningLinkOutput = z
  .object({
    noteId: id,
    targetId: id,
    targetType: z.enum(['goal', 'action']),
    status: z.enum(['linked', 'unlinked']),
  })
  .strict();
const workspacePreferencesOutput = z
  .object({
    workspaceId: id,
    timezone: z.string().min(1).max(80),
    weekStartsOn: z.number().int().min(0).max(6),
    coachingIntensity: z.enum(['calm', 'direct', 'strict']),
    aiEnabled: z.boolean(),
    weeklyReviewDay: z.number().int().min(0).max(6),
    onboardingCompletedAt: timestamp,
  })
  .strict();
const guidedOnboardingOutput = z
  .object({
    workspaceId: id,
    onboardingCompletedAt: timestamp,
    visionId: id.nullable(),
    goalId: id.nullable(),
    actionId: id.nullable(),
    captureId: id.nullable(),
  })
  .strict();
const aiBudgetOutput = z
  .object({
    workspaceId: id,
    softBudgetCents: z.number().int().min(100).max(2000),
  })
  .strict();
const dailyFocusOutput = z
  .object({
    focusOn: date,
    actionIds: z.array(id).max(5),
  })
  .strict();
const accountDeletionOutput = z
  .object({
    requestId: id,
    status: z.enum(['scheduled', 'canceled']),
    scheduledFor: timestamp.nullable(),
  })
  .strict();

const trashMoveInput = z.discriminatedUnion('itemType', [
  z.object({ itemType: z.literal('goal'), id, expectedVersion: version }).strict(),
  z.object({ itemType: z.literal('action'), id, expectedVersion: version }).strict(),
  z.object({ itemType: z.literal('note'), id, expectedVersion: version }).strict(),
  z.object({ itemType: z.literal('capture'), id }).strict(),
  z.object({ itemType: z.literal('memory'), id, expectedVersion: version }).strict(),
  z.object({ itemType: z.literal('conversation'), id }).strict(),
]);

export const operationDefinitions = {
  'vision.upsert.v1': {
    summary: 'Create or revise the active Vision.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ bodyMarkdown: z.string().min(3).max(50_000) }).strict(),
    output: visionOutput,
  },
  'goal.create.v1': {
    summary: 'Create a yearly or quarterly Goal.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        title: z.string().trim().min(3).max(1_000),
        horizonKind: z.enum(['year', 'quarter']),
        startsOn: date,
        endsOn: date,
        parentGoalId: id.nullable(),
      })
      .strict(),
    output: goalOutput,
  },
  'goal.status.v1': {
    summary: 'Change a Goal status with optimistic concurrency.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        status: z.enum(['draft', 'active', 'paused', 'achieved', 'abandoned']),
        expectedVersion: version,
      })
      .strict(),
    output: goalOutput,
  },
  'goal.update.v1': {
    summary: 'Edit a Goal, its outcome measure, deadline, and parent Goal.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        title: z.string().trim().min(3).max(1_000),
        descriptionMarkdown: z.string().max(50_000).nullable(),
        parentGoalId: id.nullable(),
        targetValue: z.number().finite().positive().nullable(),
        currentValue: z.number().finite().nonnegative().nullable(),
        unit: z.string().trim().min(1).max(80).nullable(),
        dueOn: date.nullable(),
      })
      .strict(),
    output: goalOutput,
  },
  'goal.archive.v1': {
    summary: 'Archive a Goal and its active descendants.',
    risk: 'medium',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: goalOutput,
  },
  'action.create.v1': {
    summary: 'Create a monthly or weekly Action.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        title: z.string().trim().min(3).max(1_000),
        horizonKind: z.enum(['month', 'week']),
        startsOn: date,
        endsOn: date,
        goalId: id.nullable(),
        parentActionId: id.nullable(),
        scheduledOn: date.nullable(),
      })
      .strict(),
    output: actionOutput,
  },
  'action.update.v1': {
    summary: 'Edit an Action title, description, and scheduled date.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        title: z.string().trim().min(3).max(1000),
        descriptionMarkdown: z.string().max(50_000).nullable(),
        scheduledOn: date.nullable(),
      })
      .strict(),
    output: actionOutput,
  },
  'action.move.v1': {
    summary: 'Move an Action to another Goal, parent Action, and planning horizon.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        goalId: id,
        parentActionId: id.nullable(),
        horizonKind: z.enum(['month', 'week']),
        startsOn: date,
        endsOn: date,
        scheduledOn: date,
      })
      .strict(),
    output: actionOutput,
  },
  'action.status.v1': {
    summary: 'Change an Action status with optimistic concurrency.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        status: z.enum(['open', 'in_progress', 'blocked', 'done', 'dropped']),
        expectedVersion: version,
      })
      .strict(),
    output: actionOutput,
  },
  'action.archive.v1': {
    summary: 'Archive an Action.',
    risk: 'medium',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: actionOutput,
  },
  'action-template.create.v1': {
    summary: 'Create a weekly or monthly Action template and its first dated occurrence.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        title: z.string().trim().min(3).max(1_000),
        descriptionMarkdown: z.string().max(50_000).nullable(),
        goalId: id.nullable(),
        cadence: z.enum(['weekly', 'monthly']),
        firstOccurrenceOn: date,
      })
      .strict(),
    output: actionTemplateOutput,
  },
  'action-template.update.v1': {
    summary: 'Edit an Action template and its next recurrence schedule.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        title: z.string().trim().min(3).max(1_000),
        descriptionMarkdown: z.string().max(50_000).nullable(),
        goalId: id.nullable(),
        cadence: z.enum(['weekly', 'monthly']),
        nextOccurrenceOn: date,
      })
      .strict(),
    output: actionTemplateOutput,
  },
  'action-template.status.v1': {
    summary: 'Pause or resume future occurrences for an Action template.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        status: z.enum(['active', 'paused']),
      })
      .strict(),
    output: actionTemplateOutput,
  },
  'action-template.materialize.v1': {
    summary: 'Create every due ordinary Action from one recurring template, without duplicates.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp', 'automation'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        throughOn: date,
      })
      .strict(),
    output: actionTemplateOutput,
  },
  'action-template.archive.v1': {
    summary: 'Archive an Action template without changing its existing Action occurrences.',
    risk: 'medium',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: actionTemplateOutput,
  },
  'notification.refresh.v1': {
    summary: 'Refresh due in-app planning notifications without creating duplicates.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp', 'automation'],
    reversible: true,
    input: z.object({}).strict(),
    output: notificationRefreshOutput,
  },
  'notification.read.v1': {
    summary: 'Mark one in-app planning notification as read.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: notificationOutput,
  },
  'notification.dismiss.v1': {
    summary: 'Dismiss one in-app planning notification.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: notificationOutput,
  },
  'notification.preferences.v1': {
    summary: 'Configure in-app and email reminders, delivery hour, and quiet hours.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        inAppEnabled: z.boolean(),
        emailEnabled: z.boolean(),
        emailHour: z.number().int().min(0).max(23),
        quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict(),
    output: notificationPreferencesOutput,
  },
  'conversation.rename.v1': {
    summary: 'Rename a durable AI conversation.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
    output: conversationOutput,
  },
  'conversation.status.v1': {
    summary: 'Archive or restore a durable AI conversation.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        expectedVersion: version,
        status: z.enum(['active', 'archived']),
      })
      .strict(),
    output: conversationOutput,
  },
  'conversation.delete.v1': {
    summary: 'Permanently delete a conversation and all of its messages and proposals.',
    risk: 'high',
    exposure: ['ui', 'chat'],
    reversible: false,
    input: z
      .object({
        id,
        expectedVersion: version,
        confirmation: z.literal('DELETE CONVERSATION'),
      })
      .strict(),
    output: conversationDeleteOutput,
  },
  'capture-proposal.item-update.v1': {
    summary: 'Edit one pending Capture Proposal item before approval.',
    risk: 'low',
    exposure: ['ui'],
    reversible: true,
    input: z
      .object({
        id,
        batchId: id,
        expectedVersion: version,
        input: z.record(z.string(), z.unknown()),
        summary: z.string().trim().min(1).max(300),
      })
      .strict(),
    output: captureProposalItemOutput,
  },
  'capture-proposal.dismiss.v1': {
    summary: 'Dismiss one pending Capture Proposal batch without changing its source.',
    risk: 'low',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: captureProposalBatchOutput,
  },
  'capture-proposal.apply.v1': {
    summary: 'Atomically apply every exact Operation in one reviewed Capture Proposal batch.',
    risk: 'medium',
    exposure: ['ui', 'chat'],
    reversible: false,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: captureProposalBatchOutput,
  },
  'capture.create.v1': {
    summary: 'Store immutable raw Capture text.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        rawText: z
          .string()
          .max(60_000)
          .refine((value) => value.trim().length >= 3),
        source: z.enum(['typed', 'voice', 'import']),
      })
      .strict(),
    output: captureOutput,
  },
  'note.create.v1': {
    summary: 'Create a Note in the private vault.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        title: z.string().trim().min(1).max(300),
        bodyMarkdown: z.string().max(500_000),
        parentNoteId: id.nullable(),
      })
      .strict(),
    output: noteOutput,
  },
  'note.update.v1': {
    summary: 'Update Note Markdown and preserve the prior revision.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        id,
        title: z.string().trim().min(1).max(300),
        bodyMarkdown: z.string().max(500_000),
        expectedVersion: version,
      })
      .strict(),
    output: noteOutput,
  },
  'note.move.v1': {
    summary: 'Move a Note without creating a hierarchy cycle.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({ id, parentNoteId: id.nullable(), sortKey: z.number(), expectedVersion: version })
      .strict(),
    output: noteOutput,
  },
  'note.archive.v1': {
    summary: 'Archive a Note while retaining recovery history.',
    risk: 'medium',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, expectedVersion: version }).strict(),
    output: noteOutput,
  },
  'note.ai-exclusion.v1': {
    summary: 'Exclude or re-include one Note in AI retrieval.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ id, aiExcluded: z.boolean(), expectedVersion: version }).strict(),
    output: noteOutput,
  },
  'note.import-preview.v1': {
    summary:
      'Stage a bounded Notes import and report hierarchy, duplicates, and unsupported items.',
    risk: 'low',
    exposure: ['ui'],
    reversible: true,
    input: z
      .object({
        sourceName: z.string().trim().min(1).max(255),
        sourceType: z.enum(['notion', 'obsidian', 'generic']),
        items: z
          .array(
            z
              .object({
                sourcePath: z.string().min(1).max(1000),
                title: z.string().trim().min(1).max(300),
                bodyMarkdown: z.string().max(50_000),
                parentSourcePath: z.string().min(1).max(1000).nullable(),
                unsupportedReason: z.string().max(500).nullable(),
                aiExcluded: z.boolean(),
                // Only an exported vault records sibling order. Any other
                // source sends null and keeps the dependency-safe staging
                // order. The bound is the integer headroom of
                // notes.sort_key numeric(24, 12).
                sourceSortKey: z.number().min(-999_999_999_999).max(999_999_999_999).nullable(),
              })
              .strict()
          )
          .min(1)
          .max(500),
      })
      .strict(),
    output: noteImportOutput,
  },
  'note.import-commit.v1': {
    summary: 'Commit the next parent-safe batch from a reviewed Notes import.',
    risk: 'low',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z.object({ jobId: id, batchSize: z.number().int().min(1).max(50) }).strict(),
    output: noteImportOutput,
  },
  'memory.create.v1': {
    summary: 'Create an explicit, user-visible assistant Memory.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        statement: z.string().trim().min(1).max(2_000),
        sourceType: z.enum(['user', 'conversation', 'capture', 'note', 'review']),
        sourceId: id.nullable(),
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.sourceType === 'user') !== (value.sourceId === null)) {
          context.addIssue({
            code: 'custom',
            message: 'User Memory has no source record; all other Memory requires one.',
          });
        }
      }),
    output: memoryOutput,
  },
  'memory.update.v1': {
    summary: 'Revise one explicit assistant Memory with optimistic concurrency.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({ id, statement: z.string().trim().min(1).max(2_000), expectedVersion: version })
      .strict(),
    output: memoryOutput,
  },
  'trash.move.v1': {
    summary: 'Move one item and its owned descendants into recoverable Trash.',
    risk: 'medium',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: trashMoveInput,
    output: trashOutput,
  },
  'trash.restore.v1': {
    summary: 'Restore every item recorded in one recoverable Trash batch.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ batchId: id }).strict(),
    output: trashOutput,
  },
  'trash.empty.v1': {
    summary: 'Permanently delete Trash items older than the retention period.',
    risk: 'high',
    exposure: ['ui', 'chat'],
    reversible: false,
    input: z
      .object({ retentionDays: z.literal(30), confirmation: z.literal('EMPTY TRASH') })
      .strict(),
    output: trashOutput,
  },
  'operation.undo.v1': {
    summary: 'Undo one supported recent Operation when its target has not changed.',
    risk: 'medium',
    exposure: ['ui'],
    reversible: false,
    input: z.object({ receiptId: id }).strict(),
    output: operationUndoOutput,
  },
  'note.tags.set.v1': {
    summary: 'Replace one Note tag set with normalized lightweight tags.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        noteId: id,
        tags: z.array(z.string().trim().min(1).max(80)).max(20),
      })
      .strict(),
    output: noteTagsOutput,
  },
  'note.link.v1': {
    summary: 'Create one typed internal link between two Notes.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z
      .object({
        sourceNoteId: id,
        targetNoteId: id,
        relationType: z.enum(['related', 'supports', 'contradicts', 'continues']),
      })
      .strict(),
    output: noteLinkOutput,
  },
  'note.unlink.v1': {
    summary: 'Remove one typed internal link between Notes.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ linkId: id }).strict(),
    output: noteLinkOutput,
  },
  'capture.file-to-note.v1': {
    summary: 'File one immutable Capture into a Note and mark it reviewed.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ captureId: id, noteId: id }).strict(),
    output: captureFileOutput,
  },
  'review.complete-weekly.v1': {
    summary: 'Complete Weekly Review with an explicit decision for every unfinished Action.',
    risk: 'medium',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z
      .object({
        startsOn: date,
        endsOn: date,
        reflectionMarkdown: z.string().max(50_000),
        decisions: z
          .array(
            z
              .object({
                actionId: id,
                expectedVersion: version,
                resolution: z.enum(['done', 'next_week', 'blocked', 'dropped', 'left_overdue']),
                reason: z.string().trim().max(500).nullable(),
                priority: z.boolean(),
              })
              .strict()
          )
          .max(100),
      })
      .strict(),
    output: reviewCompleteOutput,
  },
  'review.complete-period.v1': {
    summary: 'Record a monthly or quarterly evidence review and durable reflection.',
    risk: 'low',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z
      .object({
        kind: z.enum(['monthly', 'quarterly']),
        startsOn: date,
        endsOn: date,
        reflectionMarkdown: z.string().trim().min(1).max(50_000),
      })
      .strict(),
    output: periodReviewCompleteOutput,
  },
  'note.goal-link.v1': {
    summary: 'Connect one Note to an active Goal.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ noteId: id, goalId: id }).strict(),
    output: notePlanningLinkOutput,
  },
  'note.goal-unlink.v1': {
    summary: 'Remove one explicit Note-to-Goal connection.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ noteId: id, goalId: id }).strict(),
    output: notePlanningLinkOutput,
  },
  'note.action-link.v1': {
    summary: 'Connect one Note to an active planning Action.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ noteId: id, actionId: id }).strict(),
    output: notePlanningLinkOutput,
  },
  'note.action-unlink.v1': {
    summary: 'Remove one explicit Note-to-Action connection.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ noteId: id, actionId: id }).strict(),
    output: notePlanningLinkOutput,
  },
  'workspace.preferences.v1': {
    summary: 'Save Workspace time, coaching, AI-processing, and review preferences.',
    risk: 'medium',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z
      .object({
        timezone: z.string().min(1).max(80),
        weekStartsOn: z.number().int().min(0).max(6),
        coachingIntensity: z.enum(['calm', 'direct', 'strict']),
        aiEnabled: z.boolean(),
        weeklyReviewDay: z.number().int().min(0).max(6),
      })
      .strict(),
    output: workspacePreferencesOutput,
  },
  'workspace.onboarding-complete.v1': {
    summary: 'Complete first-run setup and atomically create the optional starter plan.',
    risk: 'medium',
    exposure: ['ui'],
    reversible: true,
    input: z
      .object({
        timezone: z.string().min(1).max(80),
        weekStartsOn: z.number().int().min(0).max(6),
        coachingIntensity: z.enum(['calm', 'direct', 'strict']),
        aiEnabled: z.boolean(),
        weeklyReviewDay: z.number().int().min(0).max(6),
        today: date,
        visionText: z.string().trim().min(3).max(50_000).nullable(),
        goalTitle: z.string().trim().min(3).max(1_000).nullable(),
        actionTitle: z.string().trim().min(3).max(1_000).nullable(),
        captureText: z
          .string()
          .max(60_000)
          .refine((value) => value.trim().length >= 3)
          .nullable(),
      })
      .strict(),
    output: guidedOnboardingOutput,
  },
  'workspace.ai-budget.v1': {
    summary: 'Set the monthly Workspace AI soft-budget warning threshold.',
    risk: 'medium',
    exposure: ['ui', 'chat'],
    reversible: true,
    input: z.object({ softBudgetCents: z.number().int().min(100).max(2000) }).strict(),
    output: aiBudgetOutput,
  },
  'daily-focus.set.v1': {
    summary: 'Choose and order up to five Actions for one daily focus list.',
    risk: 'low',
    exposure: ['ui', 'chat', 'mcp'],
    reversible: true,
    input: z.object({ focusOn: date, actionIds: z.array(id).max(5) }).strict(),
    output: dailyFocusOutput,
  },
  'account.deletion.schedule.v1': {
    summary: 'Schedule permanent account and Workspace deletion after a seven-day grace period.',
    risk: 'high',
    exposure: ['ui'],
    reversible: true,
    input: z.object({ confirmation: z.literal('DELETE MY ACCOUNT') }).strict(),
    output: accountDeletionOutput,
  },
  'account.deletion.cancel.v1': {
    summary: 'Cancel a pending account deletion during its grace period.',
    risk: 'low',
    exposure: ['ui'],
    reversible: false,
    input: z.object({ requestId: id }).strict(),
    output: accountDeletionOutput,
  },
} as const;

export const undoableOperationIds = [
  'vision.upsert.v1',
  'goal.create.v1',
  'goal.update.v1',
  'goal.status.v1',
  'goal.archive.v1',
  'action.create.v1',
  'action.update.v1',
  'action.move.v1',
  'action.status.v1',
  'action.archive.v1',
  'action-template.create.v1',
  'action-template.update.v1',
  'action-template.status.v1',
  'action-template.materialize.v1',
  'action-template.archive.v1',
  'notification.refresh.v1',
  'notification.read.v1',
  'notification.dismiss.v1',
  'notification.preferences.v1',
  'conversation.rename.v1',
  'conversation.status.v1',
  'capture-proposal.item-update.v1',
  'capture-proposal.dismiss.v1',
  'daily-focus.set.v1',
  'capture.create.v1',
  'capture.file-to-note.v1',
  'note.create.v1',
  'note.update.v1',
  'note.move.v1',
  'note.archive.v1',
  'note.ai-exclusion.v1',
  'note.import-preview.v1',
  'note.import-commit.v1',
  'note.tags.set.v1',
  'memory.create.v1',
  'memory.update.v1',
  'workspace.preferences.v1',
  'workspace.onboarding-complete.v1',
  'workspace.ai-budget.v1',
  'trash.move.v1',
  'trash.restore.v1',
  'review.complete-period.v1',
  'review.complete-weekly.v1',
  'account.deletion.schedule.v1',
  'note.link.v1',
  'note.unlink.v1',
  'note.goal-link.v1',
  'note.goal-unlink.v1',
  'note.action-link.v1',
  'note.action-unlink.v1',
] as const satisfies readonly OperationId[];

export type OperationId = keyof typeof operationDefinitions;
export type OperationSurface = 'ui' | 'chat' | 'mcp' | 'automation' | 'system';
export type OperationInput<TId extends OperationId> = z.input<
  (typeof operationDefinitions)[TId]['input']
>;
export type OperationOutput<TId extends OperationId> = z.output<
  (typeof operationDefinitions)[TId]['output']
>;

export class OperationFailure extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'OperationFailure';
  }
}

function stableFailure(message: string) {
  if (message.includes('authentication_required')) {
    return new OperationFailure('authentication_required', 'Please sign in to continue.');
  }
  if (message.includes('workspace_access_revoked')) {
    return new OperationFailure(
      'workspace_access_revoked',
      'Your access to this workspace changed.'
    );
  }
  if (message.includes('permission_denied') || message.includes('permission denied')) {
    return new OperationFailure('permission_denied', 'You do not have access to make this change.');
  }
  if (message.includes('operation_version_unsupported')) {
    return new OperationFailure(
      'operation_version_unsupported',
      'Planner AI must be upgraded before this change can sync.'
    );
  }
  if (message.includes('schema_version_unsupported')) {
    return new OperationFailure(
      'schema_version_unsupported',
      'Planner AI must be upgraded before this change can sync.'
    );
  }
  if (message.includes('version_conflict_or_not_found')) {
    return new OperationFailure(
      'version_conflict',
      'This item changed elsewhere. Refresh and try again.'
    );
  }
  if (message.includes('capture_source_is_immutable')) {
    return new OperationFailure(
      'capture_source_is_immutable',
      'A Capture keeps the words you recorded. Save the change as a Note instead.'
    );
  }
  if (message.includes('vision_required')) {
    return new OperationFailure('vision_required', 'Create a Vision before adding Goals.');
  }
  if (message.includes('parent_not_found') || message.includes('goal_not_found')) {
    return new OperationFailure('parent_not_found', 'The related item no longer exists.');
  }
  if (message.includes('template_paused')) {
    return new OperationFailure(
      'template_paused',
      'Resume this recurring Action before creating due occurrences.'
    );
  }
  if (
    message.includes('invalid_action_template') ||
    message.includes('invalid_materialization_window')
  ) {
    return new OperationFailure('invalid_input', 'Check the recurring Action and try again.');
  }
  if (message.includes('relation_not_found') || message.includes('note_link_not_found')) {
    return new OperationFailure('relation_not_found', 'This connection was already removed.');
  }
  if (message.includes('undo_conflict') || message.includes('undo_not_available')) {
    return new OperationFailure(
      'undo_conflict',
      'This change cannot be undone because its record changed or the undo window expired.'
    );
  }
  if (message.includes('undo_not_supported')) {
    return new OperationFailure('undo_not_supported', 'This change does not have an undo action.');
  }
  return new OperationFailure('operation_failed', 'Planner AI could not save this change.');
}

export async function executeOperation<TId extends OperationId>(
  client: Pick<SupabaseClient, 'rpc'>,
  operationId: TId,
  input: OperationInput<TId>,
  context: { idempotencyKey: string; surface: OperationSurface }
): Promise<OperationOutput<TId>> {
  const definition = operationDefinitions[operationId];
  if (!definition.exposure.includes(context.surface as never)) {
    throw new OperationFailure('surface_not_allowed', 'This action is not available here.');
  }
  if (context.surface !== 'ui') {
    throw new OperationFailure(
      'trusted_gateway_required',
      'Chat and MCP actions must use their dedicated approval gateway.'
    );
  }

  const parsedInput = definition.input.safeParse(input);
  if (!parsedInput.success) {
    throw new OperationFailure('invalid_input', 'Check this change and try again.');
  }
  if (context.idempotencyKey.length < 8 || context.idempotencyKey.length > 200) {
    throw new OperationFailure('invalid_idempotency_key', 'This request cannot be retried safely.');
  }

  const { data, error } = await client.rpc('execute_ui_operation', {
    p_operation_id: operationId,
    p_input: parsedInput.data,
    p_idempotency_key: context.idempotencyKey,
  });
  if (error) throw stableFailure(error.message);

  const parsedOutput = definition.output.safeParse(data);
  if (!parsedOutput.success) {
    throw new OperationFailure('invalid_output', 'Planner AI returned an invalid saved result.');
  }
  return parsedOutput.data as OperationOutput<TId>;
}
