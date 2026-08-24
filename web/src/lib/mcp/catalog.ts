import { operationDefinitions, type OperationId } from '@/lib/operations';

export const workspaceSnapshotGrant = {
  id: 'workspace.snapshot.read.v1',
  summary:
    'Read the active Vision, Goals, Actions, recurring Action templates, daily focus, and AI-visible Note titles.',
  risk: 'read',
} as const;

export const mcpOperationIds = (Object.keys(operationDefinitions) as OperationId[]).filter(
  (operationId) => operationDefinitions[operationId].exposure.includes('mcp' as never)
);

export const mcpGrantOptions = [
  workspaceSnapshotGrant,
  ...mcpOperationIds.map((id) => ({
    id,
    summary: operationDefinitions[id].summary,
    risk: operationDefinitions[id].risk,
  })),
];

export type McpGrantId = (typeof mcpGrantOptions)[number]['id'];
