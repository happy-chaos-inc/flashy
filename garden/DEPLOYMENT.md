# Garden Deployment Guide

This guide will help you deploy your Garden collaborative drawing board to production.

## Prerequisites

- Git repository with your code
- GitHub/GitLab account
- Render account (or your chosen hosting platform)

## Option 1: Deploy to Render (Recommended)

### Step 1: Push to Git Repository

```bash
cd garden
git init
git add .
git commit -m "Initial commit with PostgreSQL support"
git branch -M main
git remote add origin <your-git-url>
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to https://render.com and sign up/login
2. Click "New +" and select "Blueprint"
3. Connect your GitHub/GitLab repository
4. Render will automatically detect the `render.yaml` file
5. Click "Apply" to create both the web service and PostgreSQL database
6. Wait for deployment to complete

Your app will be live at: `https://garden-XXXX.onrender.com`

**Cost**: ~$14/month ($7 web service + $7 PostgreSQL)

## Option 2: Deploy to Railway

### Step 1: Push to Git Repository (same as above)

### Step 2: Deploy on Railway

1. Go to https://railway.app and sign up/login
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add PostgreSQL database:
   - Click "New" → "Database" → "Add PostgreSQL"
5. Add environment variable:
   - Go to your web service settings
   - Add variable: `DATABASE_URL` (Railway will auto-populate this if you link the database)
6. Deploy

**Cost**: ~$10-20/month (usage-based)

## Option 3: DigitalOcean App Platform

### Step 1: Push to Git Repository (same as above)

### Step 2: Deploy on DigitalOcean

1. Go to https://cloud.digitalocean.com/apps
2. Click "Create App" → Choose GitHub
3. Select your repository
4. Configure:
   - **Name**: garden
   - **Build Command**: `npm install`
   - **Run Command**: `npm start`
5. Add Database:
   - Click "Add Resource" → "Database" → "PostgreSQL"
6. Deploy

**Cost**: ~$20/month ($5 app + $15 managed DB)

## Local Development with PostgreSQL

If you want to test locally with PostgreSQL:

1. Install PostgreSQL locally:
   ```bash
   # macOS
   brew install postgresql@16
   brew services start postgresql@16

   # Ubuntu/Debian
   sudo apt-get install postgresql
   sudo service postgresql start
   ```

2. Create database:
   ```bash
   createdb garden
   ```

3. Set environment variable:
   ```bash
   export DATABASE_URL="postgresql://localhost:5432/garden"
   ```

4. Run the server:
   ```bash
   npm start
   ```

The schema will be automatically initialized on first run.

## Environment Variables

Your hosting platform should set these automatically:

- `DATABASE_URL` - PostgreSQL connection string (provided by hosting platform)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Set to `production` in production

## Verifying Deployment

After deployment:

1. Visit your app URL
2. Create a new room
3. Add some drawings
4. Refresh the page - your drawings should persist
5. Check logs for any errors

## Troubleshooting

### "Cannot connect to database"
- Verify DATABASE_URL is set correctly
- Check database is running and accessible
- For Render: ensure database and web service are linked

### "Schema errors"
- The schema should auto-initialize
- If needed, run schema.sql manually in your database console

### "WebSocket connection failed"
- Ensure your hosting platform supports WebSockets
- Render, Railway, and DigitalOcean all support WebSockets

## Migration from File Storage

Your existing data is in the `./data` directory. The new PostgreSQL version starts fresh. If you need to migrate existing data, you would need to write a migration script (not covered in this guide).

## Monitoring

- Check your hosting platform's logs for errors
- Monitor database size and performance
- Set up uptime monitoring (e.g., UptimeRobot)

## Backup

All hosting platforms provide automatic database backups:
- **Render**: Daily backups included
- **Railway**: Point-in-time recovery
- **DigitalOcean**: Daily backups included

## Custom Domain (Optional)

All platforms support custom domains:
1. Go to your app settings
2. Add custom domain
3. Update your DNS records as instructed
4. SSL certificate is automatically provisioned
