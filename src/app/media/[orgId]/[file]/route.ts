import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { readUpload } from '@/lib/storage';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// Media is private to the organization's members
export async function GET(_: NextRequest, { params }: { params: Promise<{ orgId: string; file: string }> }) {
  const user = await requireUser();
  const { orgId, file } = await params;
  const member = await db.membership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    select: { orgId: true },
  });
  if (!member) return new NextResponse('Not found', { status: 404 });

  try {
    const data = await readUpload(orgId, file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
