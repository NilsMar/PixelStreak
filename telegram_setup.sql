-- Telegram Integration Setup
-- Run this in your Supabase SQL Editor after setup_database.sql

-- Stores linked Telegram accounts (user_id <-> chat_id)
CREATE TABLE IF NOT EXISTS telegram_accounts (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE telegram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own telegram account"
  ON telegram_accounts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own telegram account"
  ON telegram_accounts FOR DELETE USING (auth.uid() = user_id);

-- Short-lived tokens used to link a Telegram account to a Supabase user
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own link tokens"
  ON telegram_link_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own link tokens"
  ON telegram_link_tokens FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own link tokens"
  ON telegram_link_tokens FOR DELETE USING (auth.uid() = user_id);

SELECT 'Telegram tables created!' AS status;
