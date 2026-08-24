export type UntrustedAiDataSource =
  | 'workspace_record'
  | 'imported_note'
  | 'attachment'
  | 'website'
  | 'calendar'
  | 'mcp_response';

export function serializeUntrustedAiData(source: UntrustedAiDataSource, payload: unknown) {
  return JSON.stringify({ authority: 'data_only', source, payload });
}
