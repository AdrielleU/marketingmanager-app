import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireOrg } from '@/lib/auth';
import { saveUpload } from '@/lib/storage';

export async function POST(req: NextRequest) {
  const { org } = await requireOrg();
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });

  try {
    const stored = await saveUpload(org.id, file);
    const media = await db.media.create({
      data: { orgId: org.id, ...stored },
      select: { id: true, fileName: true },
    });
    return NextResponse.json({ id: media.id, url: `/media/${org.id}/${media.fileName}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 400 });
  }
}
