import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';

// =============================================================================
// Map init — centered on contiguous US
// =============================================================================
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
            },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [-96.5, 38.5],
    zoom: 4.5,
});
map.addControl(new maplibregl.NavigationControl(), 'top-left');

// =============================================================================
// Auth state
// =============================================================================
const auth = {
    token: localStorage.getItem('gr_token') || null,
    user:  JSON.parse(localStorage.getItem('gr_user') || 'null'),
};

let adminFeedbackNewCount = 0;

function saveAuth(token, user) {
    auth.token = token;
    auth.user  = user;
    localStorage.setItem('gr_token', token);
    localStorage.setItem('gr_user', JSON.stringify(user));
    renderNav();
}

function clearAuth() {
    auth.token = null;
    auth.user  = null;
    localStorage.removeItem('gr_token');
    localStorage.removeItem('gr_user');
    renderNav();
}

function authedFetch(url, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    if (auth.token) opts.headers['Authorization'] = `Bearer ${auth.token}`;
    return fetch(url, opts);
}

function renderNav() {
    const nav = document.getElementById('nav-auth');
    if (!nav) return;
    if (auth.user) {
        const unverifiedBtn = !auth.user.verified
            ? `<button class="nav-btn unverified-btn" id="btn-resend-nav" title="Verify your email to contribute — click to resend">⚠ Unverified</button>`
            : '';
        nav.innerHTML = `
            ${unverifiedBtn}
            <span class="nav-user">${esc(auth.user.email)}</span>
            ${auth.user.role === 'admin' ? `<button class="nav-btn" id="btn-admin">${adminFeedbackNewCount > 0 ? `Admin (${adminFeedbackNewCount} new)` : 'Admin'}</button>` : ''}
            <button class="nav-btn" id="btn-logout">Logout</button>
        `;
        document.getElementById('btn-resend-nav')?.addEventListener('click', resendVerification);
        document.getElementById('btn-logout')?.addEventListener('click', clearAuth);
        document.getElementById('btn-admin')?.addEventListener('click', openAdminPanel);
    } else {
        nav.innerHTML = `<button class="nav-btn" id="btn-login">Login / Register</button>`;
        document.getElementById('btn-login')?.addEventListener('click', () => openAuthModal('login'));
    }
}

// =============================================================================
// Auth modal
// =============================================================================
let authMode = 'login';

function openAuthModal(mode = 'login') {
    document.getElementById('auth-modal').classList.remove('hidden');
    setAuthMode(mode);
    setTimeout(() => document.getElementById('auth-email')?.focus(), 50);
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('auth-msg').textContent = '';
    document.getElementById('auth-email').value    = '';
    document.getElementById('auth-password').value = '';
}

function setAuthMode(mode) {
    authMode = mode;
    const isLogin    = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot   = mode === 'forgot';
    document.getElementById('auth-title').textContent          = isLogin ? 'Log in' : isRegister ? 'Create account' : 'Forgot password?';
    document.getElementById('auth-submit-btn').textContent     = isLogin ? 'Log in' : isRegister ? 'Create account' : 'Send Reset Link';
    document.getElementById('auth-submit-btn').disabled       = false;
    document.getElementById('auth-pw-hint').classList.toggle('hidden', !isRegister);
    document.getElementById('auth-pw-label').classList.toggle('hidden', isForgot);
    document.getElementById('auth-forgot-row').classList.toggle('hidden', !isLogin);
    document.getElementById('auth-toggle-prompt').textContent  = isLogin ? "Don't have an account?" : isRegister ? 'Already have an account?' : 'Remember your password?';
    document.getElementById('auth-toggle-link').textContent    = isLogin ? ' Sign up' : isRegister ? ' Log in' : ' Back to login';
    document.getElementById('auth-msg').textContent            = '';
}

document.getElementById('auth-close').addEventListener('click', closeAuthModal);

document.getElementById('auth-toggle-link').addEventListener('click', e => {
    e.preventDefault();
    if (authMode === 'forgot') setAuthMode('login');
    else setAuthMode(authMode === 'login' ? 'register' : 'login');
});

document.getElementById('auth-forgot-link').addEventListener('click', e => {
    e.preventDefault();
    setAuthMode('forgot');
});

document.getElementById('auth-email').addEventListener('keydown', e => {
    if (e.key === 'Enter' && authMode === 'forgot') document.getElementById('auth-submit-btn').click();
});

document.getElementById('auth-submit-btn').addEventListener('click', async () => {
    const msg      = document.getElementById('auth-msg');
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    msg.className   = 'form-status';
    msg.textContent = '';

    const btn      = document.getElementById('auth-submit-btn');
    const loadText = authMode === 'login' ? 'Logging in…' : authMode === 'register' ? 'Creating account…' : 'Sending…';
    const restore  = btnLoading(btn, loadText);
    const cancel   = coldStartHint(msg);

    if (authMode === 'forgot') {
        try {
            const res  = await fetch(`${API_BASE}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            cancel();
            if (!res.ok) throw new Error(data.error);
            msg.textContent = "If that address is registered, we've sent a reset link. Check your inbox (and spam folder).";
            msg.className   = 'form-status ok';
        } catch (err) {
            cancel();
            restore();
            msg.textContent = '✕ ' + err.message;
            msg.className   = 'form-status err';
        }
        return;
    }

    if (authMode === 'login') {
        try {
            const res  = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            cancel();
            if (!res.ok) throw new Error(data.error);
            saveAuth(data.token, data.user);
            closeAuthModal();
        } catch (err) {
            cancel();
            restore();
            msg.textContent = '✕ ' + err.message;
            msg.className   = 'form-status err';
        }
    } else {
        try {
            const res  = await fetch(`${API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            cancel();
            if (!res.ok) throw new Error(data.error);
            saveAuth(data.token, data.user);
            restore();
            msg.textContent = '✓ Account created! Check your email to verify your address.';
            msg.className   = 'form-status ok';
            setTimeout(closeAuthModal, 3000);
        } catch (err) {
            cancel();
            restore();
            msg.textContent = '✕ ' + err.message;
            msg.className   = 'form-status err';
        }
    }
});

document.getElementById('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-submit-btn').click();
});

// =============================================================================
// Email verification (/verify?token=XXX)
// =============================================================================
async function handleVerifyEmail() {
    if (window.location.pathname === '/reset-password') return;
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    if (!token) return;
    try {
        const res  = await fetch(`${API_BASE}/api/auth/verify?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok) {
            if (data.token && auth.user) {
                saveAuth(data.token, { ...auth.user, verified: true });
            }
            showBanner('✓ Email verified — you can now contribute!', 'ok');
        } else {
            showBanner('✕ ' + data.error, 'err');
        }
    } catch {
        showBanner('✕ Verification failed. Try again.', 'err');
    }
    window.history.replaceState({}, '', '/');
}

async function resendVerification() {
    try {
        const res  = await authedFetch(`${API_BASE}/api/auth/resend-verification`, { method: 'POST', body: '{}' });
        const data = await res.json();
        if (res.ok) {
            showBanner('✓ Verification email sent — check your inbox.', 'ok');
        } else {
            showBanner('✕ ' + data.error, 'err');
        }
    } catch {
        showBanner('✕ Could not send email. Try again later.', 'err');
    }
}

// =============================================================================
// Password reset (/reset-password?token=XXX)
// =============================================================================
let resetToken = null;

async function handleResetPassword() {
    if (window.location.pathname !== '/reset-password') return;
    const params = new URLSearchParams(window.location.search);
    resetToken   = params.get('token');
    const modal  = document.getElementById('reset-modal');
    modal.classList.remove('hidden');

    if (!resetToken) {
        document.getElementById('reset-error').textContent = 'No reset token found in the link. Please request a new password reset.';
        document.getElementById('reset-error').style.display = 'block';
        document.getElementById('reset-fields').style.display  = 'none';
        document.getElementById('reset-fields2').style.display = 'none';
        document.getElementById('reset-submit-btn').disabled = true;
    }
}

document.getElementById('reset-submit-btn').addEventListener('click', async () => {
    const msg  = document.getElementById('reset-msg');
    const pw   = document.getElementById('reset-pw').value;
    const pw2  = document.getElementById('reset-pw2').value;
    msg.className   = 'form-status';
    msg.textContent = '';

    if (pw.length < 8) {
        msg.textContent = '✕ Password must be at least 8 characters.';
        msg.className   = 'form-status err';
        return;
    }
    if (pw !== pw2) {
        msg.textContent = '✕ Passwords do not match.';
        msg.className   = 'form-status err';
        return;
    }

    const btn     = document.getElementById('reset-submit-btn');
    const restore = btnLoading(btn, 'Resetting…');
    try {
        const res  = await fetch(`${API_BASE}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken, password: pw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = '✓ Password updated! Please log in with your new password.';
        msg.className   = 'form-status ok';
        window.history.replaceState({}, '', '/');
        setTimeout(() => {
            document.getElementById('reset-modal').classList.add('hidden');
            openAuthModal('login');
        }, 2000);
    } catch (err) {
        restore();
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
});

['reset-pw', 'reset-pw2'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('reset-submit-btn').click();
    });
});

document.getElementById('reset-to-forgot').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('reset-modal').classList.add('hidden');
    window.history.replaceState({}, '', '/');
    openAuthModal('forgot');
});

function showBanner(msg, type) {
    const b = document.getElementById('site-banner');
    b.textContent = msg;
    b.className   = 'site-banner ' + type;
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 6000);
}

// =============================================================================
// Admin panel
// =============================================================================
async function openAdminPanel() {
    document.getElementById('admin-modal').classList.remove('hidden');
    await Promise.all([
        refreshAdminQueue(),
        refreshUnverifiedUsers(),
        refreshAdminFeedback(),
        refreshAdminHsQueue(),
        refreshAdminHsEditQueue(),
    ]);
}

