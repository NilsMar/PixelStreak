# PixelStreak Setup Guide

## What Was Implemented

### File Structure
```
PixelStreak/
├── index.html              # NEW - Login/signup page
├── app.html                # NEW - Main app (replaces goals.html)
├── goals.html              # KEEP - Original file (for reference)
├── config.js               # NEW - Your Supabase credentials
├── config.example.js       # NEW - Template for others
├── .gitignore              # UPDATED - Now ignores config.js
├── css/
│   └── styles.css          # NEW - Extracted all styles
├── js/
│   ├── auth.js             # NEW - Authentication logic
│   └── app.js              # NEW - App logic with Supabase integration
└── README.md               # NEW - Complete documentation
```

### Features Implemented
- ✅ Email/password authentication with Supabase
- ✅ User signup and login pages
- ✅ Database storage (replaces localStorage)
- ✅ Row Level Security - users only see their own goals
- ✅ Logout functionality
- ✅ All existing features preserved (themes, year switching, inline editing)
- ✅ Organized code structure (separate CSS/JS files)
- ✅ Security (config.js is gitignored)

## Your Next Steps

### 1. Create Supabase Project (5 minutes)

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Fill in:
   - Name: `pixelstreak` (or your choice)
   - Database Password: (create a strong password)
   - Region: (choose closest to you)
4. Click "Create new project"
5. Wait 2-3 minutes for provisioning

### 2. Set Up Database (2 minutes)

1. In Supabase dashboard, click "SQL Editor" in left sidebar
2. Click "New Query"
3. Copy and paste this SQL:

```sql
-- Goals table
CREATE TABLE goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  days JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own goals
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

-- Index for faster queries
CREATE INDEX goals_user_id_idx ON goals(user_id);
```

4. Click "Run" (or press Cmd+Enter)
5. You should see "Success. No rows returned"

### 3. Enable Email Authentication (1 minute)

1. In Supabase dashboard, click "Authentication" in left sidebar
2. Click "Providers" tab
3. Find "Email" in the list
4. Make sure it's enabled (toggle should be green)
5. **For testing:** Disable "Confirm email" (you can enable later)
6. Click "Save"

### 4. Get Your API Credentials (1 minute)

1. In Supabase dashboard, click "Settings" (gear icon in left sidebar)
2. Click "API" in the settings menu
3. You'll see two important values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)
4. Keep this page open for the next step

### 5. Configure Your App (1 minute)

1. Open `config.js` in your code editor
2. Replace the placeholder values:

```javascript
export const SUPABASE_URL = 'https://your-project.supabase.co';  // ← Paste your Project URL
export const SUPABASE_ANON_KEY = 'eyJhbGc...';  // ← Paste your anon public key
```

3. Save the file

### 6. Run the App (1 minute)

You need a local web server. Choose one method:

**Method A: Python (if you have Python installed)**
```bash
cd /Users/nils/Documents/repos/PixelStreak
python3 -m http.server 8000
```

**Method B: Node.js**
```bash
cd /Users/nils/Documents/repos/PixelStreak
npx http-server -p 8000
```

**Method C: VS Code**
- Install "Live Server" extension
- Right-click `index.html` → "Open with Live Server"

### 7. Test It Out (2 minutes)

1. Open http://localhost:8000 in your browser
2. You should see the login page
3. Click "Sign up"
4. Enter an email and password (min 6 characters)
5. Click "Sign Up"
6. You should see "Account created! Please sign in."
7. Sign in with your credentials
8. You should be redirected to the app
9. Add a goal and test tracking!

## Verification Checklist

- [ ] Supabase project created
- [ ] Database schema created successfully
- [ ] Email auth enabled in Supabase
- [ ] API credentials copied to config.js
- [ ] App running on local web server
- [ ] Can sign up new account
- [ ] Can sign in
- [ ] Can add goals
- [ ] Goals persist after refresh
- [ ] Can logout and login again
- [ ] Theme toggle works
- [ ] Year switching works

## What to Commit

After testing, you can commit everything except `config.js`:

```bash
git add .
git commit -m "Add Supabase authentication and cloud storage

- Implement email/password authentication
- Migrate from localStorage to Supabase database
- Add user signup and login pages
- Organize code into separate CSS/JS files
- Add Row Level Security for data protection
- Update documentation with setup guide"
```

**Note:** `config.js` is automatically ignored by git, so your credentials won't be committed.

## Security Notes

- ✅ `config.js` is gitignored - your credentials won't be committed
- ✅ Row Level Security ensures users only access their own data
- ✅ Passwords are hashed by Supabase (never stored in plain text)
- ✅ Using anon key (not service_role key) for client-side safety

## Troubleshooting

**"Module not found" errors:**
- Make sure you're using a web server, not opening file:// directly
- Check that the server is serving from the project root

**"Invalid API key" errors:**
- Verify you copied the full anon key from Supabase
- Check for extra spaces or missing characters
- Make sure you're using the anon key, not the service_role key

**Can't sign up:**
- Check that Email provider is enabled in Supabase
- Look at browser console (F12) for specific errors
- Verify database schema was created successfully

**Goals won't load:**
- Check browser console for errors
- Verify you're signed in
- Check Supabase table in dashboard to see if data is there

## Next Steps (Optional Enhancements)

Once basic functionality is working, you could add:

- Password reset functionality
- Email confirmation for new accounts
- Profile page with user settings
- Export/import goals
- Social sharing of streaks
- Mobile app (React Native)
- GitHub-style heatmap animations

## Support

If you run into issues:
1. Check browser console (F12) for error messages
2. Check Supabase logs in dashboard
3. Verify all setup steps were completed
4. Try the troubleshooting section above

Good luck! 🚀
