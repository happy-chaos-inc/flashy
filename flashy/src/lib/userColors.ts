// Generate consistent colors for collaborative editing
// RGB values: green(72,229,82), cyan(72,205,229), orange(253,187,93),
// blue(93,141,253), red(253,93,93), purple(191,130,232), pink(232,130,166)
export const USER_COLORS = [
  '#4ebf56', // Green (78, 191, 86)
  '#41bbd1', // Cyan (65, 187, 209)
  '#FDBB5D', // Orange (253, 187, 93)
  '#5D8DFD', // Blue (93, 141, 253)
  '#FD5D5D', // Red (253, 93, 93)
  '#BF82E8', // Purple (191, 130, 232)
  '#E882A6', // Pink (232, 130, 166)
];

export function generateUserInfo() {
  // Generate or retrieve user ID from session storage
  let userId = sessionStorage.getItem('flashy_user_id');
  if (!userId) {
    userId = `user-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('flashy_user_id', userId);
  }

  // Check if user already has a saved color
  let color = sessionStorage.getItem('flashy_user_color');
  if (!color) {
    // Assign a random color from the palette
    const randomIndex = Math.floor(Math.random() * USER_COLORS.length);
    color = USER_COLORS[randomIndex];
    sessionStorage.setItem('flashy_user_color', color);
  }

  // Use the username from login, or fallback to anonymous name
  const username = sessionStorage.getItem('flashy_username');
  const name = username || `User ${Math.abs(hashCode(userId)) % 100}`;

  return { userId, color, name };
}

// Update user's color and save to session
export function setUserColor(color: string) {
  sessionStorage.setItem('flashy_user_color', color);
}

// Simple hash function for consistent color assignment
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