async function refreshAdminQueue() {
    const list = document.getElementById('admin-queue');
    list.innerHTML = '<p class="hint">Loading...</p>';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/queue`);
        const rows = await res.json();
        if (!rows.length) { list.innerHTML = '<p class="hint">No pending submissions.</p>'; return; }
        list.innerHTML = rows.map(s => `
            <div class="queue-item" data-id="${s.id}">
                <div class="queue-name">${esc(s.name)}</div>
                <div class="queue-meta">${esc(prettyCemeteryType(s.cemetery_type))} · ${esc(s.city || '')}${s.state_province ? ', ' + esc(s.state_province) : ''} · by ${esc(s.submitted_by || 'unknown')}</div>
                ${s.description ? `<div class="queue-desc">${esc(s.description)}</div>` : ''}
                <div class="queue-actions">
                    <button class="btn-approve" data-id="${s.id}">✓ Approve</button>
                    <button class="btn-reject"  data-id="${s.id}">✕ Reject</button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.btn-approve').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/approve/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminQueue();
                await loadData();
            })
        );
        list.querySelectorAll('.btn-reject').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/reject/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminQueue();
            })
        );
    } catch (err) {
        list.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

async function refreshUnverifiedUsers() {
    const list = document.getElementById('admin-users');
    list.innerHTML = '<p class="hint">Loading…</p>';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/unverified-users`);
        const rows = await res.json();
        if (!rows.length) { list.innerHTML = '<p class="hint">No unverified users.</p>'; return; }
        list.innerHTML = rows.map(u => `
            <div class="queue-item" data-id="${esc(u.id)}">
                <div class="queue-name">${esc(u.email)}</div>
                <div class="queue-meta">
                    Registered: ${new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    ${u.email_send_failed ? ' &nbsp;·&nbsp; <span style="color:#c00">⚠ Verification email failed to send</span>' : ''}
                </div>
                ${u.email_send_error ? `<div class="queue-desc" style="color:#999;font-size:11px">${esc(u.email_send_error)}</div>` : ''}
                <div class="queue-actions">
                    <button class="btn-approve"   data-email="${esc(u.email)}">✓ Manually Verify</button>
                    <button class="btn-reset-pw"  data-email="${esc(u.email)}">✉ Send Reset Link</button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.btn-approve').forEach(btn =>
            btn.addEventListener('click', async () => {
                const email = btn.dataset.email;
                if (!confirm(`Manually verify ${email}?\n\nThey will need to log out and log back in for contribution access to unlock.`)) return;
                const r = await authedFetch(`${API_BASE}/api/admin/verify-user`, {
                    method: 'POST',
                    body: JSON.stringify({ email }),
                });
                const data = await r.json();
                if (r.ok) {
                    showBanner(`✓ ${email} verified successfully.`, 'ok');
                    await refreshUnverifiedUsers();
                } else {
                    alert('Verify failed: ' + (data.error || 'unknown error'));
                }
            })
        );

        list.querySelectorAll('.btn-reset-pw').forEach(btn =>
            btn.addEventListener('click', async () => {
                const email = btn.dataset.email;
                if (!confirm(`Send a password reset email to ${email}?`)) return;
                const r = await authedFetch(`${API_BASE}/api/admin/send-password-reset`, {
                    method: 'POST',
                    body: JSON.stringify({ email }),
                });
                const data = await r.json();
                if (r.ok) {
                    showBanner(`✓ Password reset email sent to ${email}.`, 'ok');
                } else {
                    alert('Failed to send: ' + (data.error || 'unknown error'));
                }
            })
        );
    } catch (err) {
        list.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

document.getElementById('admin-close').addEventListener('click', () => {
    document.getElementById('admin-modal').classList.add('hidden');
});

// =============================================================================
// Admin feedback
// =============================================================================
function prettyFbType(t) {
    return { suggestion: 'Suggestion', bug_report: 'Bug Report', cemetery_correction: 'Cemetery Correction', other: 'Other' }[t] ?? t;
}
function prettyFbStatus(s) {
    return { new: 'New', in_progress: 'In Progress', resolved: 'Resolved', dismissed: 'Dismissed' }[s] ?? s;
}

async function updateAdminBadge() {
    if (auth.user?.role !== 'admin') return;
    try {
        const res   = await authedFetch(`${API_BASE}/api/admin/feedback/new-count`);
        const data  = await res.json();
        const count = data.count || 0;
        adminFeedbackNewCount = count;
        const badge = document.getElementById('admin-fb-badge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        const navBtn = document.getElementById('btn-admin');
        if (navBtn) navBtn.textContent = count > 0 ? `Admin (${count} new)` : 'Admin';
    } catch {}
}

async function refreshAdminFeedback() {
    const container = document.getElementById('admin-feedback');
    container.innerHTML = '<p class="hint">Loading…</p>';
    const showAll = document.getElementById('admin-fb-show-all')?.checked ? '?show_all=1' : '';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/feedback${showAll}`);
        const rows = await res.json();
        if (!rows.length) { container.innerHTML = '<p class="hint">No feedback yet.</p>'; return; }
        container.innerHTML = rows.map(fb => `
            <div class="queue-item fb-item" data-id="${esc(fb.id)}">
                <div class="fb-item-header">
                    <span class="fb-type-badge fb-type-${esc(fb.type)}">${esc(prettyFbType(fb.type))}</span>
                    <span class="fb-status-badge fb-status-${esc(fb.status)}">${esc(prettyFbStatus(fb.status))}</span>
                    <span class="queue-meta" style="margin-left:auto;font-size:11px">${new Date(fb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                <button class="fb-subject-toggle queue-name" data-id="${esc(fb.id)}" style="margin-top:4px;text-align:left;background:none;border:none;padding:0;cursor:pointer;font-size:inherit;font-weight:600;color:var(--ink);width:100%">
                    ${esc(fb.subject)}
                </button>
                <div class="fb-desc-body hidden" data-id="${esc(fb.id)}">
                    <div class="queue-desc" style="margin-top:4px">${esc(fb.description)}</div>
                </div>
                ${fb.submitter_name || fb.submitter_email
                    ? `<div class="queue-meta" style="margin-top:4px">From: ${esc(fb.submitter_name || '')}${fb.submitter_email ? ' &lt;' + esc(fb.submitter_email) + '&gt;' : ''}</div>`
                    : ''}
                <div class="fb-item-actions">
                    <div class="fb-action-btns">
                        ${fb.status !== 'in_progress' ? `<button class="fb-action-btn fb-action-inprogress" data-id="${esc(fb.id)}" data-status="in_progress">Mark In Progress</button>` : ''}
                        ${fb.status !== 'resolved'    ? `<button class="fb-action-btn fb-action-resolve"    data-id="${esc(fb.id)}" data-status="resolved">Mark Resolved</button>` : ''}
                        ${fb.status !== 'dismissed'   ? `<button class="fb-action-btn fb-action-dismiss"    data-id="${esc(fb.id)}" data-status="dismissed">Dismiss</button>` : ''}
                        <button class="fb-action-btn fb-action-delete" data-id="${esc(fb.id)}">Delete</button>
                    </div>
                    <textarea class="fb-notes-input" data-id="${esc(fb.id)}" placeholder="Admin notes (optional)">${esc(fb.admin_notes || '')}</textarea>
                    <button class="btn-approve fb-save-notes-btn" data-id="${esc(fb.id)}" style="margin-top:4px">Save Notes</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.fb-subject-toggle').forEach(btn =>
            btn.addEventListener('click', () => {
                const body = container.querySelector(`.fb-desc-body[data-id="${btn.dataset.id}"]`);
                body?.classList.toggle('hidden');
            })
        );

        container.querySelectorAll('.fb-action-inprogress, .fb-action-resolve, .fb-action-dismiss').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/feedback/${btn.dataset.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: btn.dataset.status }),
                });
                await Promise.all([refreshAdminFeedback(), updateAdminBadge()]);
            })
        );

        container.querySelectorAll('.fb-save-notes-btn').forEach(btn =>
            btn.addEventListener('click', async () => {
                const notes = container.querySelector(`.fb-notes-input[data-id="${btn.dataset.id}"]`).value.trim() || null;
                await authedFetch(`${API_BASE}/api/admin/feedback/${btn.dataset.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ admin_notes: notes }),
                });
                btn.textContent = 'Saved ✓';
                setTimeout(() => { btn.textContent = 'Save Notes'; }, 1500);
            })
        );

        container.querySelectorAll('.fb-action-delete').forEach(btn =>
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this feedback entry? This cannot be undone.')) return;
                await authedFetch(`${API_BASE}/api/admin/feedback/${btn.dataset.id}`, { method: 'DELETE' });
                await Promise.all([refreshAdminFeedback(), updateAdminBadge()]);
            })
        );
    } catch (err) {
        container.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

document.getElementById('admin-fb-show-all')?.addEventListener('change', refreshAdminFeedback);

// =============================================================================
// Admin headstone queue
// =============================================================================
async function refreshAdminHsQueue() {
    let container = document.getElementById('admin-hs-queue');
    if (!container) {
        // Inject the section into the admin modal box
        const box = document.querySelector('#admin-modal .modal-box');
        if (!box) return;
        const section = document.createElement('div');
        section.innerHTML = `
            <h3 style="margin-top:24px;margin-bottom:8px;font-size:16px">
                Headstone Queue
                <span id="admin-hs-badge" class="fb-count-badge" style="display:none"></span>
            </h3>
            <div id="admin-hs-queue"><p class="hint">Loading…</p></div>
        `;
        box.appendChild(section);
        container = document.getElementById('admin-hs-queue');
    }
    container.innerHTML = '<p class="hint">Loading…</p>';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/headstones/queue`);
        const rows = await res.json();
        const badge = document.getElementById('admin-hs-badge');
        if (badge) {
            badge.textContent    = rows.length;
            badge.style.display  = rows.length > 0 ? 'inline-block' : 'none';
        }
        if (!rows.length) { container.innerHTML = '<p class="hint">No pending headstones.</p>'; return; }
        container.innerHTML = rows.map(h => `
            <div class="hs-queue-item" data-id="${esc(h.id)}">
                <div class="queue-name">${esc(h.name)}</div>
                <div class="queue-meta">${esc(h.cemetery_name || '—')} · by ${esc(h.submitter_email || 'unknown')}</div>
                ${h.birth_year || h.death_year ? `<div class="queue-desc">${esc(formatHsDates(h))}</div>` : ''}
                ${h.inscription ? `<div class="queue-desc" style="font-style:italic">${esc(h.inscription)}</div>` : ''}
                <div class="queue-actions" style="margin-top:8px">
                    <button class="btn-approve hs-approve-btn" data-id="${esc(h.id)}">✓ Approve</button>
                    <button class="btn-reject  hs-reject-btn"  data-id="${esc(h.id)}">✕ Reject</button>
                </div>
            </div>
        `).join('');
        container.querySelectorAll('.hs-approve-btn').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/headstones/approve/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminHsQueue();
            })
        );
        container.querySelectorAll('.hs-reject-btn').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/headstones/reject/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminHsQueue();
            })
        );
    } catch (err) {
        container.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

// =============================================================================
// Admin headstone edit proposals
// =============================================================================
async function refreshAdminHsEditQueue() {
    let container = document.getElementById('admin-hs-edits');
    if (!container) {
        const box = document.querySelector('#admin-modal .modal-box');
        if (!box) return;
        const section = document.createElement('div');
        section.innerHTML = `
            <h3 style="margin-top:24px;margin-bottom:8px;font-size:16px">
                Edit Proposals
                <span id="admin-hse-badge" class="fb-count-badge" style="display:none"></span>
            </h3>
            <div id="admin-hs-edits"><p class="hint">Loading…</p></div>
        `;
        box.appendChild(section);
        container = document.getElementById('admin-hs-edits');
    }
    container.innerHTML = '<p class="hint">Loading…</p>';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/headstone-edits/queue`);
        const rows = await res.json();
        const badge = document.getElementById('admin-hse-badge');
        if (badge) {
            badge.textContent    = rows.length;
            badge.style.display  = rows.length > 0 ? 'inline-block' : 'none';
        }
        if (!rows.length) { container.innerHTML = '<p class="hint">No pending edit proposals.</p>'; return; }

        const fields = [
            ['name','Name'],
            ['birth_year','Birth year'],['birth_month','Birth month'],['birth_day','Birth day'],
            ['birth_place','Birth place'],
            ['death_year','Death year'],['death_month','Death month'],['death_day','Death day'],
            ['death_place','Death place'],
            ['inscription','Inscription'],['relationship','Relationship'],['condition','Condition'],
        ];

        container.innerHTML = rows.map(e => {
            const proposed = e.proposed_data || {};
            const diffRows = fields.map(([field, label]) => {
                const cur  = e[`current_${field}`];
                const prop = proposed[field];
                const changed = String(cur ?? '') !== String(prop ?? '');
                return `
                    <div class="hs-diff-current">${esc(label)}: <span>${esc(cur != null ? cur : '—')}</span></div>
                    <div class="hs-diff-proposed ${changed ? 'hs-diff-changed' : ''}">${esc(label)}: <span>${esc(prop != null ? prop : '—')}</span></div>
                `;
            }).join('');
            return `
                <div class="hs-queue-item" data-id="${esc(e.id)}">
                    <div class="queue-name">${esc(e.current_name)} <span style="font-size:11px;color:#888">→ ${esc(proposed.name || e.current_name)}</span></div>
                    <div class="queue-meta">${esc(e.cemetery_name || '—')} · proposed by ${esc(e.proposer_email || 'unknown')}</div>
                    <div class="hs-edit-diff">${diffRows}</div>
                    <div class="queue-actions" style="margin-top:8px">
                        <button class="btn-approve hse-approve-btn" data-id="${esc(e.id)}">✓ Approve</button>
                        <button class="btn-reject  hse-reject-btn"  data-id="${esc(e.id)}">✕ Reject</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.hse-approve-btn').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/headstone-edits/approve/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminHsEditQueue();
            })
        );
        container.querySelectorAll('.hse-reject-btn').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/headstone-edits/reject/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminHsEditQueue();
            })
        );
    } catch (err) {
        container.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

// =============================================================================
// Feedback modal
// =============================================================================
function openFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    modal.classList.remove('hidden');
    document.getElementById('fb-msg').textContent = '';
    document.getElementById('fb-msg').className   = 'form-status';
    document.getElementById('fb-subject').value   = '';
    document.getElementById('fb-desc').value      = '';
    document.getElementById('fb-name').value      = '';
    document.getElementById('fb-hp').value        = '';
    document.getElementById('fb-submit').disabled = false;
    document.getElementById('fb-submit').textContent = 'Send Feedback';
    const emailEl = document.getElementById('fb-email');
    if (auth.user?.email) {
        emailEl.value    = auth.user.email;
        emailEl.readOnly = true;
        emailEl.style.opacity = '0.7';
    } else {
        emailEl.value    = '';
        emailEl.readOnly = false;
        emailEl.style.opacity = '';
    }
    setTimeout(() => document.getElementById('fb-subject')?.focus(), 50);
}

