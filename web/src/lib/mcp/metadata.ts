export function mcpPublicUrls(requestUrl?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const appOrigin = configured
    ? new URL(configured).origin
    : requestUrl && process.env.NODE_ENV !== 'production'
      ? new URL(requestUrl).origin
      : null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!appOrigin || !supabaseUrl) return null;
  const resource = `${appOrigin}/api/mcp`;
  return {
    appOrigin,
    resource,
    resourceMetadata: `${appOrigin}/.well-known/oauth-protected-resource/api/mcp`,
    authorizationServer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
  };
}

export function protectedResourceMetadata(requestUrl?: string) {
  const urls = mcpPublicUrls(requestUrl);
  if (!urls) return null;
  return {
    resource: urls.resource,
    authorization_servers: [urls.authorizationServer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email'],
    resource_name: 'Planner AI MCP',
    resource_documentation: `${urls.appOrigin}/settings/mcp`,
  };
}
