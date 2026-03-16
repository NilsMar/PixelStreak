# Security Audit — PixelStreak

Perform a thorough security audit of the PixelStreak codebase. Check all 20 areas below
(8 application security + 12 secrets/credential scanning), reading the relevant files,
and produce a final report with PASS / WARN / FAIL / BLOCK status for each.

Status definitions:
- **BLOCK** — secret/credential actively exposed; stop everything and fix immediately
- **FAIL**  — clear vulnerability or missing control
- **WARN**  — low-exploitability issue or partially mitigated risk
- **PASS**  — no issues found

---

## Files to read

Read ALL of these before reporting:
- `setup_database.sql`
- `telegram_setup.sql`
- `js/auth.js`
- `index.html`
- `app.html`
- `js/app.js`
- `supabase/functions/send-daily-goals/index.ts`
- `supabase/functions/telegram-bot/index.ts`
- `trmnl/send.js`
- `.gitignore`
- `sw.js`

---

## Audit Checklist

### 1. Row Level Security (RLS) — Supabase
Check `setup_database.sql` and `telegram_setup.sql`:
- Is `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present for **every** table?
- Are SELECT, INSERT, UPDATE, DELETE policies defined and do they all use `auth.uid() = user_id`?
- Is there any table missing INSERT or UPDATE policies that should have them?
- Do edge functions use `SERVICE_ROLE_KEY` (bypasses RLS) — and is that bypass justified or risky?

**Report:** List each table and its RLS status + any missing policies.

---

### 2. Auth Flows
Check `js/auth.js`, `index.html`, and the `supabase.auth.onAuthStateChange` handler:
- Are all four flows covered: **sign-in**, **sign-up**, **forgot password**, **reset password**?
- Does the password reset detect `PASSWORD_RECOVERY` event and switch UI correctly?
- Is there a minimum password length enforced both in HTML (`minlength`) and client-side JS?
- Are auth errors caught and handled without crashing the page?
- **Data leak check**: does the catch block pass raw `error.message` to the UI? Enumerate which error messages are shown verbatim vs. sanitised.
- Are sessions cleaned up on sign-out?

---

### 3. Rate Limits on API Endpoints
Check the two Supabase edge functions and `js/app.js`:
- Is the `send-daily-goals` function protected by a `CRON_SECRET` bearer token? Does it return 401 on mismatch?
- Is the `telegram-bot` webhook protected against replay or abuse (e.g. Telegram secret token header)?
- Is there any client-side debouncing or throttling on form submissions or goal updates in `app.js`?
- Are there any Supabase rate-limiting configs (`supabase/config.toml`) present?

**Note:** Supabase free tier has built-in rate limits but no custom per-endpoint limits exist unless configured.

---

### 4. Server-Side Validation
Check `js/auth.js`, `js/app.js`, edge functions, and forms in `index.html` / `app.html`:
- Is validation for **goal names** performed before inserting to Supabase (e.g. empty string, max length, XSS)?
- Is email validated beyond `type="email"` HTML attribute?
- Do edge functions validate the shape/type of incoming JSON before using it (e.g. `callback_data` parsing in telegram-bot)?
- Is `contenteditable` goal title input sanitised before being sent to Supabase?

---

### 5. Environment Variables Locked Down
Check `.gitignore`, `config.js` references, edge function env usage, and `trmnl/`:
- Is `config.js` listed in `.gitignore`? Is `.env` listed?
- Are any credentials hardcoded in any JS/TS/SQL file?
- Do edge functions use `Deno.env.get(...)` rather than inline values?
- Does `trmnl/send.js` load credentials from environment rather than hardcoding?
- Is `SERVICE_ROLE_KEY` ever referenced client-side (would be critical if so)?
- Is `SUPABASE_ANON_KEY` exposed client-side — and is that intentional/safe given RLS is active?

---

### 6. CAPTCHA on Public Forms
Check `index.html` and Supabase auth config references:
- Is there any CAPTCHA (hCaptcha, Cloudflare Turnstile, reCAPTCHA) on the sign-up or sign-in form?
- Is there any Supabase CAPTCHA config (`supabase.auth.verifyOtp` options or captcha token in `signUp`)?
- Is there bot-protection on the forgot-password form to prevent email flooding?

---

### 7. CORS Restrictions
Check edge function response headers and any Supabase config files:
- Do Supabase edge functions set `Access-Control-Allow-Origin` headers — and if so, are they `*` (bad) or restricted?
- Is there a `supabase/config.toml` that configures allowed origins?
- Does the Service Worker (`sw.js`) cache any auth responses that could be replayed?

---

### 8. Error Handling — No Data Leakage
Check `index.html` (catch block), `js/app.js` (any try/catch), and edge functions:
- Does any catch block log sensitive data via `console.error` with the full error object?
- Does any UI display raw API error messages (stack traces, SQL errors, Supabase internals)?
- Do edge functions return generic error responses (not stack traces) on failure?
- Is there a global error handler or unhandledrejection listener?

---

---

## Part B — Secrets & Credential Scanning

For each check, scan **every non-binary file in the repo** (walk the entire tree, skip
`node_modules/`, `.git/`, images, and binaries).

### 9. Full File Audit
- How many files are in the repo?
- Are there any unexpectedly large files (>500 KB) that could hide data?
- List any files that appear out of place for this project type.

### 10. Private Keys / Mnemonics — BLOCK severity
Scan all files for:
- PEM headers: `-----BEGIN (RSA|EC|OPENSSH)? PRIVATE KEY-----`
- Ethereum private keys: `0x` followed by exactly 64 hex chars
- BIP-39 mnemonics: 12 or 24 lowercase English words in sequence

If found: **BLOCK** and state the file + line number. Do not reproduce the key.

### 11. API Keys / Tokens / Secrets — BLOCK severity
Scan for patterns:
- Supabase JWTs: strings starting with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.`
- OpenAI: `sk-[A-Za-z0-9]{20,}`
- Anthropic: `sk-ant-...`
- GitHub tokens: `ghp_`, `ghs_`, `gho_` followed by 36 chars
- Telegram bot tokens: `\d{8,10}:[A-Za-z0-9_-]{35}`
- AWS: `AKIA[A-Z0-9]{16}`
- Stripe: `sk_live_` or `sk_test_`
- Sendgrid: `SG.` prefix
- Slack: `xox[baprs]-`
- Generic 32–64 char hex strings that aren't in test/fixture context