function closeFeedbackModal() {
    document.getElementById('feedback-modal').classList.add('hidden');
}

document.getElementById('feedback-close').addEventListener('click', closeFeedbackModal);
document.getElementById('fb-cancel').addEventListener('click', closeFeedbackModal);

document.getElementById('fb-submit').addEventListener('click', async () => {
    const msg = document.getElementById('fb-msg');
    msg.className   = 'form-status';
    msg.textContent = '';
    const submitterEmail = document.getElementById('fb-email').value.trim();
    const payload = {
        type:            document.getElementById('fb-type').value,
        subject:         document.getElementById('fb-subject').value.trim(),
        description:     document.getElementById('fb-desc').value.trim(),
        submitter_name:  document.getElementById('fb-name').value.trim() || null,
        submitter_email: submitterEmail || null,
        hp:              document.getElementById('fb-hp').value,
    };
    if (!payload.subject || !payload.description) {
        msg.className   = 'form-status err';
        msg.textContent = 'Subject and description are required.';
        return;
    }
    const btn = document.getElementById('fb-submit');
    btn.disabled    = true;
    btn.textContent = 'Submitting…';
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
        const res  = await fetch(`${API_BASE}/api/feedback`, { method: 'POST', headers, body: JSON.stringify(payload) });
        const data = await res.json();
        if (res.ok) {
            msg.className   = 'form-status ok';
            msg.textContent = submitterEmail
                ? 'Thanks for the feedback! We\'ll review it shortly. We\'ll get back to you if needed.'
                : 'Thanks for the feedback! We\'ll review it shortly.';
            setTimeout(closeFeedbackModal, 3000);
        } else {
            msg.className    = 'form-status err';
            msg.textContent  = data.error || 'Submission failed.';
            btn.disabled     = false;
            btn.textContent  = 'Send Feedback';
        }
    } catch {
        msg.className    = 'form-status err';
        msg.textContent  = 'Network error. Please try again.';
        btn.disabled     = false;
        btn.textContent  = 'Send Feedback';
    }
});

document.getElementById('nav-feedback')?.addEventListener('click', (e) => {
    e.preventDefault();
    openFeedbackModal();
});

// =============================================================================
// Guidelines modal
// =============================================================================
function openGuidelinesModal() {
    document.getElementById('guidelines-modal').classList.remove('hidden');
}
function closeGuidelinesModal() {
    document.getElementById('guidelines-modal').classList.add('hidden');
}
document.getElementById('guidelines-close').addEventListener('click', closeGuidelinesModal);
document.getElementById('guidelines-done').addEventListener('click', closeGuidelinesModal);
document.getElementById('guidelines-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGuidelinesModal();
});
document.getElementById('nav-guidelines')?.addEventListener('click', (e) => {
    e.preventDefault();
    openGuidelinesModal();
});
document.getElementById('footer-guidelines')?.addEventListener('click', (e) => {
    e.preventDefault();
    openGuidelinesModal();
});
document.getElementById('footer-feedback')?.addEventListener('click', (e) => {
    e.preventDefault();
    openFeedbackModal();
});
document.getElementById('sf-guidelines-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    openGuidelinesModal();
});

// =============================================================================
// State
// =============================================================================
let cemeteryFeatures = [];

const ALL_CEMETERY_TYPES = [
    'family_private','church_community','african_american',
    'native_american','institutional','military_veterans',
    'religious','mass_burial','unknown_other',
];

const state = {
    cemeteryTypes:    new Set(ALL_CEMETERY_TYPES),
    rescueStatuses:   new Set(['maintained','neglected','overgrown','lost','reclaimed','disinterred']),
    pinMode:          false,
    pendingPinLngLat: null,
};

// =============================================================================
// Pin drop (Add Cemetery)
// =============================================================================
function enterPinMode() {
    state.pinMode = true;
    document.getElementById('btn-drop-pin').classList.add('active');
    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', onPinDrop);
}

function exitPinMode() {
    state.pinMode = false;
    document.getElementById('btn-drop-pin').classList.remove('active');
    map.getCanvas().style.cursor = '';
    map.off('click', onPinDrop);
}

function onPinDrop(e) {
    const { lng, lat } = e.lngLat;
    state.pendingPinLngLat = [lng, lat];
    exitPinMode();
    openSiteForm();
}

document.getElementById('btn-drop-pin').addEventListener('click', () => {
    if (state.pinMode) { exitPinMode(); return; }
    if (!auth.token) { openAuthModal('login'); return; }
    if (!auth.user?.verified) {
        showBanner('Verify your email to contribute — check your inbox, or click ⚠ Unverified to resend.', 'err');
        return;
    }
    enterPinMode();
});

