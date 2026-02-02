# Flashy

A collaborative document editor with automatic flashcard generation. Write headers and content, and they automatically become flashcards for studying.

## Tech Stack

- **Frontend:** React + TypeScript (Create React App)
- **Rich Text Editor:** Lexical (by Meta)
- **Backend:** Supabase (PostgreSQL, Realtime, Auth)
- **Collaboration:** Yjs (CRDT)
- **Deployment:** Render.com

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Supabase Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Create a new project
3. Wait for the project to finish setting up

### 3. Get Supabase Credentials

1. In your Supabase project, go to **Settings** → **API**
2. Copy your **Project URL** and **anon/public key**

### 4. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
REACT_APP_SUPABASE_URL=your_supabase_project_url
REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Replace `your_supabase_project_url` and `your_supabase_anon_key` with your actual credentials.

### 5. Run Development Server

```bash
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000)

## Current Status

### ✅ Phase 1: Foundation (COMPLETED)
- Project setup with Create React App
- Authentication system (signup, login, protected routes)
- Basic routing (home page, editor page, auth pages)
- Supabase client configuration

### 🚧 Next Steps

**Phase 2: Database Setup**
- Create database migrations for documents, collaborators, and flashcards
- Implement document CRUD operations
- Build document list UI

**Phase 3: Lexical Editor**
- Integrate Lexical rich text editor
- Build formatting toolbar
- Implement local auto-save

**Phase 4: Real-time Collaboration**
- Integrate Yjs for conflict-free collaboration
- Setup Supabase Realtime sync
- Add presence indicators

**Phase 5: Flashcard Extraction**
- Build algorithm to extract flashcards from headers
- Auto-generate flashcards as user types
- Store flashcards in database

**Phase 6: Flashcard UI**
- Build flashcard sidebar panel
- Create study mode interface
- Add export functionality

**Phase 7: Polish**
- Sharing and permissions
- UX improvements
- Error handling

**Phase 8: Deployment**
- Deploy to Render.com
- Setup production database
- CI/CD pipeline

## Project Structure

```
flashy/
├── src/
│   ├── config/
│   │   └── supabase.ts          # Supabase client setup
│   ├── hooks/
│   │   └── useAuth.ts           # Authentication hook
│   ├── components/
│   │   └── auth/
│   │       └── ProtectedRoute.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── SignUpPage.tsx
│   │   ├── HomePage.tsx
│   │   └── EditorPage.tsx
│   └── App.tsx                  # Main app with routing
├── .env.local                   # Environment variables (not in git)
└── .env.example                 # Environment variables template
```

## Available Scripts

- `npm start` - Run development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App (not recommended)

## Features (Planned)

- 📝 Collaborative rich text editing
- 🎯 Automatic flashcard generation from headers
- 👥 Real-time multi-user collaboration
- 💾 Auto-save and version history
- 🎨 Basic formatting (bold, italic, headers, bullets)
- 🔒 Authentication and permissions
- 📱 Responsive design
- 📤 Export flashcards and documents

## License

MIT