Skip obvious placeholders (`example`, `your_key_here`, `xxx`, `000...`).
If found: **BLOCK** and report file + partial redacted match.

### 12. .env Files — BLOCK if not gitignored
- Does a `.env` file exist on disk?
- Is it listed in `.gitignore`?
- Run `git log --all --full-history -- "*.env"` mentally — warn user to check git history.

### 13. .mcp.json Files
- Does `.claude/mcp.json` exist? Read it.
- Does it contain any API keys, tokens, or secrets as string values?
- Is it gitignored?
- **BLOCK** if secrets found + not gitignored. **WARN** if secrets found but gitignored.

### 14. config.json / config files with secrets
- Check all files matching `config.(js|json|ts|yaml|yml|toml)`.
- Apply the same secret patterns from check 11.
- **BLOCK** if secrets found and file is not gitignored. **WARN** if gitignored.

### 15. Plaintext Passwords — BLOCK severity
Scan for patterns like:
- `password = "..."`, `passwd: "..."`, `pwd = '...'`
- Values that are not empty, not `process.env.*`, not `Deno.env.get(...)`

### 16. RPC URLs with Embedded Keys — BLOCK severity
Scan for Infura/Alchemy/QuickNode URLs containing API keys in the path:
- `https://mainnet.infura.io/v3/YOURKEY`
- `https://eth-mainnet.alchemyapi.io/v2/YOURKEY`

### 17. Wallet Addresses in Non-Test Files — WARN severity
Scan for Ethereum wallet addresses (`0x` + 40 hex chars) in files that are NOT
test/spec files. Note: wallet addresses are less sensitive than private keys,
but hardcoding them can expose user associations.

### 18. console.log Leaking Sensitive Data — WARN severity
Scan all JS/TS files for `console.log(` / `console.info(` lines where the
argument references variables named: `password`, `secret`, `token`, `key`,
`credential`, `private`, `auth`, `session`.

### 19. .gitignore Coverage Gaps — BLOCK/WARN
Check that `.gitignore` covers at minimum:
| Pattern      | Severity if missing |
|---|---|
| `.env`       | BLOCK |
| `config.js`  | BLOCK |
| `*.pem`      | BLOCK |
| `*.key`      | BLOCK |
| `.DS_Store`  | INFO  |
| `node_modules` | INFO |
| `.claude/mcp.json` | WARN |

Also suggest: `*.secret`, `*.secrets`, `secrets.*`, `**/*.pfx`, `**/*.p12`.

### 20. Test Files with Real Credentials — BLOCK severity
Scan all `*.test.js`, `*.spec.ts`, `__tests__/**` files for the same patterns
as check 11. Real credentials in tests often get committed because test files
feel "safe". Flag any that don't look like fixture/mock values.

---

## Output Format

Produce a report in this exact structure:

```
╔════════════════════════════════════════════════════════╗
║        PixelStreak — Security Audit Report             ║
╚════════════════════════════════════════════════════════╝

── APPLICATION SECURITY ──────────────────────────────────
  1.  Row Level Security (RLS) .......... PASS/WARN/FAIL
  2.  Auth Flows ........................ PASS/WARN/FAIL
  3.  Rate Limits ....................... PASS/WARN/FAIL
  4.  Server-Side Validation ............ PASS/WARN/FAIL
  5.  Environment Variables ............. PASS/WARN/FAIL
  6.  CAPTCHA ........................... PASS/WARN/FAIL
  7.  CORS Restrictions ................. PASS/WARN/FAIL
  8.  Error Handling .................... PASS/WARN/FAIL

── SECRETS & CREDENTIAL SCANNING ─────────────────────────
  9.  Full File Audit ................... PASS/WARN
  10. Private Keys / Mnemonics .......... PASS/BLOCK
  11. API Keys / Tokens ................. PASS/BLOCK
  12. .env Files ........................ PASS/WARN/BLOCK
  13. .mcp.json Files ................... PASS/WARN/BLOCK
  14. Config Files with Secrets ......... PASS/WARN/BLOCK
  15. Plaintext Passwords ............... PASS/BLOCK
  16. RPC URLs with Keys ................ PASS/BLOCK
  17. Wallet Addresses .................. PASS/WARN
  18. console.log Data Leaks ............ PASS/WARN
  19. .gitignore Coverage ............... PASS/WARN/BLOCK
  20. Test Files with Credentials ........ PASS/BLOCK

──────────────────────────────────────────────────────────
DETAILS
──────────────────────────────────────────────────────────

[1] RLS — <status>
  ✓ ...
  ✗ ...
  ⚠ ...
  ⛔ ... (BLOCK items)

[2–20] same pattern ...

──────────────────────────────────────────────────────────
SUMMARY
──────────────────────────────────────────────────────────
  BLOCK N   FAIL N   WARN N   PASS N

──────────────────────────────────────────────────────────
RECOMMENDED FIXES (priority order)
──────────────────────────────────────────────────────────
1. [BLOCK]    ...
2. [CRITICAL] ...
3. [HIGH]     ...
4. [MEDIUM]   ...
5. [LOW]      ...
```
