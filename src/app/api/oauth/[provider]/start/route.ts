import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { requireOrg } from '@/lib/auth';
import { randomToken } from '@/lib/crypto';
import { getProvider, isProviderId } from '@/lib/providers';

export async function GET(_: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  await requireOrg('ADMIN');
  const { provider: providerId } = await params;
  if (!isProviderId(providerId)) return new NextResponse('Unknown provider', { status: 404 });

  const provider = getProvider(providerId);
  if (provider.connectType !== 'oauth') return new NextResponse('Not an OAuth provider', { status: 400 });
  if (!provider.isConfigured()) {
    return NextResponse.redirect(
      new URL(`/channels?error=${encodeURIComponent(`${provider.name} is not configured in .env`)}`, process.env.APP_URL),
    );
  }

  const state = randomToken(16);
  const codeVerifier = randomToken(48);
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const redirectUri = `${process.env.APP_URL}/api/oauth/${providerId}/callback`;

  const res = NextResponse.redirect(provider.authorizeUrl({ state, redirectUri, codeChallenge }));
  res.cookies.set(`oauth_${providerId}`, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/api/oauth/${providerId}`,
    maxAge: 600,
  });
  return res;
}
