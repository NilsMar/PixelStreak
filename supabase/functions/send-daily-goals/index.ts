import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  // Require secret to prevent unauthorized calls
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data: accounts } = await supabase
    .from('telegram_accounts')
    .select('user_id, chat_id');

  if (!accounts?.length) return new Response('No linked accounts');

  let sent = 0;

  for (const account of accounts) {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, name, days')
      .eq('user_id', account.user_id);

    if (!goals?.length) continue;

    for (const goal of goals) {
      // Skip if already marked today
      if (goal.days?.[today]) continue;

      await fetch(`${API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: account.chat_id,
          text: `Did you complete today's goal?\n\n*${goal.name}*`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Done', callback_data: `completed:${goal.id}:${today}` },
              { text: '❌ Missed', callback_data: `missed:${goal.id}:${today}` },
            ]],
          },
        }),
      });

      sent++;
    }
  }

  return new Response(`Sent ${sent} goal reminders`);
});
