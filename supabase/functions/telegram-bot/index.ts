import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_TOKEN    = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const TRMNL_WEBHOOK_URL = Deno.env.get('TRMNL_WEBHOOK_URL');
const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sendMessage(chat_id: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text }),
  });
}

async function answerCallback(callback_query_id: string, text: string) {
  await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id, text }),
  });
}

async function removeInlineKeyboard(chat_id: number, message_id: number) {
  await fetch(`${API}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, reply_markup: { inline_keyboard: [] } }),
  });
}

// ── TRMNL helpers (ported from trmnl/send.js) ────────────────────────────────

const WEEKS_TO_SHOW = 8;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calculateStreak(days: Record<string, string>, today: Date): number {
  let streak = 0;
  const cur = new Date(today);
  while (days[dateKey(cur)] === 'completed') {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function buildGrid(days: Record<string, string>, today: Date): string[][] {
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (WEEKS_TO_SHOW - 1) * 7);

  const rows: string[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: string[] = [];
    for (let w = 0; w < WEEKS_TO_SHOW; w++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);

      const key = dateKey(date);
      const isToday = dateKey(date) === dateKey(today);
      const isFuture = date > today;
      const status = days[key];

      if (isFuture) row.push('.');
      else if (isToday && status === 'completed') row.push('tc');
      else if (isToday) row.push('t');
      else if (status === 'completed') row.push('c');
      else if (status === 'missed') row.push('m');
      else row.push('.');
    }
    rows.push(row);
  }
  return rows;
}

function processGoal(goal: { name: string; days: Record<string, string> | null }, today: Date) {
  const days = goal.days || {};
  const completed = Object.values(days).filter(v => v === 'completed').length;
  const missed    = Object.values(days).filter(v => v === 'missed').length;
  const total     = completed + missed;
  const rate      = total > 0 ? `${Math.round(completed / total * 100)}%` : '—';
  const streak    = calculateStreak(days, today);
  const grid      = buildGrid(days, today);
  return { name: goal.name, streak, completed, total, rate, grid };
}

async function pushToTrmnl(userId: string) {
  if (!TRMNL_WEBHOOK_URL) return;

  const { data: goals } = await supabase
    .from('goals')
    .select('name, days')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (!goals?.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const processedGoals = goals.map(g => processGoal(g, today));
  const updated = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  await fetch(TRMNL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_variables: { goals: processedGoals, updated } }),
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK');

  const update = await req.json();

  // Handle /start TOKEN — link Telegram account to Supabase user
  if (update.message?.text?.startsWith('/start')) {
    const parts = update.message.text.split(' ');
    const token = parts[1]?.trim();
    const chat_id = update.message.chat.id;

    if (!token) {
      await sendMessage(chat_id, 'Open PixelStreak and tap "Connect Telegram" to get a link.');
      return new Response('OK');
    }

    // Look up the token (expires after 10 minutes)
    const { data: linkToken } = await supabase
      .from('telegram_link_tokens')
      .select('user_id, created_at')
      .eq('token', token)
      .single();

    if (!linkToken) {
      await sendMessage(chat_id, 'This link has expired or is invalid. Please generate a new one from the app.');
      return new Response('OK');
    }

    // Check token age (10 minute expiry)
    const age = Date.now() - new Date(linkToken.created_at).getTime();
    if (age > 10 * 60 * 1000) {
      await supabase.from('telegram_link_tokens').delete().eq('token', token);
      await sendMessage(chat_id, 'This link has expired. Please generate a new one from the app.');
      return new Response('OK');
    }

    // Link the account
    await supabase.from('telegram_accounts').upsert({ user_id: linkToken.user_id, chat_id });
    await supabase.from('telegram_link_tokens').delete().eq('token', token);

    await sendMessage(chat_id, "✅ Connected! I'll send you your goals each evening so you can mark them done.");
    return new Response('OK');
  }

  // Handle inline keyboard button presses (mark goal done/missed)
  if (update.callback_query) {
    const { id, data, message, from } = update.callback_query;

    // callback data format: "completed:GOAL_ID:DATE" or "missed:GOAL_ID:DATE"
    const [action, goal_id, date] = data.split(':');

    const { data: account } = await supabase
      .from('telegram_accounts')
      .select('user_id')
      .eq('chat_id', from.id)
      .single();

    if (!account) {
      await answerCallback(id, 'Account not linked. Please reconnect from the app.');
      return new Response('OK');
    }

    const { data: goal } = await supabase
      .from('goals')
      .select('days')
      .eq('id', goal_id)
      .eq('user_id', account.user_id)
      .single();

    if (!goal) {
      await answerCallback(id, 'Goal not found.');
      return new Response('OK');
    }

    const days = { ...(goal.days || {}), [date]: action };
    await supabase
      .from('goals')
      .update({ days, updated_at: new Date().toISOString() })
      .eq('id', goal_id);

    const feedback = action === 'completed' ? '✅ Marked as done!' : '❌ Marked as missed';
    await answerCallback(id, feedback);
    await removeInlineKeyboard(from.id, message.message_id);

    // Push updated goals to TRMNL display immediately (best-effort, must not fail the response)
    pushToTrmnl(account.user_id).catch(() => {});

    return new Response('OK');
  }

  return new Response('OK');
});
