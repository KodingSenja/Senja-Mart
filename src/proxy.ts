import { type NextRequest } from 'next/server';
import { updateSession } from 'lib/supabase/middleware';

/**
 * Proxy — Next.js 16 renamed the `middleware` convention to `proxy`
 * (middleware.ts is deprecated). Next.js only auto-loads this file
 * (src/proxy.ts), so the Supabase session refresh lives here.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
  ],
};
