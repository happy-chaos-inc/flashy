const { WebSocketServer } = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const url = require('url')
const { Pool } = require('pg')

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

// --- Room Management ---
const rooms = new Map() // roomId -> Room instance

class Room {
  constructor(id, name = null) {
    this.id = id
    this.name = name || this.generateRoomName()
    this.sketches = new Map()
    this.users = new Map() // username -> { username, ws, color, joinedAt }
    this.userPasswords = new Map() // username -> hashed password
    this.createdAt = Date.now()
    this.lastActivityAt = Date.now()
    this.maxUsers = 8
    this.colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de', '#ff2d55']
    this.usedColors = new Set()
  }

  generateRoomName() {
    const adjectives = ['Cozy', 'Sunny', 'Cool', 'Happy', 'Bright', 'Warm', 'Fresh', 'Sweet']
    const colors = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Pink', 'Yellow', 'Teal']
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const color = colors[Math.floor(Math.random() * colors.length)]
    return `${adj} ${color} Fridge`
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex')
  }

  hasUser(username) {
    return this.userPasswords.has(username)
  }

  verifyUserPassword(username, password) {
    if (!this.userPasswords.has(username)) {
      return false
    }
    return this.hashPassword(password) === this.userPasswords.get(username)
  }

  registerUser(username, password) {
    if (this.userPasswords.has(username)) {
      return { success: false, error: 'Username already registered' }
    }
    this.userPasswords.set(username, this.hashPassword(password))
    return { success: true }
  }

  assignColor() {
    const available = this.colors.filter(c => !this.usedColors.has(c))
    if (available.length === 0) {
      // If all colors used, reuse random color
      return this.colors[Math.floor(Math.random() * this.colors.length)]
    }
    const color = available[Math.floor(Math.random() * available.length)]
    this.usedColors.add(color)
    return color
  }

  freeColor(color) {
    this.usedColors.delete(color)
  }

  addUser(username, ws) {
    if (this.users.has(username)) {
      return { success: false, error: 'Username is currently online in this room' }
    }
    if (this.users.size >= this.maxUsers) {
      return { success: false, error: 'Room is full (8/8 users)' }
    }

    const color = this.assignColor()
    this.users.set(username, {
      username,
      ws,
      color,
      joinedAt: Date.now()
    })

    return { success: true, color }
  }

  removeUser(username) {
    const user = this.users.get(username)
    if (user) {
      this.freeColor(user.color)
      this.users.delete(username)
    }
  }

  getUserByWs(ws) {
    for (const user of this.users.values()) {
      if (user.ws === ws) return user
    }
    return null
  }

  broadcast(message, exclude = null) {
    const data = JSON.stringify(message)
    for (const user of this.users.values()) {
      if (user.ws !== exclude && user.ws.readyState === 1) {
        user.ws.send(data)
      }
    }
  }

  updateActivity() {
    this.lastActivityAt = Date.now()
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      userCount: this.users.size,
      maxUsers: this.maxUsers,
      createdAt: this.createdAt
    }
  }
}

// --- Database Initialization ---
async function initializeDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql')
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8')
    await pool.query(schema)
    console.log('Database schema initialized')
  }
}

// --- Persistence ---
async function saveRoom(room) {
  await pool.query(
    `INSERT INTO rooms (id, name, created_at, last_activity_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
     SET last_activity_at = $4`,
    [room.id, room.name, room.createdAt, room.lastActivityAt]
  )
}

async function saveRoomUser(roomId, username, passwordHash) {
  await pool.query(
    `INSERT INTO room_users (room_id, username, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, username) DO NOTHING`,
    [roomId, username, passwordHash]
  )
}

async function restoreRooms() {
  try {
    const roomsResult = await pool.query('SELECT * FROM rooms')

    for (const roomData of roomsResult.rows) {
      const room = new Room(roomData.id, roomData.name)
      room.createdAt = parseInt(roomData.created_at)
      room.lastActivityAt = parseInt(roomData.last_activity_at)

      // Restore user passwords
      const usersResult = await pool.query(
        'SELECT username, password_hash FROM room_users WHERE room_id = $1',
        [room.id]
      )
      for (const userData of usersResult.rows) {
        room.userPasswords.set(userData.username, userData.password_hash)
      }

      // Restore sketches
      const sketchesResult = await pool.query(
        'SELECT * FROM sketches WHERE room_id = $1',
        [room.id]
      )
      for (const sketchData of sketchesResult.rows) {
        const sketch = {
          id: sketchData.id,
          type: sketchData.type,
          svgPath: sketchData.svg_path,
          position: {
            x: parseFloat(sketchData.position_x),
            y: parseFloat(sketchData.position_y)
          }
        }
        room.sketches.set(sketch.id, sketch)
      }

      rooms.set(room.id, room)
      console.log(`Restored room ${room.id} with ${room.sketches.size} sketches`)
    }
  } catch (error) {
    console.error('Error restoring rooms:', error)
  }
}

