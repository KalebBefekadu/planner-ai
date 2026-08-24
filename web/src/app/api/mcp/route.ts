import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashMcpToken,
  isJwtCredential,
  parseBearerCredential,
  parseMcpBearerToken,
} from '@/lib/mcp/auth';
import { mcpOperationIds, workspaceSnapshotGrant } from '@/lib/mcp/catalog';
import { mcpPublicUrls } from '@/lib/mcp/metadata';
import { operationDefinitions } from '@/lib/operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxRequestBytes = 256_000;

type SharedClaims = {
  workspace_id: string;
  owner_user_id: string;
  allowed_operations: string[];
};
type TokenClaims = SharedClaims & { credential: 'manual'; token_id: string };
type OAuthClaims = SharedClaims & {
  credential: 'oauth';
  grant_id: string;
  client: SupabaseClient;
};
type McpClaims = TokenClaims | OAuthClaims;

function jsonRpcError(status: number, message: string, headers?: HeadersInit) {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } }
  );
}

function configuredEndpoint(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return new URL(configured);
  if (process.env.NODE_ENV === 'production') return null;
  return new URL(request.url);
}

async function authenticate(request: Request): Promise<McpClaims | null> {
  const authorization = request.headers.get('authorization');
  const manualToken = parseMcpBearerToken(authorization);
  const credential = parseBearerCredential(authorization);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!credential || !url || !anonKey) return null;

  if (manualToken) {
    const client = createSupabaseClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc('authenticate_mcp_token', {
      p_token_hash: await hashMcpToken(manualToken),
    });
    if (error || !Array.isArray(data) || data.length !== 1) return null;
    const claims = data[0] as Partial<TokenClaims>;
    if (
      typeof claims.token_id !== 'string' ||
      typeof claims.workspace_id !== 'string' ||
      typeof claims.owner_user_id !== 'string' ||
      !Array.isArray(claims.allowed_operations)
    ) {
      return null;
    }
    return { ...(claims as TokenClaims), credential: 'manual' };
  }

  if (!isJwtCredential(credential)) return null;
  const client = createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${credential}` } },
  });
  const verified = await client.auth.getClaims(credential);
  const verifiedClaims = verified.data?.claims as Record<string, unknown> | undefined;
  if (
    verified.error ||
    typeof verifiedClaims?.sub !== 'string' ||
    typeof verifiedClaims.client_id !== 'string'
  ) {
    return null;
  }
  const { data, error } = await client.rpc('authenticate_mcp_oauth_grant');
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const claims = data[0] as Partial<OAuthClaims>;
  if (
    typeof claims.grant_id !== 'string' ||
    typeof claims.workspace_id !== 'string' ||
    typeof claims.owner_user_id !== 'string' ||
    !Array.isArray(claims.allowed_operations)
  ) {
    return null;
  }
  return { ...(claims as OAuthClaims), credential: 'oauth', client };
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError() {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: 'Planner AI could not complete this operation.' }],
  };
}

function buildServer(claims: McpClaims) {
  const server = new McpServer({ name: 'Planner AI', version: '1.0.0' });
  const allowed = new Set(claims.allowed_operations);
  const admin = claims.credential === 'manual' ? createAdminClient() : null;

  if (allowed.has(workspaceSnapshotGrant.id)) {
    server.registerTool(
      'planner_workspace_snapshot',
      {
        title: 'Read Planner AI workspace',
        description: workspaceSnapshotGrant.summary,
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async () => {
        const { data, error } =
          claims.credential === 'manual'
            ? await admin!.rpc('read_mcp_workspace_snapshot', { p_token_id: claims.token_id })
            : await claims.client.rpc('read_mcp_oauth_workspace_snapshot', {
                p_grant_id: claims.grant_id,
              });
        return error ? toolError() : toolResult(data);
      }
    );
  }

  for (const operationId of mcpOperationIds) {
    if (!allowed.has(operationId)) continue;
    const definition = operationDefinitions[operationId];
    server.registerTool(
      `planner_${operationId.replaceAll('.', '_')}`,
      {
        title: operationId,
        description: definition.summary,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: false,
          destructiveHint: definition.risk === 'medium',
          idempotentHint: false,
        },
      },
      async (input: unknown) => {
        const parsed = definition.input.safeParse(input);
        if (!parsed.success) return toolError();
        const params = {
          p_operation_id: operationId,
          p_input: parsed.data,
          p_idempotency_key: crypto.randomUUID(),
        };
        const { data, error } =
          claims.credential === 'manual'
            ? await admin!.rpc('execute_mcp_operation', {
                p_token_id: claims.token_id,
                ...params,
              })
            : await claims.client.rpc('execute_mcp_oauth_operation', {
                p_grant_id: claims.grant_id,
                ...params,
              });
        return error ? toolError() : toolResult(data);
      }
    );
  }
  return server;
}

export async function POST(request: Request) {
  const endpoint = configuredEndpoint(request);
  if (!endpoint) return jsonRpcError(503, 'MCP endpoint configuration is incomplete.');
  const origin = request.headers.get('origin');
  if (origin && origin !== endpoint.origin) return jsonRpcError(403, 'Origin is not allowed.');

  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxRequestBytes) {
    return jsonRpcError(413, 'MCP request is too large.');
  }

  const claims = await authenticate(request);
  if (!claims) {
    const urls = mcpPublicUrls(request.url);
    return jsonRpcError(401, 'A valid Planner AI MCP token is required.', {
      ...(urls
        ? { 'WWW-Authenticate': `Bearer resource_metadata="${urls.resourceMetadata}"` }
        : {}),
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxRequestBytes) {
    return jsonRpcError(413, 'MCP request is too large.');
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonRpcError(400, 'MCP request must be valid JSON.');
  }

  if (process.env.PLANNER_DATA_MODEL !== 'canonical') {
    return jsonRpcError(503, 'MCP is unavailable until the canonical data model is enabled.');
  }

  const server = buildServer(claims);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts: [endpoint.host],
    allowedOrigins: [endpoint.origin],
    enableDnsRebindingProtection: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody: body });
  } catch {
    return jsonRpcError(500, 'Planner AI could not process this MCP request.');
  } finally {
    await server.close();
  }
}

export function GET() {
  return jsonRpcError(405, 'Use POST for this stateless MCP endpoint.');
}

export function DELETE() {
  return jsonRpcError(405, 'This MCP endpoint does not maintain server sessions.');
}
