#!/usr/bin/env node
/**
 * PixelStreak — Security Audit Script
 *
 * Static-analysis checks across the codebase covering:
 *
 *  Application Security (8 checks)
 *    1. Row Level Security (RLS) in Supabase
 *    2. Auth flows
 *    3. Rate limits
 *    4. Server-side validation
 *    5. Environment variables
 *    6. CAPTCHA
 *    7. CORS restrictions
 *    8. Error handling
 *
 *  Secrets & Credential Scanning (12 checks)
 *    9.  Full file audit
 *   10.  Private keys / mnemonics
 *   11.  API keys / tokens / secrets
 *   12.  .env files
 *   13.  .mcp.json files
 *   14.  config.json / config files with secrets
 *   15.  Plaintext passwords
 *   16.  RPC URLs with embedded keys
 *   17.  Wallet addresses in non-test files
 *   18.  console.log leaking sensitive data
 *   19.  .gitignore coverage gaps
 *   20.  Test files with real credentials
 *
 * Usage:  node security/audit.js
 * Exit:   0 = no FAIL / BLOCK findings, 1 = at least one FAIL / BLOCK
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const MAGENTA= '\x1b[35m';
const DIM    = '\x1b[2m';

// ─── File utilities ───────────────────────────────────────────────────────────

function read(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

/**
 * Recursively walk the repo, skipping node_modules / .git / binary extensions.
 * Returns array of { rel, abs, content } for text files.
 */
const SKIP_DIRS  = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache']);
const SKIP_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz']);

function walkFiles(dir = ROOT, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = resolve(dir, entry);
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      walkFiles(abs, acc);
    } else {
      if (SKIP_EXTS.has(extname(entry).toLowerCase())) continue;
      let content;
      try { content = readFileSync(abs, 'utf8'); } catch { continue; }
      acc.push({ rel: relative(ROOT, abs), abs, content });
    }
  }
  return acc;
}

function contains(text, pattern) {
  if (!text) return false;
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.includes(pattern);
}

function countMatches(text, pattern) {
  if (!text) return 0;
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return (text.match(re) || []).length;
}

// ─── Findings store ───────────────────────────────────────────────────────────

const findings = {};

function area(key) {
  if (!findings[key]) findings[key] = { status: 'PASS', items: [] };
}

function pass(key, msg)  { area(key); findings[key].items.push({ level: 'pass', msg }); }
function warn(key, msg)  { area(key); findings[key].items.push({ level: 'warn', msg }); if (findings[key].status === 'PASS') findings[key].status = 'WARN'; }
function fail(key, msg)  { area(key); findings[key].items.push({ level: 'fail', msg }); findings[key].status = 'FAIL'; }
// "block" = critical severity (exposed secret)
function block(key, msg) { area(key); findings[key].items.push({ level: 'block', msg }); findings[key].status = 'BLOCK'; }

// ─── Named source files ───────────────────────────────────────────────────────

const src = {
  setupSql:       read('setup_database.sql'),
  telegramSql:    read('telegram_setup.sql'),
  authJs:         read('js/auth.js'),
  appJs:          read('js/app.js'),
  indexHtml:      read('index.html'),
  appHtml:        read('app.html'),
  sendGoals:      read('supabase/functions/send-daily-goals/index.ts'),
  telegramBot:    read('supabase/functions/telegram-bot/index.ts'),
  trmnlSend:      read('trmnl/send.js'),
  swJs:           read('sw.js'),
  gitignore:      read('.gitignore'),
  supabaseConfig: read('supabase/config.toml'),
  configJs:       read('config.js'),
  mcpJson:        read('.claude/mcp.json'),
};

// Full corpus walk (done once, reused by secrets checks)
const allFiles = walkFiles();

// ─────────────────────────────────────────────────────────────────────────────
//  APPLICATION SECURITY CHECKS (1–8)
// ─────────────────────────────────────────────────────────────────────────────

// ─── 1. Row Level Security ────────────────────────────────────────────────────

(function checkRLS() {
  const sql    = (src.setupSql || '') + '\n' + (src.telegramSql || '');
  const tables = ['goals', 'telegram_accounts', 'telegram_link_tokens'];

  for (const t of tables) {
    if (new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, 'i').test(sql)) {
      pass('rls', `${t}: RLS enabled`);
    } else {
      fail('rls', `${t}: RLS NOT enabled`);
    }
  }

  const ops = {
    goals:                    ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    telegram_accounts:        ['SELECT', 'DELETE'],
    telegram_link_tokens:     ['SELECT', 'INSERT', 'DELETE'],
  };
  for (const [t, expected] of Object.entries(ops)) {
    for (const op of expected) {
      if (new RegExp(`ON ${t} FOR ${op}`, 'i').test(sql)) {
        pass('rls', `${t}: ${op} policy defined`);
      } else {
        fail('rls', `${t}: Missing ${op} policy`);
      }
    }
  }

  const uidCount = countMatches(sql, /auth\.uid\(\)/g);
  if (uidCount >= 5) pass('rls', `auth.uid() used in ${uidCount} policies`);
  else               warn('rls', `Only ${uidCount} auth.uid() usages — verify all policies are user-scoped`);

  const svcKeyEdges = [src.sendGoals, src.telegramBot].filter(f => f && contains(f, 'SERVICE_ROLE_KEY')).length;
  if (svcKeyEdges > 0)
    warn('rls', `${svcKeyEdges} edge function(s) use SERVICE_ROLE_KEY (RLS bypass) — intended for cron/bot but must be auth-gated`);
})();

