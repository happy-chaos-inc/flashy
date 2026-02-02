# Get2Work Demo

A collaborative TODO checklist application with real-time updates.

## Features

- **Create Checklists**: Start with a simple creation page where you add TODO items
- **Share Links**: Get a unique link to share with collaborators
- **Real-time Collaboration**: Multiple users can work on the same checklist simultaneously
- **User Colors**: Each signed-in user gets a unique color for their checks
- **Multiple Checks**: Multiple users can check the same item, showing all their colors
- **View-Only Mode**: Anyone with the link can view without signing in
- **User Authentication**: Optional password-protected accounts per room

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database and set the DATABASE_URL environment variable:
```bash
export DATABASE_URL="postgresql://username:password@localhost/get2work"
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

## How It Works

### Creation Flow
1. Go to the home page
2. Add TODO items (minimum 1 required)
3. Click "Create Link" to generate a shareable room
4. Share the link with collaborators

### User Flow
1. Anyone with the link can view the TODO list
2. Click "Sign In to Edit" or use the modal to authenticate
3. Once signed in:
   - Check/uncheck items (your color shows on checks)
   - Add new TODO items
   - Edit or delete existing items
4. All changes sync in real-time to all connected users

## Tech Stack

- **Backend**: Node.js with WebSocket support
- **Database**: PostgreSQL
- **Frontend**: Vanilla JavaScript with monospace font styling
- **Real-time**: WebSocket for live collaboration

## Architecture

- `server.js` - WebSocket server and HTTP routes
- `schema.sql` - Database schema
- `public/home.html` - Checklist creation page
- `public/index.html` - Collaborative checklist view
