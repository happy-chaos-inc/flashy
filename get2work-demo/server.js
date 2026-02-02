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
    this.name = name || 'Untitled Checklist'
    this.todos = new Map() // todoId -> { id, text, position, checks: Set<username> }
    this.users = new Map() // username -> { username, ws, color, joinedAt }
    this.userPasswords = new Map() // username -> hashed password (or null for no password)
    this.userAssignedColors = new Map() // username -> assigned color (persistent)
    this.createdAt = Date.now()
    this.lastActivityAt = Date.now()
    this.maxUsers = 8
    this.colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de']
    this.usedColors = new Set()
  }

  hashPassword(password) {
    if (!password) return null
    return crypto.createHash('sha256').update(password).digest('hex')
  }

  hasUser(username) {
    return this.userPasswords.has(username)
  }

  verifyUserPassword(username, password) {
    if (!this.userPasswords.has(username)) {
      return false
    }
    const storedHash = this.userPasswords.get(username)
    // If no password was set (null), allow login without password
    if (storedHash === null) {
      return !password || password === ''
    }
    // If password was set, verify it matches
    return password && this.hashPassword(password) === storedHash
  }

  getAvailableUsername(baseUsername) {
    if (!this.hasUser(baseUsername)) {
      return baseUsername
    }

    // Find next available numbered username
    let counter = 1
    let newUsername = `${baseUsername} (${counter})`
    while (this.hasUser(newUsername)) {
      counter++
      newUsername = `${baseUsername} (${counter})`
    }
    return newUsername
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

    // Check if user has a previously assigned color
    let color = this.userAssignedColors.get(username)
    console.log(`[addUser] ${username} - existing color:`, color, 'userAssignedColors:', Array.from(this.userAssignedColors.entries()))
    if (color) {
      // User has a persistent color, mark it as used
      this.usedColors.add(color)
      console.log(`[addUser] ${username} - using existing color:`, color)
    } else {
      // Assign new color and remember it
      color = this.assignColor()
      this.userAssignedColors.set(username, color)
      console.log(`[addUser] ${username} - assigned NEW color:`, color)
    }

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

async function saveRoomUser(roomId, username, passwordHash, color) {
  console.log(`[saveRoomUser] Saving ${username} with color: ${color}`)
  await pool.query(
    `INSERT INTO room_users (room_id, username, password_hash, color)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (room_id, username) DO UPDATE SET color = $4`,
    [roomId, username, passwordHash, color]
  )
}

async function restoreRooms() {
  try {
    const roomsResult = await pool.query('SELECT * FROM rooms')

    for (const roomData of roomsResult.rows) {
      const room = new Room(roomData.id, roomData.name)
      room.createdAt = parseInt(roomData.created_at)
      room.lastActivityAt = parseInt(roomData.last_activity_at)

      // Restore user passwords and colors
      const usersResult = await pool.query(
        'SELECT username, password_hash, color FROM room_users WHERE room_id = $1',
        [room.id]
      )
      console.log(`[restoreRooms] Room ${room.id} - restoring ${usersResult.rows.length} users`)
      for (const userData of usersResult.rows) {
        room.userPasswords.set(userData.username, userData.password_hash)
        if (userData.color) {
          room.userAssignedColors.set(userData.username, userData.color)
          console.log(`[restoreRooms] Restored color for ${userData.username}: ${userData.color}`)
        } else {
          console.log(`[restoreRooms] No color saved for ${userData.username}`)
        }
      }

      // Restore TODOs
      const todosResult = await pool.query(
        'SELECT * FROM todos WHERE room_id = $1 ORDER BY position',
        [room.id]
      )
      for (const todoData of todosResult.rows) {
        const todo = {
          id: todoData.id,
          text: todoData.text,
          position: parseInt(todoData.position),
          checks: new Set()
        }

        // Restore checks for this TODO
        const checksResult = await pool.query(
          'SELECT username FROM todo_checks WHERE todo_id = $1',
          [todo.id]
        )
        for (const checkData of checksResult.rows) {
          todo.checks.add(checkData.username)
        }

        room.todos.set(todo.id, todo)
      }

      rooms.set(room.id, room)
      console.log(`Restored room ${room.id} with ${room.todos.size} todos`)
    }
  } catch (error) {
    console.error('Error restoring rooms:', error)
  }
}

async function applyCommandToRoom(room, command, shouldPersist = true) {
  switch (command.op) {
    case 'createTodo':
      room.todos.set(command.todo.id, {
        ...command.todo,
        checks: new Set(command.todo.checks || [])
      })
      if (shouldPersist) {
        await pool.query(
          `INSERT INTO todos (id, room_id, text, position, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [command.todo.id, room.id, command.todo.text, command.todo.position, Date.now()]
        )
      }
      break

    case 'updateTodo':
      const todo = room.todos.get(command.id)
      if (todo) {
        todo.text = command.text
        if (shouldPersist) {
          await pool.query(
            `UPDATE todos SET text = $1 WHERE id = $2`,
            [command.text, command.id]
          )
        }
      }
      break

    case 'deleteTodo':
      room.todos.delete(command.id)
      if (shouldPersist) {
        await pool.query('DELETE FROM todos WHERE id = $1', [command.id])
      }
      break

    case 'checkTodo':
      const todoToCheck = room.todos.get(command.todoId)
      if (todoToCheck) {
        todoToCheck.checks.add(command.username)
        if (shouldPersist) {
          await pool.query(
            `INSERT INTO todo_checks (todo_id, room_id, username, checked_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (todo_id, username) DO NOTHING`,
            [command.todoId, room.id, command.username, Date.now()]
          )
        }
      }
      break

    case 'uncheckTodo':
      const todoToUncheck = room.todos.get(command.todoId)
      if (todoToUncheck) {
        todoToUncheck.checks.delete(command.username)
        if (shouldPersist) {
          await pool.query(
            `DELETE FROM todo_checks WHERE todo_id = $1 AND username = $2`,
            [command.todoId, command.username]
          )
        }
      }
      break
  }

  room.updateActivity()
  if (shouldPersist) {
    await saveRoom(room)
  }
}

function generateRoomId() {
  return crypto.randomBytes(8).toString('hex')
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
        const { name, todos } = JSON.parse(body || '{}')
        const roomId = generateRoomId()
        const room = new Room(roomId, name)

        // Save room first (required for foreign key constraint)
        rooms.set(roomId, room)
        await saveRoom(room)

        // Add initial todos
        if (todos && Array.isArray(todos)) {
          for (let i = 0; i < todos.length; i++) {
            const todo = {
              id: crypto.randomUUID(),
              text: todos[i],
              position: i,
              checks: new Set()
            }
            room.todos.set(todo.id, todo)
            await pool.query(
              `INSERT INTO todos (id, room_id, text, position, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [todo.id, roomId, todo.text, todo.position, Date.now()]
            )
          }
        }

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

  // API: Check if username exists
  if (pathname.startsWith('/api/rooms/') && pathname.endsWith('/check-user') && req.method === 'GET') {
    const pathSegments = pathname.split('/')
    const roomId = pathSegments[3]
    const username = parsedUrl.query.username

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

  // API: Get room info
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
  let username = params.get('username')
  const password = params.get('password') || ''
  const isNewUser = params.get('isNewUser') === 'true'

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', error: 'Missing room' }))
    ws.close()
    return
  }

  const room = rooms.get(roomId)
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }))
    ws.close()
    return
  }

  // Guest mode - just send read-only data
  if (!username) {
    const todosArray = Array.from(room.todos.values()).map(todo => ({
      id: todo.id,
      text: todo.text,
      position: todo.position,
      checks: Array.from(todo.checks)
    }))

    ws.send(JSON.stringify({
      type: 'init',
      todos: todosArray,
      username: null,
      color: null,
      roomName: room.name,
      userColors: getUserColorMap(room)
    }))

    // Handle guest disconnect
    ws.on('close', () => {
      console.log('Guest disconnected from room', roomId)
    })
    return
  }

  // Authenticated user flow
  const userExists = room.hasUser(username)

  if (isNewUser) {
    // User is trying to register a new username
    if (userExists) {
      // Username taken - auto-generate a new one
      const originalUsername = username
      username = room.getAvailableUsername(username)
      console.log(`Username "${originalUsername}" taken, assigned "${username}"`)
    }

    // Register the new user
    const registerResult = room.registerUser(username, password)
    if (!registerResult.success) {
      ws.send(JSON.stringify({ type: 'error', error: registerResult.error }))
      ws.close()
      return
    }
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

  // Save user with assigned color
  await saveRoomUser(roomId, username, room.userPasswords.get(username), addResult.color)

  console.log(`${username} joined room ${roomId}`)

  // Send initial state to new user
  const todosArray = Array.from(room.todos.values()).map(todo => ({
    id: todo.id,
    text: todo.text,
    position: todo.position,
    checks: Array.from(todo.checks)
  }))

  ws.send(JSON.stringify({
    type: 'init',
    todos: todosArray,
    username: username,
    color: addResult.color,
    roomName: room.name,
    userColors: getUserColorMap(room)
  }))

  // Broadcast user join
  room.broadcast({
    type: 'userJoined',
    username: username,
    color: addResult.color,
    userColors: getUserColorMap(room)
  })

  // Handle messages
  ws.on('message', async (data) => {
    try {
      const command = JSON.parse(data)

      // Verify user is authenticated for mutations
      const user = room.getUserByWs(ws)
      if (!user) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }))
        return
      }

      // For check/uncheck, set the username from authenticated user
      if (command.op === 'checkTodo' || command.op === 'uncheckTodo') {
        command.username = user.username
      }

      await applyCommandToRoom(room, command)
      room.broadcast({ type: 'command', command })
    } catch (e) {
      console.error('Invalid message:', e)
    }
  })

  // Handle disconnect
  ws.on('close', () => {
    room.removeUser(username)
    console.log(`${username} left room ${roomId}`)
    room.broadcast({
      type: 'userLeft',
      username: username,
      userColors: getUserColorMap(room)
    })
  })
})

function getUserColorMap(room) {
  const colorMap = {}
  // Include ALL assigned colors (online and offline users)
  for (const [username, color] of room.userAssignedColors.entries()) {
    colorMap[username] = color
  }
  return colorMap
}

// --- Start ---
async function start() {
  try {
    await initializeDatabase()
    await restoreRooms()
    const PORT = process.env.PORT || 3000
    server.listen(PORT, () => {
      console.log(`Get2Work running at http://localhost:${PORT}`)
      console.log(`Rooms loaded: ${rooms.size}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