// ─── 2. Auth Flows ────────────────────────────────────────────────────────────

(function checkAuth() {
  const html = src.indexHtml || '';
  const auth = src.authJs    || '';

  const flows = {
    signInWithPassword:    contains(auth, 'signInWithPassword'),
    signUp:                contains(auth, 'signUp'),
    resetPasswordForEmail: contains(auth, 'resetPasswordForEmail'),
    updateUser:            contains(auth, 'updateUser'),
    signOut:               contains(auth, 'signOut'),
    PASSWORD_RECOVERY:     contains(html, 'PASSWORD_RECOVERY'),
  };
  for (const [flow, present] of Object.entries(flows)) {
    if (present) pass('auth', `${flow} implemented`);
    else         fail('auth', `${flow} MISSING`);
  }

  if (/minlength=["']?6["']?/.test(html)) pass('auth', 'Password minlength=6 enforced in HTML');
  else                                     warn('auth', 'No minlength attribute on password inputs');

  if (contains(html, 'length < 6')) pass('auth', 'Password length validated in JS before reset');
  else                               warn('auth', 'No explicit JS password length check — only HTML attribute');

  if (/else if \(error\.message\) msg = error\.message/.test(html))
    warn('auth', 'Catch block falls through to raw error.message — may expose Supabase internals');

  if (contains(html, "console.error('Auth error:', error)"))
    warn('auth', 'console.error logs full error object — remove or sanitise for production');

  if (contains(src.appJs || '', 'checkAuth')) pass('auth', 'checkAuth() called in app.js — unauthenticated redirect active');
  else                                         fail('auth', 'checkAuth() not found in app.js — app may be accessible without login');
})();

// ─── 3. Rate Limits ───────────────────────────────────────────────────────────

(function checkRateLimits() {
  if (contains(src.sendGoals, 'CRON_SECRET') && contains(src.sendGoals, '401'))
    pass('rate', 'send-daily-goals: CRON_SECRET bearer auth with 401 on mismatch');
  else
    fail('rate', 'send-daily-goals: Missing CRON_SECRET auth or 401 response');

  const hasTelegramSecret = contains(src.telegramBot, 'X-Telegram-Bot-Api-Secret-Token') ||
                            contains(src.telegramBot, 'secret_token');
  if (hasTelegramSecret) pass('rate', 'telegram-bot: Webhook secret token validation present');
  else                   warn('rate', 'telegram-bot: No X-Telegram-Bot-Api-Secret-Token check — open to spoofed updates');

  if (src.supabaseConfig) {
    if (contains(src.supabaseConfig, 'rate_limit')) pass('rate', 'supabase/config.toml: rate_limit configuration found');
    else                                             warn('rate', 'supabase/config.toml exists but no rate_limit key');
  } else {
    warn('rate', 'No supabase/config.toml — relying on Supabase dashboard defaults for rate limits');
  }

  const appJs = src.appJs || '';
  if (contains(appJs, 'debounce') || (contains(appJs, 'setTimeout') && contains(appJs, 'clearTimeout')))
    pass('rate', 'app.js: debounce/throttle pattern detected');
  else
    warn('rate', 'app.js: No debouncing on goal updates — rapid clicks may generate excessive Supabase writes');
})();

// ─── 4. Server-Side Validation ────────────────────────────────────────────────

(function checkValidation() {
  const appJs = src.appJs  || '';
  const botTs = src.telegramBot || '';
  const html  = src.indexHtml   || '';

  if (/trim\(\)/.test(appJs) || /\.length/.test(appJs))
    warn('validation', 'app.js: Some string ops present but no explicit max-length or XSS sanitisation on goal names');
  else
    warn('validation', 'app.js: No visible validation on goal name before insert — empty/XSS strings may be stored');

  if (contains(appJs, 'contenteditable') || contains(src.appHtml || '', 'contenteditable')) {
    if (contains(appJs, 'textContent') || contains(appJs, 'innerText'))
      pass('validation', 'contenteditable read via textContent/innerText (XSS-safe)');
    else
      warn('validation', 'contenteditable used — verify goal title read via .textContent, not .innerHTML');
  }

  if (contains(botTs, "data.split(':')"))
    warn('validation', 'telegram-bot: callback_data split() without type/format validation — malformed payloads may cause errors');

  if (contains(html, 'type="email"')) pass('validation', 'email input uses type="email" (browser-level validation)');
  else                                 warn('validation', 'No type="email" on email input');

  warn('validation', 'Architecture: client-only app — goal validation relies solely on Supabase RLS + anon key, not a dedicated backend');
})();

// ─── 5. Environment Variables ─────────────────────────────────────────────────

(function checkEnvVars() {
  const gi = src.gitignore || '';

  // config.js is intentionally committed — it only holds the public anon key + URL
  // Severity is determined below by inspecting what's actually in the file

  if (contains(gi, '.env')) pass('envvars', '.gitignore: .env ignored');
  else                       warn('envvars', '.gitignore: .env not explicitly listed');

  if (src.configJs) {
    let isTracked = false;
    try {
      isTracked = execSync('git ls-files config.js', { cwd: ROOT }).toString().trim().length > 0;
    } catch { /* git unavailable */ }

    if (isTracked) {
      // Check what's actually in it before deciding severity
      const hasServiceKey = /SERVICE_ROLE|service_role/i.test(src.configJs);
      const hasJwt        = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/.test(src.configJs);
      const hasAnonOnly   = /sb_publishable_/.test(src.configJs) && !hasServiceKey && !hasJwt;

      if (hasServiceKey) {
        block('envvars', 'config.js committed to git and contains SERVICE_ROLE_KEY — rotate immediately and remove from history');
      } else if (hasJwt) {
        fail('envvars', 'config.js committed to git and contains a full JWT — verify it is the anon key only (starts with eyJ); if it is the service role key, rotate immediately');
      } else if (hasAnonOnly) {
        pass('envvars', 'config.js committed to git — contains only the Supabase anon/publishable key and URL, which are intentionally public (safe as long as RLS is configured)');
      } else {
        warn('envvars', 'config.js committed to git — verify it contains only public credentials (anon key, URL), not SERVICE_ROLE_KEY or other secrets');
      }
    } else {
      warn('envvars', 'config.js exists on disk but is not git-tracked — ensure .gitignore stays correct');
    }

    if (/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/.test(src.configJs) && !/sb_publishable_/.test(src.configJs))
      fail('envvars', 'config.js contains a full JWT (not a publishable key) — confirm this is the anon key and not the service role key');
  } else {
    pass('envvars', 'config.js absent from working directory (correctly gitignored)');
  }

  const denoEnvCount = countMatches(
    (src.sendGoals || '') + (src.telegramBot || ''),
    /Deno\.env\.get\(/g
  );
  if (denoEnvCount >= 4) pass('envvars', `Edge functions: ${denoEnvCount} Deno.env.get() calls — no hardcoded secrets`);
  else                   warn('envvars', `Only ${denoEnvCount} Deno.env.get() calls in edge functions`);

  const clientSrc = (src.indexHtml || '') + (src.appHtml || '') + (src.appJs || '') + (src.authJs || '');
  if (contains(clientSrc, 'SERVICE_ROLE_KEY') || contains(clientSrc, 'service_role'))
    block('envvars', 'SERVICE_ROLE_KEY in client-side code — CRITICAL: bypasses all RLS');
  else
    pass('envvars', 'SERVICE_ROLE_KEY not found in any client-side file');

  if (contains(src.authJs || '', 'SUPABASE_ANON_KEY'))
    warn('envvars', 'SUPABASE_ANON_KEY used client-side (expected for Supabase) — RLS correctness is critical');
})();

// ─── 6. CAPTCHA ───────────────────────────────────────────────────────────────

(function checkCaptcha() {
  const html = (src.indexHtml || '') + (src.appHtml || '');
  const auth = src.authJs || '';
  const kw   = ['captcha', 'hcaptcha', 'recaptcha', 'turnstile', 'cf-turnstile'];

  if (kw.some(k => contains(html.toLowerCase(), k) || contains(auth.toLowerCase(), k)))
    pass('captcha', 'CAPTCHA integration detected in auth forms');
  else
    fail('captcha', 'No CAPTCHA on sign-up / sign-in / forgot-password — vulnerable to bot signups and credential stuffing');

  if (contains(auth, 'captchaToken') || contains(auth, 'gotrue_meta_security'))
    pass('captcha', 'captchaToken passed in signUp options');
  else
    warn('captcha', 'signUp() does not pass captchaToken — enable CAPTCHA in Supabase dashboard AND pass token from client');
})();

// ─── 7. CORS Restrictions ─────────────────────────────────────────────────────

(function checkCORS() {
  const edge = (src.sendGoals || '') + (src.telegramBot || '');

  if (contains(edge, "'Access-Control-Allow-Origin', '*'") || contains(edge, '"Access-Control-Allow-Origin", "*"'))
    warn('cors', 'Edge function(s): Access-Control-Allow-Origin: * — restrict to your domain in production');
  else if (contains(edge, 'Access-Control-Allow-Origin'))
    pass('cors', 'Edge functions set Access-Control-Allow-Origin with a specific value');
  else
    pass('cors', 'Edge functions: no custom CORS headers — Supabase platform default CORS applied');

  const sw = src.swJs || '';
  if (contains(sw, 'supabase.co') && contains(sw, 'cache'))
    warn('cors', 'sw.js: Supabase requests may be cached — ensure auth/data responses are excluded');
  else
    pass('cors', 'sw.js: No Supabase response caching detected');

  if (src.supabaseConfig && contains(src.supabaseConfig, 'cors'))
    pass('cors', 'supabase/config.toml has CORS configuration');
  else
    warn('cors', 'No CORS config in supabase/config.toml — relying on Supabase dashboard settings');
})();

// ─── 8. Error Handling / Data Leakage ─────────────────────────────────────────

(function checkErrorHandling() {
  const html  = src.indexHtml || '';
  const appJs = src.appJs     || '';
  const edges = (src.sendGoals || '') + (src.telegramBot || '');

  if (/console\.error\([^)]*error[^)]*\)/.test(html))
    warn('errors', 'index.html: console.error with full error object — sanitise for production');
  if (/console\.error\([^)]*error[^)]*\)/.test(appJs))
    warn('errors', 'app.js: console.error with full error object — may expose stack traces');

  if (contains(html, 'unhandledrejection') || contains(appJs, 'unhandledrejection'))
    pass('errors', 'unhandledrejection handler present');
  else
    warn('errors', 'No unhandledrejection handler — silent failures may log sensitive data');

  if (/\.stack|new Error\(.*\)\.stack/.test(edges))
    warn('errors', 'Edge functions may expose stack traces in responses');
  else
    pass('errors', 'Edge functions: no stack trace exposure detected');

  const sanitisedMsgs = ['Invalid email or password', 'Please confirm your email', 'An account with this email already exists', 'An error occurred'];
  if (sanitisedMsgs.every(m => contains(html, m)))
    pass('errors', 'Auth errors mapped to user-friendly messages');
  else
    warn('errors', 'Some auth errors may not be in the sanitisation map');

  if (/else if \(error\.message\) msg = error\.message/.test(html))
    warn('errors', 'Catch block falls through to raw error.message — Supabase internals could appear in UI');
})();

