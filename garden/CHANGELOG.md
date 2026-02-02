# Changelog

## Recent Updates

### Features Implemented

#### 1. Optional Password Authentication
- **Password is now optional** - Users can enter a room with just a username
- Users who set a password must use it on subsequent logins
- Users who don't set a password can rejoin without one
- Consistent with When2Meet's authentication model

#### 2. Username Conflict Resolution
- When a username is already taken, the system automatically appends a number
- Example: If "Alice" exists, new user becomes "Alice (1)"
- Similar to file naming on most operating systems
- No more "username taken" errors

#### 3. Enhanced Link Security
- Room IDs upgraded from 8 characters to 16 characters
- Increased from ~4 billion to ~18 quintillion possible combinations
- Makes encrypted links much harder to guess randomly
- Only people with the link can access the room

#### 4. Date Bounds Feature
- Room creators (or any participant) can set event start and end dates
- Visible in top-right corner of the room interface
- Editable by anyone in the room
- Useful for scheduling and planning features (like When2Meet)
- Persists across sessions

### Database Changes

#### Updated Schema
- `rooms.id`: VARCHAR(8) → VARCHAR(16)
- `rooms.date_start`: New BIGINT column (nullable)
- `rooms.date_end`: New BIGINT column (nullable)
- `room_users.password_hash`: Now nullable (VARCHAR(64))
- All foreign keys updated to match new room ID length

### Migration

If you have existing data, run the migration:
```bash
psql $DATABASE_URL -f migrate.sql
```

This will:
- Update column types to support new features
- Make password_hash nullable
- Add date columns to rooms
- Preserve all existing data

### API Changes

#### New Endpoints
- `GET /api/rooms/:roomId/dates` - Get room date bounds
- `POST /api/rooms/:roomId/dates` - Update room date bounds
  - Body: `{ "dateStart": timestamp, "dateEnd": timestamp }`

#### WebSocket Changes
- Password parameter is now optional in connection URL
- Server automatically assigns username variations on conflict
- New message type: `dateUpdate` - broadcasts date changes to all users

### User Experience Improvements

1. **Smoother Onboarding**: Password field clearly marked as optional
2. **No Username Conflicts**: Automatic resolution prevents frustration
3. **Better Security**: Longer room IDs protect against random discovery
4. **Event Planning**: Date bounds support scheduling workflows

### Technical Details

#### Password Handling
- Empty/null passwords stored as NULL in database
- SHA256 hashing only applied to non-empty passwords
- Verification logic checks for NULL passwords correctly

#### Username Generation
- `getAvailableUsername()` finds next available numbered username
- Checks for conflicts before registration
- Format: `{username} ({number})`

#### Date Storage
- Stored as Unix timestamps (milliseconds)
- Nullable fields allow rooms without date requirements
- Broadcasts changes to all connected users in real-time
