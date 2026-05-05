import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../token.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    try {
        (req as any).user = verifyToken(h.slice(7));
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
        try { (req as any).user = verifyToken(h.slice(7)); } catch {}
    }
    next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    requireAuth(req, res, () => {
        if ((req as any).user?.role !== 'admin')
            return res.status(403).json({ error: 'Admin access required' });
        next();
    });
}
