const tokenPrefix = 'planner_mcp_';
const tokenPattern = /^planner_mcp_[A-Za-z0-9_-]{43}$/;

export function parseMcpBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !tokenPattern.test(match[1])) return null;
  return match[1];
}

export function parseBearerCredential(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || match[1].length > 8192) return null;
  return match[1];
}

export function isJwtCredential(value: string) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export async function hashMcpToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createMcpToken(randomBytes: Uint8Array): string {
  if (randomBytes.byteLength !== 32) throw new Error('MCP tokens require 32 random bytes.');
  return `${tokenPrefix}${Buffer.from(randomBytes).toString('base64url')}`;
}
