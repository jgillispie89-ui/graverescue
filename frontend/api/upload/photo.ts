import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabase.js';
import { getUser, cors } from '../_helpers.js';
import { IncomingForm } from 'formidable';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!user.verified) return res.status(403).json({ error: 'Verify your email before uploading photos' });

    const bucket = (req.query.bucket as string) || 'cemetery-photos';
    if (!['cemetery-photos', 'headstone-photos'].includes(bucket))
        return res.status(400).json({ error: 'Invalid bucket' });

    try {
        const form = new IncomingForm({ maxFileSize: 20 * 1024 * 1024 });
        const [, files] = await form.parse(req);
        const file = Array.isArray(files.photo) ? files.photo[0] : files.photo;
        if (!file) return res.status(400).json({ error: 'No image file provided' });
        if (!ALLOWED_MIME.has(file.mimetype || ''))
            return res.status(400).json({ error: 'Invalid file type' });

        const buf = readFileSync(file.filepath);
        const stem = crypto.randomUUID();

        const [fullBuf, thumbBuf] = await Promise.all([
            sharp(buf)
                .rotate()
                .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 82 })
                .toBuffer(),
            sharp(buf)
                .rotate()
                .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 75 })
                .toBuffer(),
        ]);

        const fullKey  = `photos/${stem}.webp`;
        const thumbKey = `thumbs/${stem}.webp`;

        const [fullUpload, thumbUpload] = await Promise.all([
            supabase.storage.from(bucket).upload(fullKey, fullBuf, { contentType: 'image/webp', upsert: false }),
            supabase.storage.from(bucket).upload(thumbKey, thumbBuf, { contentType: 'image/webp', upsert: false }),
        ]);

        if (fullUpload.error) throw fullUpload.error;
        if (thumbUpload.error) throw thumbUpload.error;

        const { data: { publicUrl: url } }       = supabase.storage.from(bucket).getPublicUrl(fullKey);
        const { data: { publicUrl: thumb_url } }  = supabase.storage.from(bucket).getPublicUrl(thumbKey);

        return res.json({ url, thumb_url });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
