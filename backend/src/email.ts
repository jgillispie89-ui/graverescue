import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM         = `GraveRescue <${process.env.RESEND_FROM_EMAIL || 'noreply@graverescue.com'}>`;
const REPLY_TO     = process.env.ADMIN_NOTIFY_EMAIL || 'jgillispie89@gmail.com';
const BASE         = process.env.FRONTEND_URL || 'https://graverescue.com';
const ADMIN_NOTIFY = process.env.ADMIN_NOTIFY_EMAIL || 'jgillispie89@gmail.com';

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastErr!: Error;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            const status: number | undefined = err?.statusCode ?? err?.status;
            console.error(
                `[email] ${label} attempt ${attempt}/${maxAttempts} failed:`,
                err.message,
                status ? `(HTTP ${status})` : ''
            );
            if (status && status >= 400 && status < 500) break;
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastErr;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${BASE}/verify?token=${token}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:     FROM,
            to:       [to],
            replyTo:  REPLY_TO,
            subject:  'Verify your GraveRescue email',
            text: [
                `Hi,`,
                ``,
                `Thanks for joining GraveRescue! Click the link below to verify your email address:`,
                ``,
                link,
                ``,
                `This link expires in 48 hours. If you didn't create an account, you can ignore this email.`,
                ``,
                `— The GraveRescue team`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `verification to ${to}`);
    console.log(`[email] Verification email sent successfully to ${to}`);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const link = `${BASE}/reset-password?token=${token}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:     FROM,
            to:       [to],
            replyTo:  REPLY_TO,
            subject:  'Reset your GraveRescue password',
            text: [
                `Hi,`,
                ``,
                `We received a request to reset your GraveRescue password. Click the link below to set a new one:`,
                ``,
                link,
                ``,
                `This link expires in 1 hour. If you didn't request a password reset, you can ignore this email — your password will not change.`,
                ``,
                `— The GraveRescue team`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `password reset to ${to}`);
    console.log(`[email] Password reset email sent successfully to ${to}`);
}

interface FeedbackPayload {
    id:              string;
    type:            string;
    subject:         string;
    description:     string;
    submitterName:   string | null;
    submitterEmail:  string | null;
    submitterUserId: string | null;
    createdAt:       Date | string;
}

export async function sendFeedbackNotificationEmail(fb: FeedbackPayload): Promise<void> {
    const labels: Record<string, string> = {
        suggestion: 'Suggestion', bug_report: 'Bug Report',
        cemetery_correction: 'Cemetery Correction', other: 'Other',
    };
    const label = labels[fb.type] ?? fb.type;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:    FROM,
            to:      [ADMIN_NOTIFY],
            replyTo: fb.submitterEmail ?? REPLY_TO,
            subject: `[GraveRescue Feedback] [${label}] - ${fb.subject}`,
            text: [
                `New feedback submitted on GraveRescue.`,
                ``,
                `Type:         ${label}`,
                `Subject:      ${fb.subject}`,
                ``,
                `Description:`,
                fb.description,
                ``,
                `Submitter:    ${fb.submitterName   || '(not provided)'}`,
                `Email:        ${fb.submitterEmail  || '(not provided)'}`,
                `User ID:      ${fb.submitterUserId || 'anonymous'}`,
                `Submitted:    ${new Date(fb.createdAt as any).toUTCString()}`,
                `Feedback ID:  ${fb.id}`,
                ``,
                `Open admin panel: ${BASE}`,
                ``,
                `— GraveRescue automated alert`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `feedback notification for "${fb.subject}"`);
    console.log(`[email] Feedback notification sent for "${fb.subject}"`);
}

export async function sendAdminNotificationEmail(email: string, userId: string): Promise<void> {
    const timestamp = new Date().toUTCString();
    const adminLink = `${BASE}/admin/users/${userId}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:    FROM,
            to:      [ADMIN_NOTIFY],
            subject: `New GraveRescue signup: ${email}`,
            text: [
                `A new user just registered on GraveRescue.`,
                ``,
                `Email: ${email}`,
                `Registered: ${timestamp}`,
                `Admin link: ${adminLink}`,
                ``,
                `— GraveRescue automated alert`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `admin notification for ${email}`);
}
