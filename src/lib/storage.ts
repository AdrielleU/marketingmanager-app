import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomToken } from './crypto';

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Bluesky's per-image limit is ~1MB, X is 5MB

function root() {
  return path.resolve(process.env.UPLOAD_DIR ?? './uploads');
}

function orgDir(orgId: string) {
  // orgId is a cuid we generated, but guard anyway
  if (!/^[a-z0-9]+$/i.test(orgId)) throw new Error('Invalid org id');
  return path.join(root(), orgId);
}

export async function saveUpload(orgId: string, file: File) {
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) throw new Error('Only JPEG, PNG, GIF and WebP images are supported');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Images must be 5 MB or smaller');

  const fileName = `${randomToken(12)}.${ext}`;
  const dir = orgDir(orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));
  return { fileName, mimeType: file.type, size: file.size };
}

export async function readUpload(orgId: string, fileName: string) {
  if (!/^[A-Za-z0-9_-]+\.(jpg|png|gif|webp)$/.test(fileName)) throw new Error('Invalid file name');
  return readFile(path.join(orgDir(orgId), fileName));
}
