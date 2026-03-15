#!/usr/bin/env node
/**
 * PixelStreak Terminal — displays your habit pixel grids right in the terminal.
 *
 * Usage:
 *   node terminal/pixel-streak.js [year]
 *
 * Credentials (in order of priority):
 *   1. Env vars  : PIXELSTREAK_EMAIL  &  PIXELSTREAK_PASSWORD
 *   2. Saved token: ~/.pixelstreak-auth.json  (auto-saved after first login)
 *   3. Interactive prompt
 */

import readline from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SUPABASE_URL = 'https://jqdxnveoflukktqemxzf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ALTt9CJDYfTUIB3uNEpx1g_kNHHVq9a';
const AUTH_FILE   = join(homedir(), '.pixelstreak-auth.json');

// ─── Glyph constants (distinct shapes, no colour needed) ─────────────────────
//
//   █  FULL BLOCK     — completed  (maximum ink, clearly done)
//   ▒  MEDIUM SHADE   — missed     (hatching, visually lighter than full)
//   ·  MIDDLE DOT     — not tracked (minimal mark)
//   ◉  FISHEYE        — today      (circle with dot, stands out)

const GLYPH_COMPLETED = '█';
const GLYPH_MISSED    = '▒';
const GLYPH_EMPTY     = '·';
const GLYPH_TODAY     = '◉';

// Plain text helpers — no ANSI escape codes
const bold = (text) => text;   // headings already stand out via === framing
const dim  = (text) => text;

// ─── Supabase API ─────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method  : 'POST',
    headers : { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body    : JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.message || 'Login failed');
  return data;
}