// =============================================================================
// Cemetery submission form — photo upload
// =============================================================================
let sfPhotos = [];

function setDropZoneIdle() {
    document.getElementById('sf-photo-preview').innerHTML =
        `<span>📷 ${sfPhotos.length > 0 ? 'Add another image' : 'Drop images here, or click to browse'}</span>`;
    document.getElementById('sf-photo-drop').classList.remove('drag-over', 'has-photo');
    setOverlayActive(true);
}

function resetPhotoState() {
    sfPhotos = [];
    renderPhotoGrid();
    setDropZoneIdle();
    document.getElementById('sf-photo-progress').classList.add('hidden');
    document.getElementById('sf-photo-bar').style.width = '0';
    document.getElementById('sf-photo-url-row').classList.add('hidden');
    const urlInput = document.getElementById('sf-photo-url');
    if (urlInput) urlInput.value = '';
    document.getElementById('sf-photo-file').value = '';
}

function renderPhotoGrid() {
    const grid = document.getElementById('sf-photo-grid');
    if (!grid) return;
    if (sfPhotos.length === 0) { grid.innerHTML = ''; return; }
    grid.innerHTML = sfPhotos.map((p, i) => `
        <div class="photo-grid-item">
            <img src="${esc(p.thumb_url || p.url)}" alt="Photo ${i + 1}">
            <button type="button" class="photo-grid-remove" data-idx="${i}" title="Remove">×</button>
        </div>
    `).join('');
    grid.querySelectorAll('.photo-grid-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            sfPhotos.splice(parseInt(btn.dataset.idx), 1);
            renderPhotoGrid();
            setDropZoneIdle();
        });
    });
}

async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        document.getElementById('sf-photo-preview').innerHTML =
            `<span class="photo-err">✕ Not an image — please pick a jpg, png, or webp.</span>`;
        return;
    }
    if (sfPhotos.length >= 10) {
        document.getElementById('sf-photo-preview').innerHTML =
            `<span class="photo-err">Maximum 10 photos per cemetery.</span>`;
        return;
    }
    const preview  = document.getElementById('sf-photo-preview');
    const progress = document.getElementById('sf-photo-progress');
    const bar      = document.getElementById('sf-photo-bar');
    setOverlayActive(false);
    progress.classList.remove('hidden');
    bar.style.width = '15%';
    preview.innerHTML = `<span class="photo-uploading">⏳ Uploading…</span>`;
    try {
        const form = new FormData();
        form.append('photo', file);
        bar.style.width = '50%';
        const res  = await fetch(`${API_BASE}/api/upload/photo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth.token}` },
            body: form,
        });
        bar.style.width = '90%';
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        bar.style.width = '100%';
        sfPhotos.push({ url: data.url, thumb_url: data.thumb_url });
        renderPhotoGrid();
        setTimeout(() => {
            progress.classList.add('hidden');
            bar.style.width = '0';
            document.getElementById('sf-photo-file').value = '';
            setDropZoneIdle();
        }, 400);
    } catch (err) {
        progress.classList.add('hidden');
        bar.style.width = '0';
        preview.innerHTML = `<span class="photo-err">✕ ${esc(err.message)} — try again</span>`;
        setOverlayActive(true);
    }
}

const sfDropZone  = document.getElementById('sf-photo-drop');
const sfFileInput = document.getElementById('sf-photo-file');

function setOverlayActive(active) {
    sfFileInput.style.pointerEvents = active ? 'auto' : 'none';
    sfFileInput.style.zIndex = active ? '1' : '-1';
}

sfDropZone.addEventListener('dragenter', e => { e.preventDefault(); sfDropZone.classList.add('drag-over'); });
sfDropZone.addEventListener('dragover',  e => { e.preventDefault(); sfDropZone.classList.add('drag-over'); });
sfDropZone.addEventListener('dragleave', e => {
    if (!sfDropZone.contains(e.relatedTarget)) sfDropZone.classList.remove('drag-over');
});
sfDropZone.addEventListener('drop', async e => {
    e.preventDefault();
    sfDropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files.slice(0, 10 - sfPhotos.length)) {
        await handlePhotoFile(file);
    }
});
sfFileInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    for (const file of files.slice(0, 10 - sfPhotos.length)) {
        await handlePhotoFile(file);
    }
});
document.getElementById('sf-photo-url-toggle').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('sf-photo-url-row').classList.toggle('hidden');
});

document.getElementById('sf-status').addEventListener('change', (e) => {
    const hint = document.getElementById('sf-disinterred-hint');
    hint.style.display = e.target.value === 'disinterred' ? 'block' : 'none';
});

function openSiteForm() { document.getElementById('site-form').classList.remove('hidden'); }
function closeSiteForm() {
    document.getElementById('site-form').classList.add('hidden');
    document.getElementById('sf-status-msg').textContent = '';
    document.getElementById('sf-agree-guidelines').checked = false;
    document.getElementById('sf-disinterred-hint').style.display = 'none';
    resetPhotoState();
    state.pendingPinLngLat = null;
}

