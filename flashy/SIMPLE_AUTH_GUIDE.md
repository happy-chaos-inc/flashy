# Simplified Authentication Guide

## How It Works

Instead of individual user accounts, Flashy now uses **one shared password** for your study group.

### For Development (Your Computer)

1. Create `.env.local` file:
```bash
REACT_APP_SUPABASE_URL=your_supabase_url_here
REACT_APP_SUPABASE_ANON_KEY=your_supabase_key_here
REACT_APP_SHARED_PASSWORD=your_password_here
```

2. Change `your_password_here` to whatever you want (e.g., `studygroup2024`)

3. If you don't set `REACT_APP_SHARED_PASSWORD`, the default password is `flashy123`

### For Production (Render.com)

When you deploy to Render.com:

1. **DO NOT** put the password in your GitHub repo
2. Set it as an environment variable in Render's dashboard:
   - Go to your Render.com service
   - Click "Environment"
   - Add: `REACT_APP_SHARED_PASSWORD` = `your_actual_password`

This keeps your password secret!

## Sharing with Your Study Group

1. Deploy your app to Render.com (we'll do this later)
2. Share the URL with your 4 people (e.g., `https://flashy.onrender.com`)
3. Share the password separately (text message, Discord, etc.)
4. Everyone enters the same password to access the shared documents

## Security Notes

- The password is stored in sessionStorage (stays logged in until browser is closed)
- Click "Lock" button to log out
- This is basic security - fine for a study group, not for sensitive data
- Don't share the password publicly!

## Changing the Password

### Development:
Just edit `.env.local` and restart the dev server

### Production (Render.com):
1. Go to Render.com dashboard
2. Update the `REACT_APP_SHARED_PASSWORD` environment variable
3. Render will automatically redeploy with the new password

## What Changed from Original Plan

**Before:** Individual user accounts with signup/login (too complex for 4 people)

**Now:** Single shared password (perfect for a small study group)

**Still have:**
- Real-time collaboration (all 4 people can edit together)
- Supabase database (stores documents and flashcards)
- All the flashcard features

**Don't have anymore:**
- User signup page
- Individual user accounts
- Per-user permissions
