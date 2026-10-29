import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { saveConnectedAccount } from '@/lib/channels';
import { createLogger } from '@/lib/logger';
import { getProvider, isProviderId } from '@/lib/providers';

const log = createLogger('oauth');

function back(message?: string) {
  const url = new URL('/channels', process.env.APP_URL);
  if (message) url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { org } = await requireOrg('ADMIN');
  const { provider: providerId } = await params;
  if (!isProviderId(providerId)) return back('Unknown provider');
  const provider = getProvider(providerId);
  if (provider.connectType !== 'oauth') return back('Not an OAuth provider');

  const query = req.nextUrl.searchParams;
  if (query.get('error')) return back(query.get('error_description') ?? query.get('error')!);

  let saved: { state: string; codeVerifier: string } | null = null;
  try {
    saved = JSON.parse(req.cookies.get(`oauth_${providerId}`)?.value ?? 'null');
  } catch {}
  if (!saved || saved.state !== query.get('state') || !query.get('code')) {
    return back('The connection attempt expired, please try again');
  }

  try {
    const account = await provider.exchangeCode({
      code: query.get('code')!,
      redirectUri: `${process.env.APP_URL}/api/oauth/${providerId}/callback`,
      codeVerifier: saved.codeVerifier,
    });
    await saveConnectedAccount(org.id, providerId, account);
  } catch (e) {
    log.error('connect failed', { provider: providerId, orgId: org.id, error: e });
    return back(e instanceof Error ? e.message : 'Could not connect');
  }

  const res = back();
  res.cookies.delete(`oauth_${providerId}`);
  return res;
}