document.getElementById('sf-cancel').addEventListener('click', closeSiteForm);
document.getElementById('sf-submit').addEventListener('click', async () => {
    const msg = document.getElementById('sf-status-msg');
    if (!document.getElementById('sf-agree-guidelines').checked) {
        msg.textContent = '✕ Please read and agree to the Contribution Guidelines before submitting.';
        msg.className   = 'form-status err';
        return;
    }
    const [lng, lat] = state.pendingPinLngLat || [null, null];
    const body = {
        name:               document.getElementById('sf-name').value.trim(),
        cemetery_type:      document.getElementById('sf-type').value,
        rescue_status:      document.getElementById('sf-status').value,
        lng, lat,
        city:               document.getElementById('sf-city').value.trim() || null,
        state_province:     document.getElementById('sf-state').value.trim().toUpperCase() || null,
        established_year:   parseInt(document.getElementById('sf-built').value) || null,
        last_known_year:    parseInt(document.getElementById('sf-closed').value) || null,
        stone_count:        parseInt(document.getElementById('sf-stones').value) || null,
        description:        document.getElementById('sf-desc').value.trim() || null,
        names_inscriptions: document.getElementById('sf-names').value.trim() || null,
        photos:             sfPhotos.length > 0 ? sfPhotos : undefined,
        photo_url:          sfPhotos.length === 0 ? (document.getElementById('sf-photo-url')?.value.trim() || null) : null,
    };
    msg.textContent = '';
    msg.className   = 'form-status';
    const btn     = document.getElementById('sf-submit');
    const restore = btnLoading(btn, 'Submitting…');
    const cancel  = coldStartHint(msg);
    try {
        const res  = await authedFetch(`${API_BASE}/api/cemeteries`, {
            method: 'POST', body: JSON.stringify(body),
        });
        cancel();
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const live = data.mod_status === 'approved';
        msg.textContent = live
            ? '✓ Published! Your cemetery is now live on the map.'
            : '✓ Submitted for review! It will appear once approved.';
        msg.className   = 'form-status ok';
        if (live) { loadData(); }
        setTimeout(closeSiteForm, 2500);
    } catch (err) {
        cancel();
        restore();
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
});

// =============================================================================
// Data loading
// =============================================================================
async function loadData() {
    const statusEl = document.getElementById('map-load-status');
    const textEl   = document.getElementById('map-load-text');
    if (statusEl) statusEl.classList.remove('hidden');
    const t = setTimeout(() => {
        if (textEl) textEl.textContent = 'Server waking up — first request may take ~30 seconds…';
    }, 5000);
    try {
        const res = await fetch(`${API_BASE}/api/cemeteries`);
        clearTimeout(t);
        if (statusEl) statusEl.classList.add('hidden');
        const cemeteries = await res.json();
        cemeteryFeatures = cemeteries.features || [];
        addOrUpdateSource('cemeteries', cemeteries);
        applyFilters();
        maybeHideMapNotice(cemeteries.features?.length ?? 0);
    } catch (err) {
        clearTimeout(t);
        if (statusEl) statusEl.classList.add('hidden');
        console.warn('Backend unreachable:', err);
        useFallbackData();
    }
}

function addOrUpdateSource(id, geojson) {
    if (map.getSource(id)) map.getSource(id).setData(geojson);
    else map.addSource(id, { type: 'geojson', data: geojson });
}

// =============================================================================
// Location + cemetery search
// =============================================================================
let searchDebounce  = null;
let searchResults   = [];
let activeResultIdx = -1;
let searchMarker    = null;
let markerTimer     = null;
const geocodeCache  = new Map();

function parseCoords(q) {
    const m = q.trim().match(/^(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)$/);
    if (!m) return null;
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (!isFinite(a) || !isFinite(b)) return null;
    if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return { lat: a, lng: b };
    return null;
}

function searchLocalCemeteries(q) {
    const lower = q.toLowerCase();
    return cemeteryFeatures
        .filter(f => f.properties?.name?.toLowerCase().includes(lower))
        .slice(0, 3)
        .map(f => ({
            kind:  'cemetery',
            label: f.properties.name,
            sub:   [f.properties.city, f.properties.state].filter(Boolean).join(', ') || null,
            lat:   f.geometry?.coordinates[1],
            lng:   f.geometry?.coordinates[0],
            props: f.properties,
        }));
}

async function geocode(q) {
    if (geocodeCache.has(q)) return geocodeCache.get(q);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=us`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'GraveRescue/1.0 (https://graverescue.com)' },
    });
    if (!res.ok) throw new Error('Geocoder unavailable');
    const data = await res.json();
    const results = data.map(r => ({
        kind:  'location',
        label: r.display_name,
        lat:   parseFloat(r.lat),
        lng:   parseFloat(r.lon),
    }));
    geocodeCache.set(q, results);
    return results;
}

async function doSearch(q) {
    if (!q || q.length < 2) { hideSearchResults(); return; }

    const coords = parseCoords(q);
    if (coords) {
        searchResults = [{ kind: 'coords', label: q, lat: coords.lat, lng: coords.lng }];
        renderSearchResults(searchResults);
        return;
    }

    const cems    = searchLocalCemeteries(q);
    const spinner = document.getElementById('mapsearch-spinner');
    if (spinner) spinner.classList.remove('hidden');
    try {
        const locations = await geocode(q);
        searchResults = [...cems, ...locations];
    } catch {
        searchResults = cems;
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }
    renderSearchResults(searchResults);
}

function renderSearchResults(results) {
    const list = document.getElementById('mapsearch-results');
    activeResultIdx = -1;
    if (!results.length) { list.style.display = 'none'; return; }

    const items = [];
    let lastKind = null;
    for (const r of results) {
        if (r.kind !== lastKind) {
            const label = r.kind === 'cemetery' ? 'Cemeteries' : r.kind === 'coords' ? 'Coordinates' : 'Places';
            items.push(`<li class="sr-divider">${label}</li>`);
            lastKind = r.kind;
        }
        const icon = r.kind === 'cemetery' ? '🪦' : r.kind === 'coords' ? '🎯' : '📌';
        items.push(`
            <li role="option" tabindex="-1">
                <span class="sr-icon">${icon}</span>
                <span class="sr-text">
                    <span class="sr-label">${esc(r.label)}</span>
                    ${r.sub ? `<span class="sr-sub">${esc(r.sub)}</span>` : ''}
                </span>
            </li>
        `);
    }
    list.innerHTML = items.join('');
    list.style.display = 'block';

    let clickIdx = 0;
    list.querySelectorAll('li[role="option"]').forEach(li => {
        const i = clickIdx++;
        li.addEventListener('mousedown', e => { e.preventDefault(); selectResult(i); });
    });
}

function hideSearchResults() {
    document.getElementById('mapsearch-results').style.display = 'none';
    activeResultIdx = -1;
}

function clearSearchMarker() {
    if (searchMarker) { searchMarker.remove(); searchMarker = null; }
    if (markerTimer)  { clearTimeout(markerTimer); markerTimer = null; }
}

function selectResult(idx) {
    const r = searchResults[idx];
    if (!r) return;
    document.getElementById('mapsearch-input').value = r.label;
    document.getElementById('mapsearch-clear').style.display = 'block';
    hideSearchResults();

    if (r.lat == null || r.lng == null) return;
    map.flyTo({ center: [r.lng, r.lat], zoom: 13, speed: 1.6, essential: true });

    clearSearchMarker();
    searchMarker = new maplibregl.Marker({ color: '#6B4E3D' })
        .setLngLat([r.lng, r.lat])
        .addTo(map);
    markerTimer = setTimeout(clearSearchMarker, 5000);

    if (r.kind === 'cemetery' && r.props) showDetail(r.props);
}

function updateActiveItem() {
    const items = document.getElementById('mapsearch-results').querySelectorAll('li[role="option"]');
    items.forEach((li, i) => li.classList.toggle('sr-active', i === activeResultIdx));
    if (activeResultIdx >= 0) items[activeResultIdx]?.scrollIntoView({ block: 'nearest' });
}

document.getElementById('mapsearch-input').addEventListener('input', () => {
    const q = document.getElementById('mapsearch-input').value.trim();
    document.getElementById('mapsearch-clear').style.display = q ? 'block' : 'none';
    clearTimeout(searchDebounce);
    if (q.length < 2) { hideSearchResults(); return; }
    searchDebounce = setTimeout(() => doSearch(q), 300);
});

document.getElementById('mapsearch-input').addEventListener('keydown', e => {
    const list  = document.getElementById('mapsearch-results');
    const open  = list.style.display !== 'none';
    const items = list.querySelectorAll('li[role="option"]');
    const n     = items.length;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) { doSearch(document.getElementById('mapsearch-input').value.trim()); return; }
        activeResultIdx = (activeResultIdx + 1) % n;
        updateActiveItem();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeResultIdx = (activeResultIdx - 1 + n) % n;
        updateActiveItem();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && searchResults.length) {
            selectResult(activeResultIdx >= 0 ? activeResultIdx : 0);
        } else {
            clearTimeout(searchDebounce);
            doSearch(document.getElementById('mapsearch-input').value.trim());
        }
    } else if (e.key === 'Escape') {
        hideSearchResults();
        document.getElementById('mapsearch-input').blur();
    }
});

document.getElementById('mapsearch-clear').addEventListener('click', () => {
    document.getElementById('mapsearch-input').value = '';
    document.getElementById('mapsearch-clear').style.display = 'none';
    hideSearchResults();
    clearSearchMarker();
    document.getElementById('mapsearch-input').focus();
});

document.addEventListener('click', e => {
    if (!document.getElementById('map-search').contains(e.target)) hideSearchResults();
});

// =============================================================================
// Layers
// =============================================================================
function addLayers() {
    map.addSource('cemeteries', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
        id: 'cemeteries-layer', type: 'circle', source: 'cemeteries',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 14, 10],
            'circle-color': ['match', ['get', 'rescue_status'],
                'maintained',  '#1D9E75',
                'neglected',   '#BA7517',
                'overgrown',   '#854F0B',
                'lost',        '#A32D2D',
                'reclaimed',   '#0F6E56',
                'disinterred', '#6B5B73',
                '#666'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
            'circle-opacity': ['match', ['get', 'rescue_status'], 'lost', 0.75, 1.0],
        },
    });

    map.on('mouseenter', 'cemeteries-layer', () => { map.getCanvas().style.cursor = state.pinMode ? 'crosshair' : 'pointer'; });
    map.on('mouseleave', 'cemeteries-layer', () => { map.getCanvas().style.cursor = state.pinMode ? 'crosshair' : ''; });
}

// =============================================================================
// Filters
// =============================================================================
function applyFilters() {
    if (!map.getLayer('cemeteries-layer')) return;
    const typeArr   = Array.from(state.cemeteryTypes);
    const statusArr = Array.from(state.rescueStatuses);

    map.setFilter('cemeteries-layer', [
        'all',
        ['in', ['get', 'cemetery_type'], ['literal', typeArr]],
        ['in', ['get', 'rescue_status'], ['literal', statusArr]],
    ]);
}

// =============================================================================
// Detail panel
// =============================================================================
let currentDetail = null;
let currentProps  = null;
let editPhotos    = [];

async function showDetail(props) {
    const panel   = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');
    panel.classList.remove('hidden');
    content.innerHTML = '<p class="hint" style="margin-top:0">Loading…</p>';

    let detail     = null;
    let sitePhotos = [];
    try {
        const res = await fetch(`${API_BASE}/api/cemeteries/${props.id}`);
        if (res.ok) {
            detail     = await res.json();
            sitePhotos = detail.site_photos || [];
        }
    } catch (_) {}

    currentDetail = detail;
    currentProps  = props;

    const d            = detail || {};
    const name         = d.name           ?? props.name;
    const cemType      = d.cemetery_type  ?? props.cemetery_type;
    const rescueStatus = d.rescue_status  ?? props.rescue_status;
    const city         = d.city           != null ? d.city           : props.city;
    const stateVal     = d.state_province != null ? d.state_province : props.state;
    const estYear      = d.established_year != null ? d.established_year : props.established_year;
    const lastYear     = d.last_known_year  != null ? d.last_known_year  : props.last_known_year;
    const stoneCount   = d.stone_count    != null ? d.stone_count    : props.stone_count;
    const description  = d.description   != null ? d.description    : props.description;
    const namesInsc    = d.names_inscriptions;
    const submittedBy  = d.submitted_by   != null ? d.submitted_by   : props.submitted_by;
    const updatedAt    = d.updated_at;

    if (sitePhotos.length === 0 && props.photo_url) {
        sitePhotos = [{ url: props.photo_url, thumb_url: null }];
    }

    let photosHtml = '';
    if (sitePhotos.length === 1) {
        photosHtml = `<img src="${esc(sitePhotos[0].url)}" class="site-photo" alt="${esc(name)}">`;
    } else if (sitePhotos.length > 1) {
        photosHtml = `<div class="photo-gallery">${sitePhotos.map((p, i) =>
            `<img src="${esc(p.thumb_url || p.url)}" class="gallery-thumb" alt="${esc(name)} photo ${i + 1}">`
        ).join('')}</div>`;
    }

    const dates = [];
    if (estYear)    dates.push(`Est. ${estYear}`);
    if (lastYear)   dates.push(`Last known ${lastYear}`);
    if (stoneCount) dates.push(`~${stoneCount} stones`);

    const canAct = auth.user && (auth.user.role === 'admin' || auth.user.id === submittedBy);

    content.innerHTML = `
        ${photosHtml}
        <h3>${esc(name)}</h3>
        <div class="meta">${esc(prettyCemeteryType(cemType))}${city ? ' · ' + esc(city) + ', ' + esc(stateVal || '') : ''}</div>
        <div>
            <span class="tag tag-${rescueStatus}">${esc(prettyRescueStatus(rescueStatus))}</span>
        </div>
        <p>${esc(description || 'No description yet.')}</p>
        ${namesInsc ? `<div class="names-inscriptions"><strong>Names / inscriptions:</strong> ${esc(namesInsc)}</div>` : ''}
        ${dates.length ? `<div class="dates">${dates.join(' · ')}</div>` : ''}
        ${canAct ? `
            <button class="btn-edit-site"   id="btn-edit-site">Edit</button>
            <button class="btn-delete-site" data-id="${esc(props.id)}">Delete cemetery</button>
        ` : ''}
        ${updatedAt ? `<div class="last-edited">Last edited: ${formatDate(updatedAt)}</div>` : ''}
    `;

    const singlePhoto = content.querySelector('.site-photo');
    if (singlePhoto) singlePhoto.addEventListener('click', () => openLightbox(sitePhotos, 0));
    content.querySelectorAll('.gallery-thumb').forEach((img, i) => {
        img.addEventListener('click', () => openLightbox(sitePhotos, i));
    });

    document.getElementById('btn-edit-site')?.addEventListener('click', () => {
        renderEditForm(detail || { id: props.id, name, cemetery_type: cemType, rescue_status: rescueStatus, city, state_province: stateVal, established_year: estYear, last_known_year: lastYear, stone_count: stoneCount, description, names_inscriptions: namesInsc });
    });

    if (canAct) {
        content.querySelector('.btn-delete-site')?.addEventListener('click', async () => {
            if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
            const res = await authedFetch(`${API_BASE}/api/cemeteries/${props.id}`, { method: 'DELETE' });
            if (res.ok) {
                document.getElementById('detail-panel').classList.add('hidden');
                loadData();
            } else {
                const d2 = await res.json();
                alert('Delete failed: ' + d2.error);
            }
        });
    }

    // Load headstones section
    loadHeadstones(props.id);
}

// =============================================================================
// Edit mode
// =============================================================================
function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return ''; }
}

function renderEditForm(detail) {
    const content        = document.getElementById('detail-content');
    const coords         = detail.geometry?.coordinates || [];
    const lng            = coords[0] ?? '';
    const lat            = coords[1] ?? '';
    const existingPhotos = detail.site_photos || [];
    editPhotos           = [];

    const typeOpts = [
        ['family_private','Family / private plot'],
        ['church_community','Church or community cemetery'],
        ['african_american','African American cemetery'],
        ['native_american','Native American cemetery'],
        ['institutional','Institutional (prison, asylum, poor farm, potter\'s field)'],
        ['military_veterans','Military / veterans'],
        ['religious','Religious (Jewish, Quaker, Shaker, etc.)'],
        ['mass_burial','Mass burial (epidemic, disaster)'],
        ['unknown_other','Unknown / unmarked / other'],
    ];
    const statusOpts = [
        ['maintained','Maintained'],
        ['neglected','Neglected'],
        ['overgrown','Overgrown'],
        ['lost','Lost'],
        ['reclaimed','Reclaimed'],
        ['disinterred','Disinterred / relocated'],
    ];
    const mkOpts = (opts, cur) => opts.map(([v, l]) =>
        `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');

    content.innerHTML = `
        <div class="edit-form">
            <h3 style="margin:0 0 14px 0">Edit Cemetery</h3>
            <label>Name<input type="text" id="ef-name" value="${esc(detail.name || '')}"></label>
            <label>Type<select id="ef-type">${mkOpts(typeOpts, detail.cemetery_type)}</select></label>
            <label>Rescue Status<select id="ef-status">${mkOpts(statusOpts, detail.rescue_status)}</select></label>
            <label>City<input type="text" id="ef-city" value="${esc(detail.city || '')}"></label>
            <label>State<input type="text" id="ef-state" value="${esc(detail.state_province || '')}" maxlength="2"></label>
            <label>Latitude<input type="number" id="ef-lat" step="any" value="${lat}"></label>
            <label>Longitude<input type="number" id="ef-lng" step="any" value="${lng}"></label>
            <label>Year established<input type="number" id="ef-built" value="${detail.established_year || ''}"></label>
            <label>Last known year<input type="number" id="ef-closed" value="${detail.last_known_year || ''}"></label>
            <label>Stone count<input type="number" id="ef-stones" value="${detail.stone_count || ''}"></label>
            <label>Description<textarea id="ef-desc" rows="3">${esc(detail.description || '')}</textarea></label>
            <label>Names / inscriptions<textarea id="ef-names" rows="2">${esc(detail.names_inscriptions || '')}</textarea></label>
            ${existingPhotos.length > 0 ? `
            <p style="font-size:12px;font-weight:600;color:#555;margin:0 0 4px 0">Existing Photos</p>
            <div id="ef-existing-grid" class="photo-grid" style="margin-bottom:12px">
                ${existingPhotos.map(p => `
                    <div class="photo-grid-item" data-photo-id="${p.id}">
                        <img src="${esc(p.thumb_url || p.url)}" alt="Photo">
                        <button type="button" class="photo-grid-remove ef-del-photo" data-photo-id="${p.id}" title="Delete photo">×</button>
                    </div>
                `).join('')}
            </div>` : ''}
            <p style="font-size:12px;font-weight:600;color:#555;margin:0 0 4px 0">Add Photos</p>
            <div id="ef-photo-drop" class="photo-drop">
                <input type="file" id="ef-photo-file" accept="image/*" class="photo-file-overlay" multiple>
                <div id="ef-photo-preview" class="photo-preview-empty">
                    <span>📷 Drop images here, or click to browse</span>
                </div>
                <div id="ef-photo-progress" class="photo-progress hidden">
                    <div id="ef-photo-bar" class="photo-bar"></div>
                </div>
            </div>
            <div id="ef-photo-grid" class="photo-grid"></div>
            <div class="form-btns">
                <button class="btn-secondary" id="ef-cancel">Cancel</button>
                <button class="btn-primary"   id="ef-save">Save Changes</button>
            </div>
            <p id="ef-status-msg" class="form-status"></p>
        </div>
    `;

    wireEditPhotoUpload();

    document.querySelectorAll('.ef-del-photo').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this photo? This cannot be undone.')) return;
            const photoId = btn.dataset.photoId;
            const res = await authedFetch(
                `${API_BASE}/api/cemeteries/${detail.id}/photos/${photoId}`,
                { method: 'DELETE' }
            );
            if (res.ok) {
                btn.closest('.photo-grid-item').remove();
            } else {
                const d = await res.json().catch(() => ({}));
                alert('Delete failed: ' + (d.error || 'unknown error'));
            }
        });
    });

    document.getElementById('ef-cancel').addEventListener('click', () => showDetail(currentProps));
    document.getElementById('ef-save').addEventListener('click',   () => saveEdit(detail.id));
}

