import {
  assistantReadOperationIdForToolName,
  parseAssistantReadOperation,
  type AssistantReadOperationId,
} from '@/lib/assistant/read-operations';

export type AssistantReadEvalFixture = {
  id: string;
  route: string;
  userMessage: string;
  expected: {
    operationId: AssistantReadOperationId | null;
    recordId?: string;
    recordType?: 'goal' | 'action' | 'note' | 'memory';
    queryIncludes?: string;
  };
};

export function evaluateAssistantReadRequest(
  fixture: AssistantReadEvalFixture,
  toolCalls: Array<{
    type?: string;
    function?: { name?: string; arguments?: string };
  }>
) {
  const failures: string[] = [];
  if (toolCalls.length > 1) failures.push('more_than_one_read');
  const call = toolCalls[0];
  if (fixture.expected.operationId === null) {
    if (call) failures.push('unexpected_read');
    return { passed: failures.length === 0, failures, operation: null };
  }
  if (!call?.function?.name || typeof call.function.arguments !== 'string') {
    return { passed: false, failures: [...failures, 'missing_read'], operation: null };
  }
  const operationId = assistantReadOperationIdForToolName(call.function.name);
  let rawInput: unknown = null;
  try {
    rawInput = JSON.parse(call.function.arguments);
  } catch {
    failures.push('invalid_arguments');
  }
  const operation = operationId ? parseAssistantReadOperation(operationId, rawInput) : null;
  if (!operation) failures.push('invalid_read');
  if (operation?.operationId !== fixture.expected.operationId) failures.push('wrong_operation');
  if (operation?.operationId === 'workspace.record.read.v1') {
    if (fixture.expected.recordId && operation.input.id !== fixture.expected.recordId) {
      failures.push('wrong_record');
    }
    if (fixture.expected.recordType && operation.input.type !== fixture.expected.recordType) {
      failures.push('wrong_record_type');
    }
  }
  if (
    operation?.operationId === 'workspace.search.v1' &&
    fixture.expected.queryIncludes &&
    !operation.input.query
      .toLocaleLowerCase('en-US')
      .includes(fixture.expected.queryIncludes.toLocaleLowerCase('en-US'))
  ) {
    failures.push('wrong_query');
  }
  return { passed: failures.length === 0, failures, operation };
}