// ─────────────────────────────────────────────────────────────────────────────
//  SECRETS & CREDENTIAL SCANNING (9–20)
// ─────────────────────────────────────────────────────────────────────────────

// Patterns that indicate real secrets (not examples/placeholders)
const SECRET_PATTERNS = [
  // Generic high-entropy API keys / tokens
  { name: 'Generic API key (32+ hex)',          re: /\b[0-9a-f]{32,64}\b/i },
  { name: 'Supabase JWT (service role)',         re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  // NOTE: sb_publishable_ (Supabase anon key) is intentionally public — excluded from secret scanning
  { name: 'OpenAI API key',                     re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Anthropic API key',                  re: /sk-ant-[A-Za-z0-9\-_]{10,}/ },
  { name: 'GitHub token (ghp_/ghs_/gho_)',      re: /gh[pso]_[A-Za-z0-9]{36}/ },
  { name: 'Telegram bot token',                 re: /\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { name: 'AWS access key',                     re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Stripe secret key',                  re: /sk_(live|test)_[A-Za-z0-9]{24,}/ },
  { name: 'Sendgrid key',                       re: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  { name: 'Slack token',                        re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
];

const PRIVATE_KEY_PATTERNS = [
  { name: 'PEM private key header',             re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Ethereum private key (0x + 64 hex)', re: /0x[0-9a-fA-F]{64}\b/ },
  { name: 'BIP-39 mnemonic (12 words)',          re: /\b([a-z]{3,8}\s){11}[a-z]{3,8}\b/ },
];

const WALLET_PATTERN  = /0x[0-9a-fA-F]{40}\b/;
const RPC_KEY_PATTERN = /https:\/\/(?:mainnet|polygon|arbitrum|optimism|bsc|goerli|sepolia|ropsten|rinkeby)\.(?:infura|alchemy)\.io\/v\d\/[A-Za-z0-9]{20,}/i;
const PLAINTEXT_PW_PATTERNS = [
  /password\s*[:=]\s*["'][^"']{6,}["']/i,
  /passwd\s*[:=]\s*["'][^"']{4,}["']/i,
  /pwd\s*[:=]\s*["'][^"']{4,}["']/i,
];
const CONSOLE_LOG_SENSITIVE = /(console\.log|console\.info|console\.debug)\s*\([^)]*?(password|secret|token|key|credential|private|auth)/i;

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$|__tests__\//;

// ─── 9. Full file audit ────────────────────────────────────────────────────────

(function fullFileAudit() {
  const count = allFiles.length;
  pass('fullaudit', `Scanned ${count} files across the repository`);

  // Flag any file >500KB (unusual, could hide data)
  const large = allFiles.filter(f => f.content.length > 500_000);
  if (large.length === 0) pass('fullaudit', 'No unexpectedly large text files found');
  else                     warn('fullaudit', `${large.length} large file(s) (>500KB): ${large.map(f => f.rel).join(', ')}`);
})();

// ─── 10. Private keys / mnemonics ─────────────────────────────────────────────

(function checkPrivateKeys() {
  let found = false;
  for (const { rel, content } of allFiles) {
    for (const { name, re } of PRIVATE_KEY_PATTERNS) {
      if (re.test(content)) {
        block('privatekeys', `${rel}: ${name} detected — rotate immediately and remove from repo`);
        found = true;
      }
    }
  }
  if (!found) pass('privatekeys', 'No private keys or mnemonic phrases found in any tracked file');
})();

// ─── 11. API keys / tokens / secrets ──────────────────────────────────────────

(function checkApiKeys() {
  // Files that are expected to reference key variable names or known-public credentials
  // config.js is handled by the envvars check (#5) which flags whether it's git-tracked
  const allowList = new Set(['security/audit.js', '.claude/commands/security-check.md', 'config.js']);

  let found = false;
  for (const { rel, content } of allFiles) {
    if (allowList.has(rel)) continue;
    // Skip .env — covered by check 12
    if (rel === '.env' || rel.endsWith('/.env')) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      const matches = content.match(re);
      if (!matches) continue;
      // Skip if it looks like a placeholder/example
      const sample = matches[0];
      if (/example|placeholder|your.key|xxx|000000|test/i.test(sample)) continue;
      block('apikeys', `${rel}: Possible ${name} hardcoded — "${sample.slice(0, 40)}..."`);
      found = true;
    }
  }
  if (!found) pass('apikeys', 'No hardcoded API keys or tokens detected in non-env files');
})();

// ─── 12. .env files ────────────────────────────────────────────────────────────

(function checkEnvFiles() {
  const gi = src.gitignore || '';
  const envFiles = allFiles.filter(({ rel }) => rel === '.env' || /\/\.env$/.test(rel) || rel.startsWith('.env.'));

  if (envFiles.length === 0) {
    pass('envfiles', 'No .env files found in working directory');
  } else {
    for (const { rel } of envFiles) {
      if (contains(gi, rel) || contains(gi, '.env')) {
        warn('envfiles', `${rel} exists on disk — confirmed gitignored, but ensure it was never committed`);
      } else {
        block('envfiles', `${rel} exists and is NOT in .gitignore — credentials may be exposed in git history`);
      }
    }
  }

  // Check for .env in git history is out of scope for static analysis — note it
  warn('envfiles', 'Recommendation: run `git log --all --full-history -- "*.env"` to confirm .env was never committed');
})();

// ─── 13. .mcp.json files ──────────────────────────────────────────────────────

(function checkMcpJson() {
  const gi  = src.gitignore || '';
  const mcp = src.mcpJson;
  const rel = '.claude/mcp.json';

  if (!mcp) {
    pass('mcpjson', `${rel} not found — no MCP secret exposure risk`);
    return;
  }

  // Check for embedded API keys / tokens inside mcp.json
  let hasSecrets = false;
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(mcp)) {
      const sample = mcp.match(re)?.[0] || '';
      if (/example|placeholder|your.key|xxx/i.test(sample)) continue;
      block('mcpjson', `${rel}: Possible ${name} in MCP config — "${sample.slice(0, 40)}..." — move to env vars`);
      hasSecrets = true;
    }
  }

  if (!hasSecrets) pass('mcpjson', `${rel}: No hardcoded secrets detected in MCP config`);

  // .claude/ directory entry in .gitignore covers .claude/mcp.json
  if (contains(gi, '.claude/') || contains(gi, '.claude\n') || gi.split('\n').some(l => l.trim() === '.claude')) {
    pass('mcpjson', `${rel}: Covered by .claude entry in .gitignore`);
  } else if (contains(gi, rel)) {
    pass('mcpjson', `${rel}: Explicitly listed in .gitignore`);
  } else {
    warn('mcpjson', `${rel}: Not gitignored — if it contains API keys, add .claude/ or .claude/mcp.json to .gitignore`);
  }
})();

// ─── 14. config.json / config files with secrets ──────────────────────────────

(function checkConfigFiles() {
  const gi = src.gitignore || '';
  const configFiles = allFiles.filter(({ rel }) =>
    /config\.(js|json|ts|yaml|yml|toml)$/i.test(rel) && !rel.includes('node_modules')
  );

  let anyFound = false;
  for (const { rel, content } of configFiles) {
    let hasSecret = false;
    for (const { name, re } of SECRET_PATTERNS) {
      const match = content.match(re)?.[0];
      if (!match) continue;
      if (/example|placeholder|your.key|xxx|000000/i.test(match)) continue;
      // Supabase anon/publishable key is intentionally public — downgrade to info
      if (/sb_publishable_/.test(match)) {
        pass('configfiles', `${rel}: Supabase anon key present — public by design, safe as long as RLS is enabled`);
        continue;
      }
      if (contains(gi, rel)) {
        warn('configfiles', `${rel}: Possible ${name} — gitignored, but rotate if accidentally committed previously`);
      } else {
        block('configfiles', `${rel}: Possible ${name} NOT gitignored — "${match.slice(0, 40)}..."`);
      }
      hasSecret = true;
      anyFound  = true;
    }
    if (!hasSecret) pass('configfiles', `${rel}: No secrets detected`);
  }

  if (configFiles.length === 0) pass('configfiles', 'No config.js/json/ts/yaml/toml files found');
  if (!anyFound && configFiles.length > 0) pass('configfiles', 'No hardcoded secrets in config files');
})();

// ─── 15. Plaintext passwords ──────────────────────────────────────────────────

(function checkPlaintextPasswords() {
  const allowList = new Set(['security/audit.js', '.claude/commands/security-check.md', 'trmnl/run.sh']);
  let found = false;

  for (const { rel, content } of allFiles) {
    if (allowList.has(rel)) continue;
    for (const re of PLAINTEXT_PW_PATTERNS) {
      const match = content.match(re)?.[0];
      if (!match) continue;
      if (/example|placeholder|your_password|changeme|xxx/i.test(match)) continue;
      block('plaintextpw', `${rel}: Plaintext password pattern — "${match.slice(0, 60)}"`);
      found = true;
    }
  }
  if (!found) pass('plaintextpw', 'No plaintext password assignments found');
})();

// ─── 16. RPC URLs with embedded keys ─────────────────────────────────────────

(function checkRpcUrls() {
  let found = false;
  for (const { rel, content } of allFiles) {
    if (RPC_KEY_PATTERN.test(content)) {
      block('rpcurls', `${rel}: RPC URL with embedded API key (Infura/Alchemy) — move key to env var`);
      found = true;
    }
  }
  if (!found) pass('rpcurls', 'No RPC URLs with embedded API keys found');
})();

// ─── 17. Wallet addresses in non-test files ───────────────────────────────────

(function checkWalletAddresses() {
  let found = false;
  for (const { rel, content } of allFiles) {
    if (TEST_FILE_PATTERN.test(rel)) continue; // allowed in tests
    const matches = content.match(new RegExp(WALLET_PATTERN.source, 'g')) || [];
    for (const addr of matches) {
      // 0x + 40 hex chars = Ethereum address; skip 0x + 64 (private key, caught above)
      if (addr.length === 42) {
        warn('wallets', `${rel}: Ethereum wallet address ${addr.slice(0, 10)}... in non-test file — verify it is intentional`);
        found = true;
      }
    }
  }
  if (!found) pass('wallets', 'No wallet addresses found in non-test files');
})();

// ─── 18. console.log leaking sensitive data ───────────────────────────────────

(function checkConsoleLogLeaks() {
  // Skip the audit script itself and the slash command (they reference these words intentionally)
  const skipFiles = new Set(['security/audit.js', '.claude/commands/security-check.md']);
  let found = false;
  for (const { rel, content } of allFiles) {
    if (skipFiles.has(rel)) continue;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Match console.log where the sensitive word appears as a variable/identifier,
      // not just as part of a string literal label
      if (CONSOLE_LOG_SENSITIVE.test(line) && !/['"`][^'"`]*(password|secret|token|key|credential|private|auth)[^'"`]*['"`]/.test(line)) {
        warn('consoleleaks', `${rel}:${i + 1}: console.log may expose sensitive data — "${line.trim().slice(0, 80)}"`);
        found = true;
      }
    });
  }
  if (!found) pass('consoleleaks', 'No console.log statements found logging sensitive variables');
})();

// ─── 19. .gitignore coverage gaps ─────────────────────────────────────────────

(function checkGitignoreCoverage() {
  const gi = src.gitignore || '';

  const required = [
    { pattern: '.env',         reason: 'environment variables file' },
    { pattern: '*.pem',        reason: 'PEM private keys' },
    { pattern: '*.key',        reason: 'private key files' },
    { pattern: '.DS_Store',    reason: 'macOS metadata' },
    { pattern: 'node_modules', reason: 'npm dependencies' },
    // Note: config.js is intentionally committed — it contains only public Supabase anon key + URL
  ];

  for (const { pattern, reason } of required) {
    if (contains(gi, pattern)) pass('gitignore', `${pattern} covered (${reason})`);
    else                        warn('gitignore', `${pattern} not in .gitignore — add it (${reason})`);
  }

  // .claude/ entry covers .claude/mcp.json
  const claudeCovered = contains(gi, '.claude/') || gi.split('\n').some(l => l.trim() === '.claude');
  if (claudeCovered || contains(gi, '.claude/mcp.json')) {
    pass('gitignore', '.claude/mcp.json covered by .gitignore');
  } else {
    warn('gitignore', '.claude/mcp.json not gitignored — add .claude/ or .claude/mcp.json if it may contain API keys');
  }

  // Suggest secret-file patterns commonly missed
  const suggested = ['*.secret', '*.secrets', 'secrets.*', '.secrets', '**/*.pfx', '**/*.p12'];
  const missing   = suggested.filter(p => !contains(gi, p));
  if (missing.length > 0) {
    warn('gitignore', `Consider adding to .gitignore: ${missing.join(', ')}`);
  }
})();

// ─── 20. Test files with real credentials ─────────────────────────────────────

(function checkTestCredentials() {
  const testFiles = allFiles.filter(({ rel }) => TEST_FILE_PATTERN.test(rel));

  if (testFiles.length === 0) {
    pass('testcreds', 'No test files found');
    return;
  }

  let found = false;
  for (const { rel, content } of testFiles) {
    for (const { name, re } of SECRET_PATTERNS) {
      const match = content.match(re)?.[0];
      if (!match) continue;
      if (/example|placeholder|your.key|xxx|fake|mock|dummy|test_key/i.test(match)) continue;
      block('testcreds', `${rel}: Possible real ${name} in test file — use fixture/mock values instead`);
      found = true;
    }
  }
  if (!found) pass('testcreds', `${testFiles.length} test file(s) checked — no real credentials detected`);
})();

// ─────────────────────────────────────────────────────────────────────────────
//  REPORT
// ─────────────────────────────────────────────────────────────────────────────

const areaLabels = {
  // Application security
  rls:          '1.  Row Level Security (RLS)',
  auth:         '2.  Auth Flows',
  rate:         '3.  Rate Limits',
  validation:   '4.  Server-Side Validation',
  envvars:      '5.  Environment Variables',
  captcha:      '6.  CAPTCHA',
  cors:         '7.  CORS Restrictions',
  errors:       '8.  Error Handling',
  // Secrets scanning
  fullaudit:    '9.  Full File Audit',
  privatekeys:  '10. Private Keys / Mnemonics',
  apikeys:      '11. API Keys / Tokens',
  envfiles:     '12. .env Files',
  mcpjson:      '13. .mcp.json Files',
  configfiles:  '14. Config Files with Secrets',
  plaintextpw:  '15. Plaintext Passwords',
  rpcurls:      '16. RPC URLs with Keys',
  wallets:      '17. Wallet Addresses',
  consoleleaks: '18. console.log Data Leaks',
  gitignore:    '19. .gitignore Coverage',
  testcreds:    '20. Test Files with Credentials',
};

function statusColor(s) {
  if (s === 'BLOCK') return MAGENTA + BOLD + 'BLOCK' + RESET;
  if (s === 'PASS')  return GREEN   + BOLD + 'PASS'  + RESET;
  if (s === 'WARN')  return YELLOW  + BOLD + 'WARN'  + RESET;
  return RED + BOLD + 'FAIL' + RESET;
}

function levelPrefix(level) {
  if (level === 'pass')  return GREEN   + '  ✓' + RESET;
  if (level === 'warn')  return YELLOW  + '  ⚠' + RESET;
  if (level === 'block') return MAGENTA + '  ⛔' + RESET;
  return RED + '  ✗' + RESET;
}

console.log(`\n${BOLD}${CYAN}╔════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║        PixelStreak — Security Audit Report             ║${RESET}`);
console.log(`${BOLD}${CYAN}╚════════════════════════════════════════════════════════╝${RESET}\n`);

console.log(`${BOLD}${DIM}── APPLICATION SECURITY ──────────────────────────────────${RESET}`);
const appAreas = ['rls','auth','rate','validation','envvars','captcha','cors','errors'];
const maxLen = Math.max(...Object.values(areaLabels).map(l => l.length));
for (const key of appAreas) {
  const label = areaLabels[key];
  const dots  = DIM + '.'.repeat(maxLen - label.length + 4) + RESET;
  console.log(`  ${BOLD}${label}${RESET} ${dots} ${statusColor(findings[key]?.status || 'PASS')}`);
}

console.log(`\n${BOLD}${DIM}── SECRETS & CREDENTIAL SCANNING ─────────────────────────${RESET}`);
const secretAreas = ['fullaudit','privatekeys','apikeys','envfiles','mcpjson','configfiles','plaintextpw','rpcurls','wallets','consoleleaks','gitignore','testcreds'];
for (const key of secretAreas) {
  const label = areaLabels[key];
  const dots  = DIM + '.'.repeat(maxLen - label.length + 4) + RESET;
  console.log(`  ${BOLD}${label}${RESET} ${dots} ${statusColor(findings[key]?.status || 'PASS')}`);
}

console.log(`\n${DIM}${'─'.repeat(58)}${RESET}`);
console.log(`${BOLD}DETAILS${RESET}`);
console.log(`${DIM}${'─'.repeat(58)}${RESET}\n`);

for (const [key, label] of Object.entries(areaLabels)) {
  const f = findings[key];
  if (!f) continue;
  console.log(`${BOLD}${label} — ${statusColor(f.status)}${RESET}`);
  for (const item of f.items) {
    console.log(`${levelPrefix(item.level)} ${item.msg}`);
  }
  console.log('');
}

// Summary
const counts = { BLOCK: 0, FAIL: 0, WARN: 0, PASS: 0 };
for (const f of Object.values(findings)) counts[f.status] = (counts[f.status] || 0) + 1;

console.log(`${DIM}${'─'.repeat(58)}${RESET}`);
console.log(`${BOLD}SUMMARY${RESET}`);
console.log(`${DIM}${'─'.repeat(58)}${RESET}`);
console.log(`  ${MAGENTA}${BOLD}BLOCK${RESET} ${counts.BLOCK}  ${RED}${BOLD}FAIL${RESET} ${counts.FAIL}  ${YELLOW}${BOLD}WARN${RESET} ${counts.WARN}  ${GREEN}${BOLD}PASS${RESET} ${counts.PASS}\n`);

// Recommended fixes
const recs = [];
function rec(severity, msg) { recs.push({ severity, msg }); }

// BLOCK
if (findings.privatekeys?.status === 'BLOCK')  rec('BLOCK', 'Remove all private keys / mnemonics from the repo and rotate them immediately');
if (findings.apikeys?.status     === 'BLOCK')  rec('BLOCK', 'Remove hardcoded API keys — use environment variables or a secrets manager');
if (findings.envfiles?.status    === 'BLOCK')  rec('BLOCK', 'Add .env files to .gitignore and purge from git history (git filter-repo or BFG)');
if (findings.mcpjson?.status     === 'BLOCK')  rec('BLOCK', 'Move secrets out of .mcp.json into env vars and gitignore the file');
if (findings.configfiles?.status === 'BLOCK')  rec('BLOCK', 'Remove secrets from config files — use Deno.env.get() / process.env instead');
if (findings.plaintextpw?.status === 'BLOCK')  rec('BLOCK', 'Replace plaintext password assignments with references to environment variables');
if (findings.rpcurls?.status     === 'BLOCK')  rec('BLOCK', 'Move embedded RPC API keys (Infura/Alchemy) out of source files into env vars');
if (findings.testcreds?.status   === 'BLOCK')  rec('BLOCK', 'Replace real credentials in test files with mock/fixture values');
if (findings.envvars?.status     === 'BLOCK')  rec('BLOCK', 'SERVICE_ROLE_KEY found client-side — remove immediately, it bypasses all RLS');

// CRITICAL
if (findings.captcha?.status === 'FAIL')       rec('CRITICAL', 'Add CAPTCHA (Cloudflare Turnstile recommended) to sign-up and forgot-password forms and pass captchaToken to signUp()');
if (findings.rls?.status     === 'FAIL')       rec('CRITICAL', 'Enable RLS and add missing policies on all Supabase tables');

// HIGH
if (findings.errors?.status !== 'PASS')        rec('HIGH', 'Remove console.error(error) in production; remove raw error.message fallthrough in auth catch block');
if (findings.rate?.status   !== 'PASS')        rec('HIGH', 'Add X-Telegram-Bot-Api-Secret-Token check to telegram-bot; add debouncing to app.js goal updates');
if (findings.consoleleaks?.status !== 'PASS')  rec('HIGH', 'Remove or sanitise console.log statements that reference passwords, tokens, or secrets');

// MEDIUM
if (findings.gitignore?.status !== 'PASS')     rec('MEDIUM', 'Fix .gitignore gaps: add *.pem, *.key, .claude/mcp.json and other secret file patterns');
if (findings.cors?.status      !== 'PASS')     rec('MEDIUM', 'Add supabase/config.toml with explicit cors.allowed_origins for your production domain');
if (findings.validation?.status !== 'PASS')    rec('MEDIUM', 'Add max-length and whitespace validation on goal names; verify contenteditable uses .textContent');
if (findings.wallets?.status   !== 'PASS')     rec('MEDIUM', 'Review wallet addresses in non-test files — move hardcoded addresses to config if needed');

// LOW
if (findings.auth?.status !== 'PASS')          rec('LOW', 'Add JS password strength check on sign-up; add global unhandledrejection handler');

if (recs.length > 0) {
  console.log(`${DIM}${'─'.repeat(58)}${RESET}`);
  console.log(`${BOLD}RECOMMENDED FIXES (priority order)${RESET}`);
  console.log(`${DIM}${'─'.repeat(58)}${RESET}`);
  recs.forEach((r, i) => {
    const color = r.severity === 'BLOCK' || r.severity === 'CRITICAL' ? RED
                : r.severity === 'HIGH'   ? YELLOW
                : RESET;
    console.log(`  ${color}${i + 1}. [${r.severity}] ${r.msg}${RESET}`);
  });
  console.log('');
}

const hasBlockOrFail = Object.values(findings).some(f => f.status === 'BLOCK' || f.status === 'FAIL');
process.exit(hasBlockOrFail ? 1 : 0);
