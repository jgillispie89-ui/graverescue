import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
        cb(null, ALLOWED_MIME.has(file.mimetype));
    },
});

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

async function uploadBuffer(buf: Buffer, key: string, contentType: string) {
    await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: buf,
        ContentType: contentType,
    }));
    return `${process.env.R2_PUBLIC_URL}/${key}`;
}

router.post('/photo', requireAuth, upload.single('photo'), async (req, res) => {
    const user = (req as any).user;
    if (!user.verified)
        return res.status(403).json({ error: 'Verify your email before uploading photos' });
    if (!req.file)
        return res.status(400).json({ error: 'No image file provided' });

    const stem = crypto.randomUUID();
    const ext = 'webp';

    const [fullBuf, thumbBuf] = await Promise.all([
        sharp(req.file.buffer)
            .rotate()
            .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer(),
        sharp(req.file.buffer)
            .rotate()
            .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer(),
    ]);

    const [url, thumb_url] = await Promise.all([
        uploadBuffer(fullBuf, `photos/${stem}.${ext}`, 'image/webp'),
        uploadBuffer(thumbBuf, `thumbs/${stem}.${ext}`, 'image/webp'),
    ]);

    res.json({ url, thumb_url });
});

export default router;
