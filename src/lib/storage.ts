import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomToken } from './crypto';

// Paths are built with plain strings on purpose: Turbopack traces path.join/path.resolve
// calls with runtime values and then tries to scan the whole project (including the
// unreadable ./data/postgres), which breaks `next build`.

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // Bluesky's per-image limit is ~1MB, X is 5MB

function root() {
  return (process.env.UPLOAD_DIR || './uploads').replace(/\/+$/, '');
}

function orgDir(orgId: string) {
  // orgId is a cuid we generated, but guard anyway
  if (!/^[a-z0-9]+$/i.test(orgId)) throw new Error('Invalid org id');
  return `${root()}/${orgId}`;
}

export async function saveUpload(orgId: string, file: File) {
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) throw new Error('Only JPEG, PNG, GIF and WebP images are supported');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Images must be 5 MB or smaller');

  const fileName = `${randomToken(12)}.${ext}`;
  const dir = orgDir(orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${fileName}`, Buffer.from(await file.arrayBuffer()));
  return { fileName, mimeType: file.type, size: file.size };
}

export async function readUpload(orgId: string, fileName: string) {
  if (!/^[A-Za-z0-9_-]+\.(jpg|png|gif|webp)$/.test(fileName)) throw new Error('Invalid file name');
  return readFile(`${orgDir(orgId)}/${fileName}`);
}