async function applyCommandToRoom(room, command, shouldPersist = true) {
  switch (command.op) {
    case 'create':
      room.sketches.set(command.sketch.id, command.sketch)
      if (shouldPersist) {
        await pool.query(
          `INSERT INTO sketches (id, room_id, type, svg_path, position_x, position_y, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            command.sketch.id,
            room.id,
            command.sketch.type,
            command.sketch.svgPath,
            command.sketch.position.x,
            command.sketch.position.y,
            Date.now()
          ]
        )
      }
      break
    case 'move':
      const sketch = room.sketches.get(command.id)
      if (sketch) {
        sketch.position = command.position
        if (shouldPersist) {
          await pool.query(
            `UPDATE sketches SET position_x = $1, position_y = $2 WHERE id = $3`,
            [command.position.x, command.position.y, command.id]
          )
        }
      }
      break
    case 'delete':
      room.sketches.delete(command.id)
      if (shouldPersist) {
        await pool.query('DELETE FROM sketches WHERE id = $1', [command.id])
      }
      break
  }
  room.updateActivity()
  if (shouldPersist) {
    await saveRoom(room)
  }
}

function generateRoomId() {
  return crypto.randomBytes(4).toString('hex')
}

// --- Idle Cleanup ---
async function cleanupIdleRooms() {
  const now = Date.now()
  const IDLE_THRESHOLD = 30 * 24 * 60 * 60 * 1000 // 30 days

  for (const [roomId, room] of rooms.entries()) {
    if (room.users.size === 0 && now - room.lastActivityAt > IDLE_THRESHOLD) {
      rooms.delete(roomId)
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId])
      console.log(`Deleted idle room: ${roomId}`)
    }
  }
}

// Run cleanup daily
setInterval(cleanupIdleRooms, 24 * 60 * 60 * 1000)

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // API: Create room
  if (pathname === '/api/rooms' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}')
        const roomId = generateRoomId()
        const room = new Room(roomId, name)
        rooms.set(roomId, room)
        await saveRoom(room)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          room: room.toJSON(),
          url: `/r/${roomId}`
        }))
      } catch (error) {
        console.error('Error creating room:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to create room' }))
      }
    })
    return
  }

  // API: Get room info
  if (pathname.startsWith('/api/rooms/') && pathname.endsWith('/check-user') && req.method === 'GET') {
    const pathSegments = pathname.split('/')
    const roomId = pathSegments[3]
    const username = new URLSearchParams(parsedUrl.query).get('username')

    const room = rooms.get(roomId)
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Room not found' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      exists: room.hasUser(username),
      isOnline: room.users.has(username)
    }))
    return
  }

  if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
    const roomId = pathname.split('/')[3]
    const room = rooms.get(roomId)

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Room not found' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(room.toJSON()))
    return
  }

  // Serve favicon
  if (pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  // Serve static files
  let filePath
  if (pathname === '/') {
    filePath = path.join(__dirname, 'public', 'home.html')
  } else if (pathname.startsWith('/r/')) {
    filePath = path.join(__dirname, 'public', 'index.html')
  } else {
    filePath = path.join(__dirname, 'public', pathname)
  }

  const ext = path.extname(filePath)
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' })
    res.end(data)
  })
})

// --- WebSocket Server ---
const wss = new WebSocketServer({ server })

wss.on('connection', async (ws, req) => {
  const params = new URLSearchParams(url.parse(req.url).query)
  const roomId = params.get('room')
  const username = params.get('username')
  const password = params.get('password')
  const isNewUser = params.get('isNewUser') === 'true'

  if (!roomId || !username) {
    ws.send(JSON.stringify({ type: 'error', error: 'Missing room or username' }))
    ws.close()
    return
  }

  if (!password) {
    ws.send(JSON.stringify({ type: 'error', error: 'Password is required' }))
    ws.close()
    return
  }

  const room = rooms.get(roomId)
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }))
    ws.close()
    return
  }

  // Check if username is registered
  const userExists = room.hasUser(username)

  if (isNewUser) {
    // User is trying to register a new username
    if (userExists) {
      ws.send(JSON.stringify({ type: 'error', error: 'Username already taken. Please login instead.' }))
      ws.close()
      return
    }

    // Register the new user
    const registerResult = room.registerUser(username, password)
    if (!registerResult.success) {
      ws.send(JSON.stringify({ type: 'error', error: registerResult.error }))
      ws.close()
      return
    }
    await saveRoomUser(roomId, username, room.userPasswords.get(username))
  } else {
    // User is trying to login
    if (!userExists) {
      ws.send(JSON.stringify({ type: 'error', error: 'Username not found. Please create an account first.' }))
      ws.close()
      return
    }

    // Verify password
    if (!room.verifyUserPassword(username, password)) {
      ws.send(JSON.stringify({ type: 'error', error: 'Incorrect password' }))
      ws.close()
      return
    }
  }

  // Add user to active users
  const addResult = room.addUser(username, ws)
  if (!addResult.success) {
    ws.send(JSON.stringify({ type: 'error', error: addResult.error }))
    ws.close()
    return
  }

  console.log(`${username} joined room ${roomId} (${room.users.size}/${room.maxUsers})`)

  // Send initial state to new user
  ws.send(JSON.stringify({
    type: 'init',
    sketches: Array.from(room.sketches.values()),
    userCount: room.users.size,
    maxUsers: room.maxUsers,
    username: username,
    color: addResult.color,
    roomName: room.name
  }))

  // Broadcast user count to all users in room
  room.broadcast({
    type: 'userCount',
    count: room.users.size,
    maxUsers: room.maxUsers
  })

  // Handle messages
  ws.on('message', async (data) => {
    try {
      const command = JSON.parse(data)
      await applyCommandToRoom(room, command)
      room.broadcast({ type: 'command', command })
    } catch (e) {
      console.error('Invalid message:', e)
    }
  })

  // Handle disconnect
  ws.on('close', () => {
    room.removeUser(username)
    console.log(`${username} left room ${roomId} (${room.users.size}/${room.maxUsers})`)
    room.broadcast({
      type: 'userCount',
      count: room.users.size,
      maxUsers: room.maxUsers
    })
  })
})

// --- Start ---
async function start() {
  try {
    await initializeDatabase()
    await restoreRooms()
    const PORT = process.env.PORT || 3000
    server.listen(PORT, () => {
      console.log(`Multi-room Garden running at http://localhost:${PORT}`)
      console.log(`Rooms loaded: ${rooms.size}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
