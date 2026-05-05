import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

export interface TokenPayload { id: string; email: string; role: string; verified: boolean; }

export const signToken = (p: TokenPayload) =>
    jwt.sign(p, SECRET, { expiresIn: '7d' });

export const verifyToken = (t: string) =>
    jwt.verify(t, SECRET) as TokenPayload;
