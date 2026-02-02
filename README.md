# PixelStreak

A beautiful goal tracking application with GitHub-style contribution graphs. Track your daily habits and build streaks with visual feedback.

## Features

- GitHub-style contribution grid visualization
- Track multiple goals simultaneously
- View completed, missed, and current streak stats
- Dark/light theme support
- Multi-year view (2026+)
- Inline goal editing
- User authentication with Supabase
- Cloud-synced data across devices

## Setup Instructions

### 1. Supabase Project Setup

1. Go to https://supabase.com/dashboard
2. Create a new project
   - Choose a project name (e.g., "pixelstreak")
   - Set a database password
   - Select your region
3. Wait for the project to be provisioned

### 2. Database Schema

1. In your Supabase dashboard, go to the SQL Editor
2. Create a new query and paste the following:

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

3. Run the query

### 3. Enable Email Authentication

1. Go to Authentication > Providers in your Supabase dashboard
2. Enable the "Email" provider
3. (Optional) Disable "Confirm email" for easier testing
   - You can enable this later for production

### 4. Configure Your App

1. In your Supabase dashboard, go to Settings > API
2. Copy your:
   - Project URL
   - Anon/Public key
3. Open `config.js` in your project
4. Replace the placeholder values:

```javascript
export const SUPABASE_URL = 'your-project-url-here';
export const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 5. Run the Application

You need to serve the application from a local web server (not file://) for ES modules to work.

**Option 1: Using Python**
```bash
python3 -m http.server 8000
```
Then visit: http://localhost:8000

**Option 2: Using Node.js (npx)**
```bash
npx http-server -p 8000
```
Then visit: http://localhost:8000

**Option 3: Using VS Code Live Server**
- Install the "Live Server" extension
- Right-click on `index.html` and select "Open with Live Server"

### 6. Create an Account

1. Navigate to the application
2. Click "Sign up" on the login page
3. Enter your email and password (min 6 characters)
4. Sign in with your new credentials
5. Start tracking your goals!

## File Structure

```
PixelStreak/
├── index.html          # Login/signup page
├── app.html            # Main application
├── config.js           # Supabase credentials (gitignored)
├── config.example.js   # Template for config
├── css/
│   └── styles.css      # All application styles
├── js/
│   ├── auth.js         # Authentication logic
│   └── app.js          # Main application logic
└── README.md           # This file
```

## Usage

### Adding Goals
1. Enter a goal name in the input field
2. Click "Add Goal"
3. Your goal appears with a contribution grid

### Tracking Progress
- Click empty cells to mark as "completed" (teal)
- Click again to mark as "missed" (red)
- Click once more to clear the status
- Future dates cannot be modified

### Editing Goals
- Click on any goal name to edit it inline
- Press Enter to save or Escape to cancel

### Year Switching
- Use the year selector to view different years
- Switch between current year and next year

### Theme
- Toggle between light and dark mode using the sun/moon switch

### Logout
- Click the "Logout" button to sign out

## Security

- All data is protected by Row Level Security (RLS)
- Users can only access their own goals
- Passwords are hashed by Supabase
- API keys are kept in gitignored config file

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Hosting**: Static files (can be deployed anywhere)

## Notes

- The application requires an active internet connection
- Supabase free tier includes:
  - 500MB database storage
  - 50MB file storage
  - Unlimited API requests
  - 50,000 monthly active users

## Troubleshooting

**"Failed to load goals" error:**
- Check that your Supabase credentials are correct in `config.js`
- Verify the database schema was created successfully
- Check browser console for specific error messages

**Can't sign up/login:**
- Verify Email provider is enabled in Supabase
- Check that password is at least 6 characters
- Look for error messages in the UI

**Module import errors:**
- Make sure you're running from a web server, not opening file://
- Check that all file paths are correct

## License

MIT