function wireEditPhotoUpload() {
    const dropZone  = document.getElementById('ef-photo-drop');
    const fileInput = document.getElementById('ef-photo-file');
    if (!dropZone || !fileInput) return;
    dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', e => {
        if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        for (const file of Array.from(e.dataTransfer.files).slice(0, 10 - editPhotos.length)) {
            await handleEditPhotoFile(file);
        }
    });
    fileInput.addEventListener('change', async e => {
        for (const file of Array.from(e.target.files).slice(0, 10 - editPhotos.length)) {
            await handleEditPhotoFile(file);
        }
    });
}

async function handleEditPhotoFile(file) {
    if (!file?.type.startsWith('image/')) return;
    const preview  = document.getElementById('ef-photo-preview');
    const progress = document.getElementById('ef-photo-progress');
    const bar      = document.getElementById('ef-photo-bar');
    if (!preview || !progress || !bar) return;
    progress.classList.remove('hidden');
    bar.style.width = '15%';
    preview.innerHTML = `<span class="photo-uploading">⏳ Uploading…</span>`;
    try {
        const form = new FormData();
        form.append('photo', file);
        bar.style.width = '50%';
        const res  = await fetch(`${API_BASE}/api/upload/photo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth.token}` },
            body: form,
        });
        bar.style.width = '90%';
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        bar.style.width = '100%';
        editPhotos.push({ url: data.url, thumb_url: data.thumb_url });
        renderEditPhotoGrid();
        setTimeout(() => {
            progress.classList.add('hidden');
            bar.style.width = '0';
            const fi   = document.getElementById('ef-photo-file');
            const prev = document.getElementById('ef-photo-preview');
            if (fi)   fi.value = '';
            if (prev) prev.innerHTML = `<span>📷 ${editPhotos.length > 0 ? 'Add another image' : 'Drop images here, or click to browse'}</span>`;
        }, 400);
    } catch (err) {
        progress.classList.add('hidden');
        bar.style.width = '0';
        preview.innerHTML = `<span class="photo-err">✕ ${esc(err.message)}</span>`;
    }
}

function renderEditPhotoGrid() {
    const grid = document.getElementById('ef-photo-grid');
    if (!grid) return;
    if (editPhotos.length === 0) { grid.innerHTML = ''; return; }
    grid.innerHTML = editPhotos.map((p, i) => `
        <div class="photo-grid-item">
            <img src="${esc(p.thumb_url || p.url)}" alt="New photo ${i + 1}">
            <button type="button" class="photo-grid-remove" data-idx="${i}" title="Remove">×</button>
        </div>
    `).join('');
    grid.querySelectorAll('.photo-grid-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            editPhotos.splice(parseInt(btn.dataset.idx), 1);
            renderEditPhotoGrid();
        });
    });
}

