import { describe, expect, it } from 'vitest';
import {
  createMcpToken,
  hashMcpToken,
  isJwtCredential,
  parseBearerCredential,
  parseMcpBearerToken,
} from '@/lib/mcp/auth';
import { mcpGrantOptions, mcpOperationIds } from '@/lib/mcp/catalog';

describe('MCP token boundary', () => {
  const token = createMcpToken(new Uint8Array(32).fill(7));

  it('creates a fixed-shape high-entropy token and parses only exact Bearer syntax', () => {
    expect(token).toMatch(/^planner_mcp_[A-Za-z0-9_-]{43}$/);
    expect(parseMcpBearerToken(`Bearer ${token}`)).toBe(token);
    expect(parseMcpBearerToken(`bearer ${token}`)).toBeNull();
    expect(parseMcpBearerToken(`Bearer ${token} trailing`)).toBeNull();
    expect(parseMcpBearerToken('Bearer planner_mcp_short')).toBeNull();
  });

  it('hashes tokens without retaining plaintext', async () => {
    const hash = await hashMcpToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('planner_mcp_');
    await expect(hashMcpToken(token)).resolves.toBe(hash);
  });

  it('accepts a bounded OAuth JWT shape without confusing it with a manual token', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature';
    expect(parseBearerCredential(`Bearer ${jwt}`)).toBe(jwt);
    expect(isJwtCredential(jwt)).toBe(true);
    expect(parseMcpBearerToken(`Bearer ${jwt}`)).toBeNull();
    expect(parseBearerCredential(`Bearer ${'x'.repeat(8193)}`)).toBeNull();
  });

  it('offers the read snapshot plus every operation exposed to MCP', () => {
    const grants = new Set(mcpGrantOptions.map((grant) => grant.id));
    expect(grants.has('workspace.snapshot.read.v1')).toBe(true);
    for (const operationId of mcpOperationIds) expect(grants.has(operationId)).toBe(true);
  });
});
