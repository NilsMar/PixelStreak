#!/usr/bin/env node
/**
 * PixelStreak → TRMNL Webhook Sender
 *
 * Fetches your goals from Supabase and pushes a summary to your TRMNL
 * private-plugin webhook so the e-ink display stays current.
 *
 * Required env vars:
 *   SUPABASE_URL        Your Supabase project URL  (see config.js)
 *   SUPABASE_KEY        Your Supabase anon key     (see config.js)
 *   SUPABASE_EMAIL      Your PixelStreak account email
 *   SUPABASE_PASSWORD   Your PixelStreak account password
 *   TRMNL_WEBHOOK_URL   Webhook URL from the TRMNL plugin settings page
 *
 * Run once:
 *   node trmnl/send.js
 *
 * Schedule via cron, GitHub Actions, or any task runner to push updates
 * automatically. TRMNL standard accounts allow up to 12 pushes/hour.
 */

// ── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_KEY;
const SUPABASE_EMAIL    = process.env.SUPABASE_EMAIL;
const SUPABASE_PASSWORD = process.env.SUPABASE_PASSWORD;
const TRMNL_WEBHOOK_URL = process.env.TRMNL_WEBHOOK_URL;

// Number of weeks of history shown in the pixel grid (columns = weeks, rows = days)
const WEEKS_TO_SHOW = 8;

// ── Helpers ─────────────────────────────────────────────────────────────────

function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calculateStreak(days, today) {
    let streak = 0;
    const cur = new Date(today);
    while (days[dateKey(cur)] === 'completed') {
        streak++;
        cur.setDate(cur.getDate() - 1);
    }
    return streak;
}

/**
 * Builds the pixel grid as 7 rows (Sun–Sat), each with WEEKS_TO_SHOW chars.
 * Matches the column-per-week orientation of the web app.
 *
 * Glyphs:
 *   █  completed
 *   ░  missed
 *   ·  not tracked / future
 *   ◆  today
 */
function buildGrid(days, today) {
    // Sunday of the oldest week we want to show
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - (WEEKS_TO_SHOW - 1) * 7);

    const rows = []; // 7 rows (one per day of week), WEEKS_TO_SHOW chars each
    for (let d = 0; d < 7; d++) {
        let row = '';
        for (let w = 0; w < WEEKS_TO_SHOW; w++) {
            const date = new Date(start);
            date.setDate(date.getDate() + w * 7 + d);
            const key = dateKey(date);
            const isToday = date.getTime() === today.getTime();
            const isFuture = date > today;
            const status = days[key];

            if (isToday)              row += '◆';
            else if (isFuture)        row += '·';
            else if (!status)         row += '·';
            else if (status === 'completed') row += '█';
            else                      row += '░';
        }
        rows.push(row);
    }
    return rows; // ['········', '·██·████', …]  (7 strings)
}

function processGoal(goal, today) {
    const days = goal.days || {};
    const completed = Object.values(days).filter(v => v === 'completed').length;
    const missed    = Object.values(days).filter(v => v === 'missed').length;
    const total     = completed + missed;
    const rate      = total > 0 ? `${Math.round(completed / total * 100)}%` : '—';
    const streak    = calculateStreak(days, today);
    const grid      = buildGrid(days, today);
    return { name: goal.name, streak, completed, total, rate, grid };
}

// ── Supabase ────────────────────────────────────────────────────────────────

async function signIn() {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
        body: JSON.stringify({ email: SUPABASE_EMAIL, password: SUPABASE_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Supabase auth failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function fetchGoals(accessToken, userId) {
    const url = `${SUPABASE_URL}/rest/v1/goals?select=*&user_id=eq.${userId}&order=created_at.asc`;
    const res = await fetch(url, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch goals: ${res.status} ${await res.text()}`);
    return res.json();
}

// ── TRMNL ───────────────────────────────────────────────────────────────────

async function sendToTrmnl(payload) {
    const res = await fetch(TRMNL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_variables: payload }),
    });
    if (!res.ok) throw new Error(`TRMNL webhook failed: ${res.status} ${await res.text()}`);
    return res.json();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const missing = ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD', 'TRMNL_WEBHOOK_URL']
        .filter(k => !process.env[k]);
    if (missing.length) {
        console.error(`Missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('Signing in to Supabase…');
    const { access_token, user } = await signIn();

    console.log('Fetching goals…');
    const goals = await fetchGoals(access_token, user.id);
    console.log(`Found ${goals.length} goal(s).`);

    const processedGoals = goals.map(g => processGoal(g, today));

    const updated = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    console.log('Sending to TRMNL…');
    await sendToTrmnl({ goals: processedGoals, updated });
    console.log('Done — TRMNL display will refresh shortly.');
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