async function saveEdit(cemId) {
    const msg      = document.getElementById('ef-status-msg');
    const name     = document.getElementById('ef-name').value.trim();
    const cemType  = document.getElementById('ef-type').value;
    const status   = document.getElementById('ef-status').value;
    const latVal   = parseFloat(document.getElementById('ef-lat').value);
    const lngVal   = parseFloat(document.getElementById('ef-lng').value);

    if (!name || !cemType || !status) {
        msg.textContent = '✕ Name, type, and status are required.';
        msg.className   = 'form-status err';
        return;
    }
    msg.textContent = '';
    msg.className   = 'form-status';
    const saveBtn = document.getElementById('ef-save');
    const restore = saveBtn ? btnLoading(saveBtn, 'Saving…') : () => {};

    try {
        const res = await authedFetch(`${API_BASE}/api/cemeteries/${cemId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                name,
                cemetery_type:      cemType,
                rescue_status:      status,
                lat:                Number.isFinite(latVal) ? latVal : null,
                lng:                Number.isFinite(lngVal) ? lngVal : null,
                city:               document.getElementById('ef-city').value.trim()  || null,
                state_province:     document.getElementById('ef-state').value.trim().toUpperCase() || null,
                established_year:   parseInt(document.getElementById('ef-built').value)  || null,
                last_known_year:    parseInt(document.getElementById('ef-closed').value) || null,
                stone_count:        parseInt(document.getElementById('ef-stones').value) || null,
                description:        document.getElementById('ef-desc').value.trim()  || null,
                names_inscriptions: document.getElementById('ef-names').value.trim() || null,
                photos:             editPhotos.length > 0 ? editPhotos : undefined,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = '✓ Saved!';
        msg.className   = 'form-status ok';
        await loadData();
        setTimeout(() => showDetail(currentProps), 800);
    } catch (err) {
        restore();
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
}

document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

// =============================================================================
// Lightbox
// =============================================================================
let lbPhotos = [];
let lbIndex  = 0;

function openLightbox(photos, index) {
    lbPhotos = photos;
    lbIndex  = index;
    updateLightbox();
    document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
}

function updateLightbox() {
    document.getElementById('lb-img').src = lbPhotos[lbIndex].url;
    document.getElementById('lb-prev').classList.toggle('hidden', lbIndex === 0);
    document.getElementById('lb-next').classList.toggle('hidden', lbIndex === lbPhotos.length - 1);
    const counter = document.getElementById('lb-counter');
    if (lbPhotos.length > 1) {
        counter.textContent = `${lbIndex + 1} / ${lbPhotos.length}`;
        counter.classList.remove('hidden');
    } else {
        counter.classList.add('hidden');
    }
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLightbox();
});
document.getElementById('lb-prev').addEventListener('click', e => {
    e.stopPropagation();
    if (lbIndex > 0) { lbIndex--; updateLightbox(); }
});
document.getElementById('lb-next').addEventListener('click', e => {
    e.stopPropagation();
    if (lbIndex < lbPhotos.length - 1) { lbIndex++; updateLightbox(); }
});
document.addEventListener('keydown', e => {
    if (document.getElementById('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft'  && lbIndex > 0)                      { lbIndex--; updateLightbox(); }
    if (e.key === 'ArrowRight' && lbIndex < lbPhotos.length - 1)    { lbIndex++; updateLightbox(); }
});

// =============================================================================
// Headstones — helpers
// =============================================================================
function formatHsDates(hs) {
    const b = hs.birth_year ? formatYear(hs.birth_year, hs.birth_month, hs.birth_day) : '';
    const d = hs.death_year ? formatYear(hs.death_year, hs.death_month, hs.death_day) : '';
    if (b && d) return `${b} – ${d}`;
    if (b) return `b. ${b}`;
    if (d) return `d. ${d}`;
    return '';
}

function formatYear(y, m, d) {
    if (!y) return '';
    if (m && d) return `${m}/${d}/${y}`;
    if (m) return `${monthName(m)} ${y}`;
    return String(y);
}

function monthName(m) {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1] || '';
}

function prettyCondition(c) {
    return ({ legible:'Legible', partially_legible:'Partially legible', illegible:'Illegible', broken:'Broken', missing:'Missing' })[c] || c;
}

// =============================================================================
// Headstones — load & render list
// =============================================================================
async function loadHeadstones(cemId) {
    try {
        const res  = await fetch(`${API_BASE}/api/cemeteries/${cemId}/headstones`);
        if (!res.ok) return;
        const headstones = await res.json();
        renderHeadstonesSection(cemId, headstones);
    } catch (_) {}
}

function renderHeadstonesSection(cemId, headstones) {
    const content = document.getElementById('detail-content');
    if (!content) return;

    // Remove any existing headstones section before re-rendering
    const existing = document.getElementById('headstones-section');
    if (existing) existing.remove();

    const canAdd = auth.user && auth.user.verified;
    const addBtnHtml = canAdd
        ? `<button class="btn-add-headstone" id="btn-add-headstone">+ Add Headstone</button>`
        : '';

    let listHtml = '';
    if (!headstones.length) {
        listHtml = '<p class="hs-empty">No headstones recorded yet.</p>';
    } else {
        listHtml = headstones.map(hs => `
            <div class="hs-row" data-id="${esc(hs.id)}">
                ${hs.thumb_url
                    ? `<img class="hs-thumb" src="${esc(hs.thumb_url)}" alt="">`
                    : '<div class="hs-thumb-placeholder">🪦</div>'}
                <div class="hs-info">
                    <div class="hs-name">${esc(hs.name)}</div>
                    <div class="hs-dates">${esc(formatHsDates(hs))}</div>
                    ${hs.condition ? `<span class="hs-condition hs-cond-${esc(hs.condition)}">${esc(prettyCondition(hs.condition))}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    const section = document.createElement('div');
    section.id = 'headstones-section';
    section.innerHTML = `
        <div class="hs-section-header">
            <h4 class="hs-section-title">Headstones (<span id="hs-count">${headstones.length}</span>)</h4>
            ${addBtnHtml}
        </div>
        <div id="hs-list">${listHtml}</div>
    `;
    content.appendChild(section);

    document.getElementById('btn-add-headstone')?.addEventListener('click', () => openHeadstoneForm(cemId));

    section.querySelectorAll('.hs-row').forEach(row => {
        const hsId = row.dataset.id;
        const hs   = headstones.find(h => h.id === hsId);
        if (hs) row.addEventListener('click', () => openHeadstoneDetail(hs, cemId));
    });
}

// =============================================================================
// Headstones — detail view (swaps into #detail-content)
// =============================================================================
function openHeadstoneDetail(hs, cemId) {
    const content = document.getElementById('detail-content');
    if (!content) return;

    const canAct = auth.user && (auth.user.role === 'admin' || auth.user.id === hs.submitted_by);
    const canEdit = auth.user && auth.user.verified;
    const datesStr = formatHsDates(hs);

    content.innerHTML = `
        <button class="hs-detail-back" id="hs-back-btn">← Back to cemetery</button>
        ${hs.photo_url ? `<img class="hs-detail-photo" src="${esc(hs.photo_url)}" alt="${esc(hs.name)}">` : ''}
        <h3 class="hs-detail-name">${esc(hs.name)}</h3>
        ${datesStr ? `<div class="hs-detail-dates">${esc(datesStr)}</div>` : ''}
        ${hs.condition ? `<div class="hs-field"><strong>Condition</strong>${esc(prettyCondition(hs.condition))}</div>` : ''}
        ${hs.relationship ? `<div class="hs-field"><strong>Relationship</strong>${esc(hs.relationship)}</div>` : ''}
        ${hs.birth_place ? `<div class="hs-field"><strong>Birth place</strong>${esc(hs.birth_place)}</div>` : ''}
        ${hs.death_place ? `<div class="hs-field"><strong>Death place</strong>${esc(hs.death_place)}</div>` : ''}
        ${hs.inscription ? `<div class="hs-field"><strong>Inscription</strong>${esc(hs.inscription)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            ${canAct ? `<button class="btn-delete-site" id="hs-delete-btn" data-id="${esc(hs.id)}">Delete headstone</button>` : ''}
            ${canEdit && !canAct ? `<button class="btn-edit-site" id="hs-propose-btn">Propose edit</button>` : ''}
            ${canAct ? `<button class="btn-edit-site" id="hs-propose-btn">Propose edit</button>` : ''}
        </div>
        ${hs.updated_at ? `<div class="hs-last-updated">Last updated: ${formatDate(hs.updated_at)}</div>` : ''}
    `;

    document.getElementById('hs-back-btn')?.addEventListener('click', () => showDetail(currentProps));

    document.getElementById('hs-propose-btn')?.addEventListener('click', () => openProposeEditForm(hs, cemId));

    document.getElementById('hs-delete-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${hs.name}"? This cannot be undone.`)) return;
        const res = await authedFetch(`${API_BASE}/api/headstones/${hs.id}`, { method: 'DELETE' });
        if (res.ok) {
            showDetail(currentProps);
        } else {
            const d = await res.json().catch(() => ({}));
            alert('Delete failed: ' + (d.error || 'unknown error'));
        }
    });
}

// =============================================================================
// Headstones — propose-edit form (swaps into #detail-content)
// =============================================================================
function openProposeEditForm(hs, cemId) {
    const content = document.getElementById('detail-content');
    if (!content) return;

    content.innerHTML = `
        <button class="hs-detail-back" id="pe-back-btn">← Back to headstone</button>
        <h3 style="margin:0 0 14px 0">Propose Edit</h3>
        <p class="hint" style="margin:-8px 0 14px 0">Your changes will be reviewed before going live.</p>
        <div class="edit-form">
            <label>Name<input type="text" id="pe-name" value="${esc(hs.name)}"></label>
            <div style="display:flex;gap:8px">
                <label style="flex:1">Birth year<input type="number" id="pe-birth-year" value="${hs.birth_year || ''}"></label>
                <label style="flex:1">Month<input type="number" id="pe-birth-month" value="${hs.birth_month || ''}" min="1" max="12"></label>
                <label style="flex:1">Day<input type="number" id="pe-birth-day" value="${hs.birth_day || ''}" min="1" max="31"></label>
            </div>
            <label>Birth place<input type="text" id="pe-birth-place" value="${esc(hs.birth_place || '')}"></label>
            <div style="display:flex;gap:8px">
                <label style="flex:1">Death year<input type="number" id="pe-death-year" value="${hs.death_year || ''}"></label>
                <label style="flex:1">Month<input type="number" id="pe-death-month" value="${hs.death_month || ''}" min="1" max="12"></label>
                <label style="flex:1">Day<input type="number" id="pe-death-day" value="${hs.death_day || ''}" min="1" max="31"></label>
            </div>
            <label>Death place<input type="text" id="pe-death-place" value="${esc(hs.death_place || '')}"></label>
            <label>Inscription / epitaph<textarea id="pe-inscription" rows="2">${esc(hs.inscription || '')}</textarea></label>
            <label>Relationship<input type="text" id="pe-relationship" value="${esc(hs.relationship || '')}"></label>
            <label>Condition
                <select id="pe-condition">
                    <option value="">— unknown —</option>
                    <option value="legible"${hs.condition === 'legible' ? ' selected' : ''}>Legible</option>
                    <option value="partially_legible"${hs.condition === 'partially_legible' ? ' selected' : ''}>Partially legible</option>
                    <option value="illegible"${hs.condition === 'illegible' ? ' selected' : ''}>Illegible</option>
                    <option value="broken"${hs.condition === 'broken' ? ' selected' : ''}>Broken</option>
                    <option value="missing"${hs.condition === 'missing' ? ' selected' : ''}>Missing / gone</option>
                </select>
            </label>
            <div class="form-btns">
                <button class="btn-secondary" id="pe-cancel">Cancel</button>
                <button class="btn-primary" id="pe-submit">Submit Proposal</button>
            </div>
            <p id="pe-status-msg" class="form-status"></p>
        </div>
    `;

    document.getElementById('pe-back-btn')?.addEventListener('click', () => openHeadstoneDetail(hs, cemId));
    document.getElementById('pe-cancel')?.addEventListener('click', () => openHeadstoneDetail(hs, cemId));
    document.getElementById('pe-submit')?.addEventListener('click', () => submitProposeEdit(hs.id, hs, cemId));
}

// =============================================================================
// Headstones — form open/close
// =============================================================================
let _currentHsCemId = null;

function openHeadstoneForm(cemId) {
    _currentHsCemId = cemId;
    const modal = document.getElementById('headstone-form');
    if (!modal) return;
    // Reset fields
    ['hs-name','hs-birth-year','hs-birth-month','hs-birth-day','hs-birth-place',
     'hs-death-year','hs-death-month','hs-death-day','hs-death-place',
     'hs-inscription','hs-relationship'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const condEl = document.getElementById('hs-condition');
    if (condEl) condEl.value = '';
    const msgEl = document.getElementById('hs-status-msg');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'form-status'; }
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('hs-name')?.focus(), 50);
}

function closeHeadstoneForm() {
    document.getElementById('headstone-form')?.classList.add('hidden');
    _currentHsCemId = null;
}

// =============================================================================
// Headstones — submit new headstone
// =============================================================================
async function submitHeadstone(cemId) {
    const msg  = document.getElementById('hs-status-msg');
    const name = document.getElementById('hs-name')?.value.trim();
    if (!name) {
        msg.textContent = '✕ Name is required.';
        msg.className   = 'form-status err';
        return;
    }
    msg.textContent = '';
    msg.className   = 'form-status';
    const btn     = document.getElementById('hs-submit');
    const restore = btnLoading(btn, 'Submitting…');
    const cancel  = coldStartHint(msg);
    const body = {
        name,
        birth_year:    parseInt(document.getElementById('hs-birth-year')?.value)  || null,
        birth_month:   parseInt(document.getElementById('hs-birth-month')?.value) || null,
        birth_day:     parseInt(document.getElementById('hs-birth-day')?.value)   || null,
        birth_place:   document.getElementById('hs-birth-place')?.value.trim()    || null,
        death_year:    parseInt(document.getElementById('hs-death-year')?.value)  || null,
        death_month:   parseInt(document.getElementById('hs-death-month')?.value) || null,
        death_day:     parseInt(document.getElementById('hs-death-day')?.value)   || null,
        death_place:   document.getElementById('hs-death-place')?.value.trim()    || null,
        inscription:   document.getElementById('hs-inscription')?.value.trim()   || null,
        relationship:  document.getElementById('hs-relationship')?.value.trim()  || null,
        condition:     document.getElementById('hs-condition')?.value             || null,
    };
    try {
        const res  = await authedFetch(`${API_BASE}/api/cemeteries/${cemId}/headstones`, {
            method: 'POST', body: JSON.stringify(body),
        });
        cancel();
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const live = data.mod_status === 'approved';
        msg.textContent = live
            ? '✓ Headstone added!'
            : '✓ Submitted for review! It will appear once approved.';
        msg.className = 'form-status ok';
        setTimeout(() => {
            closeHeadstoneForm();
            if (currentProps) showDetail(currentProps);
        }, 1800);
    } catch (err) {
        cancel();
        restore();
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
}

// =============================================================================
// Headstones — submit propose-edit
// =============================================================================
async function submitProposeEdit(hsId, hs, cemId) {
    const msg  = document.getElementById('pe-status-msg');
    const name = document.getElementById('pe-name')?.value.trim();
    if (!name) {
        msg.textContent = '✕ Name is required.';
        msg.className   = 'form-status err';
        return;
    }
    msg.textContent = '';
    msg.className   = 'form-status';
    const btn     = document.getElementById('pe-submit');
    const restore = btnLoading(btn, 'Submitting…');
    const body = {
        name,
        birth_year:    parseInt(document.getElementById('pe-birth-year')?.value)  || null,
        birth_month:   parseInt(document.getElementById('pe-birth-month')?.value) || null,
        birth_day:     parseInt(document.getElementById('pe-birth-day')?.value)   || null,
        birth_place:   document.getElementById('pe-birth-place')?.value.trim()    || null,
        death_year:    parseInt(document.getElementById('pe-death-year')?.value)  || null,
        death_month:   parseInt(document.getElementById('pe-death-month')?.value) || null,
        death_day:     parseInt(document.getElementById('pe-death-day')?.value)   || null,
        death_place:   document.getElementById('pe-death-place')?.value.trim()    || null,
        inscription:   document.getElementById('pe-inscription')?.value.trim()   || null,
        relationship:  document.getElementById('pe-relationship')?.value.trim()  || null,
        condition:     document.getElementById('pe-condition')?.value             || null,
    };
    try {
        const res  = await authedFetch(`${API_BASE}/api/headstones/${hsId}/propose-edit`, {
            method: 'POST', body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = '✓ Edit proposal submitted for review!';
        msg.className   = 'form-status ok';
        setTimeout(() => openHeadstoneDetail(hs, cemId), 2000);
    } catch (err) {
        restore();
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
}

// =============================================================================
// Helpers
// =============================================================================
function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]); }

function prettyCemeteryType(t) {
    return ({
        family_private:    'Family / private plot',
        church_community:  'Church or community cemetery',
        african_american:  'African American cemetery',
        native_american:   'Native American cemetery',
        institutional:     'Institutional',
        military_veterans: 'Military / veterans',
        religious:         'Religious',
        mass_burial:       'Mass burial',
        unknown_other:     'Unknown / other',
    })[t] || t;
}

function prettyRescueStatus(s) {
    return ({
        maintained:  'Maintained',
        neglected:   'Neglected',
        overgrown:   'Overgrown',
        lost:        'Lost',
        reclaimed:   'Reclaimed',
        disinterred: 'Disinterred / relocated',
    })[s] || s;
}

function btnLoading(btn, loadText) {
    const orig      = btn.textContent;
    btn.disabled    = true;
    btn.textContent = loadText;
    return () => { btn.disabled = false; btn.textContent = orig; };
}

function coldStartHint(msgEl, delayMs = 5000) {
    const t = setTimeout(() => {
        if (msgEl && !msgEl.textContent.trim()) {
            msgEl.textContent = 'Server is waking up — first request may take up to 30 seconds…';
            msgEl.className   = 'form-status';
        }
    }, delayMs);
    return () => clearTimeout(t);
}

// =============================================================================
// Headstone form wiring
// =============================================================================
document.getElementById('hs-cancel-btn')?.addEventListener('click', closeHeadstoneForm);
document.getElementById('hs-cancel')?.addEventListener('click', closeHeadstoneForm);
document.getElementById('hs-submit')?.addEventListener('click', () => {
    if (_currentHsCemId) submitHeadstone(_currentHsCemId);
});
document.getElementById('headstone-form')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHeadstoneForm();
});

// =============================================================================
// UI wiring — filter checkboxes
// =============================================================================
document.querySelectorAll('input[data-filter]').forEach(input => {
    input.addEventListener('change', () => {
        const bucket = input.dataset.filter;
        const target = bucket === 'cemetery-type' ? state.cemeteryTypes : state.rescueStatuses;
        input.checked ? target.add(input.value) : target.delete(input.value);
        applyFilters();
    });
});

// =============================================================================
// Fallback data (if backend unreachable)
// =============================================================================
function useFallbackData() {
    const cemeteries = {
        type: 'FeatureCollection',
        features: [
            makeCemetery('Smith Family Cemetery', 'family_farm', 'overgrown', -84.33, 38.68, 1852, 1940, 'Small family plot on hilltop, 8–10 fieldstone markers.'),
            makeCemetery('African Baptist Church Yard', 'african_american', 'neglected', -84.50, 38.20, 1870, 1960, "Freedmen's church cemetery, many markers illegible."),
        ],
    };
    cemeteryFeatures = cemeteries.features;
    addOrUpdateSource('cemeteries', cemeteries);
    applyFilters();
}

function makeCemetery(name, cemetery_type, rescue_status, lng, lat, est, last, desc) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
             properties: { name, cemetery_type, rescue_status, established_year: est, last_known_year: last, description: desc } };
}

// =============================================================================
// Map notice
// =============================================================================
(function initMapNotice() {
    if (!localStorage.getItem('gr_notice_dismissed')) {
        document.getElementById('map-notice')?.classList.remove('hidden');
    }
})();

document.getElementById('map-notice-close')?.addEventListener('click', () => {
    document.getElementById('map-notice').classList.add('hidden');
    localStorage.setItem('gr_notice_dismissed', '1');
});

function maybeHideMapNotice(featureCount) {
    if (featureCount >= 50) document.getElementById('map-notice')?.classList.add('hidden');
}

// =============================================================================
// Boot
// =============================================================================
map.on('load', () => {
    addLayers();
    loadData();

    map.on('click', e => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['cemeteries-layer'] });
        if (features.length > 0) showDetail(features[0].properties);
    });
});

renderNav();
updateAdminBadge();
handleVerifyEmail();
handleResetPassword();