async function refreshToken(refresh_token) {
  const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method  : 'POST',
    headers : { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body    : JSON.stringify({ refresh_token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.message || 'Token refresh failed');
  return data;
}

async function fetchGoals(accessToken) {
  const res  = await fetch(`${SUPABASE_URL}/rest/v1/goals?select=*&order=created_at`, {
    headers : {
      apikey        : SUPABASE_KEY,
      Authorization : `Bearer ${accessToken}`,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to fetch goals');
  return data;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateKey(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Returns an array of weeks (each a 7-element array of Dates, Mon→Sun)
 * that covers the full calendar year `year`.
 */
function buildYearGrid(year) {
  const jan1    = new Date(year, 0, 1);
  const dow     = jan1.getDay();                 // 0=Sun … 6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1;     // steps back to Monday
  const cursor  = new Date(jan1);
  cursor.setDate(jan1.getDate() - daysBack);

  const weeks = [];
  const dec31 = new Date(year, 11, 31);
  while (cursor <= dec31) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function calculateStreak(goal) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
  let streak = 0;
  while (goal.days?.[dateKey(cursor)] === 'completed') {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function calculateStats(goal) {
  const vals      = Object.values(goal.days || {});
  const completed = vals.filter(v => v === 'completed').length;
  const missed    = vals.filter(v => v === 'missed').length;
  const streak    = calculateStreak(goal);
  return { completed, missed, streak };
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const CELL_W      = 2;   // chars per cell: glyph + space
const LABEL_W     = 5;   // " Mon " prefix width

function renderGoal(goal, year) {
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);
  const weeks    = buildYearGrid(year);
  const stats    = calculateStats(goal);

  // ── month label line ──────────────────────────────────────────────────────
  // Find first week-column where each month appears
  const monthCols = new Map(); // month (0-11) → week index
  for (let w = 0; w < weeks.length; w++) {
    for (const d of weeks[w]) {
      if (d.getFullYear() === year && d.getDate() === 1) {
        if (!monthCols.has(d.getMonth())) monthCols.set(d.getMonth(), w);
      }
    }
  }

  const labelBuf = new Array(weeks.length * CELL_W).fill(' ');
  for (const [month, col] of monthCols) {
    const label = MONTH_NAMES[month];
    const pos   = col * CELL_W;
    for (let i = 0; i < label.length && pos + i < labelBuf.length; i++) {
      labelBuf[pos + i] = label[i];
    }
  }
  const monthLine = dim(' '.repeat(LABEL_W) + labelBuf.join(''));

  // ── grid rows ─────────────────────────────────────────────────────────────
  const rows = DAY_LABELS.map((label, dayIdx) => {
    const prefix = dim(` ${label} `);   // e.g. " Mon "

    const cells = weeks.map(week => {
      const date          = week[dayIdx];
      const key           = dateKey(date);
      const inCurrentYear = date.getFullYear() === year;
      const isFuture      = date > today;
      const isToday       = key === todayKey;
      const status        = goal.days?.[key];

      if (isToday)                      return GLYPH_TODAY     + ' ';
      if (!inCurrentYear || isFuture)   return GLYPH_EMPTY     + ' ';
      if (status === 'completed')       return GLYPH_COMPLETED + ' ';
      if (status === 'missed')          return GLYPH_MISSED    + ' ';
      return GLYPH_EMPTY + ' ';
    }).join('');

    return prefix + cells;
  });

  // ── stats line ────────────────────────────────────────────────────────────
  const statsLine =
    `  ${stats.completed} completed · ${stats.missed} missed · ${stats.streak} day streak`;

  return [
    '',
    `  ${bold(goal.name)}`,
    statsLine,
    '',
    monthLine,
    ...rows,
  ].join('\n');
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function askPassword(prompt) {
  return new Promise(resolve => {
    const isTTY = process.stdin.isTTY;
    process.stdout.write(prompt);

    if (!isTTY) {
      // Non-interactive: read single line
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', line => { rl.close(); resolve(line.trim()); });
      return;
    }

    let pwd = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const handler = ch => {
      if (ch === '\r' || ch === '\n' || ch === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(pwd);
      } else if (ch === '\u007f') {
        if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        pwd += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', handler);
  });
}

// ─── Credential / token management ───────────────────────────────────────────

function loadSavedAuth() {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuth(data) {
  try {
    writeFileSync(AUTH_FILE, JSON.stringify({
      access_token  : data.access_token,
      refresh_token : data.refresh_token,
      expires_at    : data.expires_at,
    }), { mode: 0o600 });
  } catch { /* ignore */ }
}

function clearAuth() {
  try { writeFileSync(AUTH_FILE, '{}'); } catch { /* ignore */ }
}

async function getAccessToken() {
  // 1. Environment variables
  if (process.env.PIXELSTREAK_EMAIL && process.env.PIXELSTREAK_PASSWORD) {
    process.stdout.write(dim('  Signing in via env vars…'));
    const data = await signIn(process.env.PIXELSTREAK_EMAIL, process.env.PIXELSTREAK_PASSWORD);
    process.stdout.write('\r' + ' '.repeat(35) + '\r');
    saveAuth(data);
    return data.access_token;
  }

  // 2. Saved token
  const saved = loadSavedAuth();
  if (saved?.access_token && saved?.expires_at) {
    const expiresAt = new Date(saved.expires_at * 1000);
    if (expiresAt > new Date()) {
      return saved.access_token;
    }
    // Try refresh
    if (saved.refresh_token) {
      try {
        process.stdout.write(dim('  Refreshing session…'));
        const data = await refreshToken(saved.refresh_token);
        process.stdout.write('\r' + ' '.repeat(25) + '\r');
        saveAuth(data);
        return data.access_token;
      } catch { /* fall through to interactive */ }
    }
  }

  // 3. Interactive
  console.log(dim('\n  Enter your PixelStreak credentials:'));
  const email    = await ask('  Email   : ');
  const password = await askPassword('  Password: ');
  process.stdout.write(dim('\n  Signing in…'));
  const data = await signIn(email, password);
  process.stdout.write('\r' + ' '.repeat(20) + '\r');
  saveAuth(data);
  console.log(dim(`  Session saved to ${AUTH_FILE}\n`));
  return data.access_token;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const arg  = process.argv[2];
  const year = (arg && /^\d{4}$/.test(arg)) ? parseInt(arg) : new Date().getFullYear();

  // Header
  console.log('');
  console.log(`  PixelStreak — ${year}`);
  console.log('  ' + '─'.repeat(44));

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error(`\n  Login failed: ${err.message}\n`);
    process.exit(1);
  }

  let goals;
  try {
    process.stdout.write('  Loading goals…');
    goals = await fetchGoals(accessToken);
    process.stdout.write('\r' + ' '.repeat(25) + '\r');
  } catch (err) {
    // Token might be stale
    if (/jwt|expired|401/i.test(err.message)) {
      clearAuth();
      console.error('\n  Session expired — please run again to log in.\n');
    } else {
      console.error(`\n  Error fetching goals: ${err.message}\n`);
    }
    process.exit(1);
  }

  if (!goals.length) {
    console.log('\n  No goals found. Add some in the web app first!\n');
    return;
  }

  for (const goal of goals) {
    console.log(renderGoal(goal, year));
  }

  // Legend
  console.log('');
  console.log(
    `  Legend : ${GLYPH_COMPLETED} Completed   ` +
    `${GLYPH_MISSED} Missed   ` +
    `${GLYPH_EMPTY} Empty   ` +
    `${GLYPH_TODAY} Today`
  );
  console.log('  Tip    : pass a year as argument, e.g.  node terminal/pixel-streak.js 2025');
  console.log('');
}

main();
