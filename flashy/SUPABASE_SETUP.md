# Supabase Setup Guide

This guide will walk you through setting up Supabase for the Flashy project.

## Step 1: Create Supabase Account

1. Go to **https://app.supabase.com**
2. Click **"Start your project"**
3. Sign up with GitHub, Google, or email

## Step 2: Create a New Project

1. After signing in, click **"New Project"**
2. Fill in the details:
   - **Name**: `flashy` (or any name you want)
   - **Database Password**: Create a strong password (save this somewhere safe!)
   - **Region**: Choose the region closest to you (e.g., `US East` for US)
   - **Pricing Plan**: Select **"Free"** (sufficient for development)
3. Click **"Create new project"**
4. Wait 2-3 minutes while Supabase provisions your database

## Step 3: Get Your API Credentials

Once your project is ready:

1. In the left sidebar, go to **Settings** ⚙️
2. Click **API** in the settings menu
3. You'll see two important values:

   - **Project URL** - looks like: `https://xxxxxxxxxxxxx.supabase.co`
   - **anon public key** - a long string starting with `eyJ...`

## Step 4: Add Credentials to Your Project

1. In your Flashy project directory, create a file called `.env.local`
2. Add your credentials (replace with your actual values):

```bash
REACT_APP_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

3. Save the file

⚠️ **Important**: `.env.local` is already in `.gitignore`, so it won't be committed to GitHub (this keeps your credentials private!)

## Step 5: Verify Setup

Run your app to verify the connection:

```bash
npm start
```

The app should start without errors. If you see an error about missing environment variables, double-check your `.env.local` file.

## What You Just Created

- **Database**: A PostgreSQL database hosted on Supabase (currently empty)
- **Auth Service**: Authentication system (signup/login) ready to use
- **API Endpoints**: Automatic REST API for your database
- **Real-time**: WebSocket connections for live updates

## Next Steps

After setting up Supabase, we'll:
1. Create database tables (documents, users, flashcards)
2. Set up Row Level Security (RLS) for permissions
3. Enable real-time subscriptions for collaboration

## Troubleshooting

### "Cannot find module '@supabase/supabase-js'"
- Run `npm install` to ensure all dependencies are installed

### "Missing Supabase environment variables"
- Make sure `.env.local` exists in the project root (same folder as `package.json`)
- Verify the variable names are exactly: `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY`
- Restart the dev server after creating `.env.local`

### Can't access Supabase dashboard
- Check your internet connection
- Try clearing browser cache
- Try a different browser

## Useful Supabase Features

Once you're comfortable, explore these in the dashboard:

- **Table Editor**: View and edit database tables visually
- **SQL Editor**: Run SQL queries directly
- **Authentication**: View users who signed up
- **Storage**: Upload files (not used in Phase 1)
- **Database Logs**: See all database queries

## Security Note

Your "anon public key" is safe to expose in client-side code. Security is enforced by:
1. **Row Level Security (RLS)** policies in the database
2. **API rate limiting** by Supabase
3. Users can only access data they're allowed to see

We'll set up RLS policies in Phase 2!
