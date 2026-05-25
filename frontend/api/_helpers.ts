import { supabase } from './_supabase.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export async function getUser(req: VercelRequest) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await supabase
        .from('users')
        .select('role, verified')
        .eq('id', user.id)
        .single();
    return profile ? { ...user, role: profile.role, verified: profile.verified } : null;
}

export function requireAuth(handler: Function) {
    return async (req: VercelRequest, res: VercelResponse) => {
        const user = await getUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        return handler(req, res, user);
    };
}

export function requireAdmin(handler: Function) {
    return async (req: VercelRequest, res: VercelResponse) => {
        const user = await getUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        return handler(req, res, user);
    };
}

export function cors(req: VercelRequest, res: VercelResponse) {
    const allowed = (process.env.CORS_ORIGIN || 'https://graverescue.com')
        .split(',')
        .map(s => s.trim());
    const origin = req.headers.origin as string;
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', allowed[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
