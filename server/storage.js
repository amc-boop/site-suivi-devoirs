// Stockage des photos : Supabase Storage en ligne, dossier data/uploads en local.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './db.js';

const BUCKET = 'photos';
const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, '');
// Nouvelle clé secrète (sb_secret_…) ou ancienne clé service_role : les deux noms sont acceptés
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
export const usingSupabaseStorage = Boolean(URL_ && KEY);
const LOCAL = path.join(DATA_DIR, 'uploads');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif' };
export const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
// Les clés « sb_secret_ » ne sont pas des JWT : elles passent seulement dans l'en-tête apikey
const headers = (extra = {}) => (KEY?.startsWith('sb_') ? { apikey: KEY, ...extra } : { Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });

let bucketReady;
async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = fetch(`${URL_}/storage/v1/bucket`, {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 10 * 1024 * 1024 }),
    }).then(() => true).catch(() => { bucketReady = null; });
  }
  return bucketReady;
}

export async function savePhoto(buffer, mime) {
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[mime] || '.jpg'}`;
  if (usingSupabaseStorage) {
    await ensureBucket();
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${name}`, { method: 'POST', headers: headers({ 'Content-Type': mime || 'image/jpeg' }), body: buffer });
    if (!r.ok) { console.error('Supabase Storage', r.status, await r.text()); throw Object.assign(new Error("La photo n'a pas pu être enregistrée."), { status: 502 }); }
  } else {
    await fs.mkdir(LOCAL, { recursive: true });
    await fs.writeFile(path.join(LOCAL, name), buffer);
  }
  return name;
}

export async function readPhoto(name) {
  const safe = path.basename(name);
  const mime = MIME[path.extname(safe).toLowerCase()] || 'image/jpeg';
  if (usingSupabaseStorage) {
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${safe}`, { headers: headers() });
    if (!r.ok) return null;
    return { buffer: Buffer.from(await r.arrayBuffer()), mime };
  }
  try { return { buffer: await fs.readFile(path.join(LOCAL, safe)), mime }; } catch { return null; }
}

export async function deletePhoto(name) {
  const safe = path.basename(name);
  if (usingSupabaseStorage) {
    await fetch(`${URL_}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [safe] }) }).catch(() => {});
  } else {
    await fs.rm(path.join(LOCAL, safe), { force: true });
  }
}
