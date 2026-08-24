import { NextResponse } from 'next/server';
import { protectedResourceMetadata } from '@/lib/mcp/metadata';

export function GET(request: Request) {
  const metadata = protectedResourceMetadata(request.url);
  if (!metadata) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  return NextResponse.json(metadata, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
