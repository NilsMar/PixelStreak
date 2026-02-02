-- PixelStreak Database Setup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard > SQL Editor)

-- Create goals table
CREATE TABLE IF NOT EXISTS goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  days JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (in case you're re-running this)
DROP POLICY IF EXISTS "Users can view own goals" ON goals;
DROP POLICY IF EXISTS "Users can insert own goals" ON goals;
DROP POLICY IF EXISTS "Users can update own goals" ON goals;
DROP POLICY IF EXISTS "Users can delete own goals" ON goals;

-- Create policies: Users can only access their own goals
CREATE POLICY "Users can view own goals"
  ON goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goals"
  ON goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goals"
  ON goals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own goals"
  ON goals FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS goals_user_id_idx ON goals(user_id);

-- Verify setup
SELECT 'Database setup complete!' as status;
