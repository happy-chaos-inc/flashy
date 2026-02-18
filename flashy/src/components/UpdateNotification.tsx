import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import './UpdateNotification.css';

const CHECK_INTERVAL = 15000; // Check every 15 seconds (critical for CRDT integrity)
const APP_VERSION = Date.now().toString(); // Build timestamp as version

export function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // Store current version on first load
    const storedVersion = localStorage.getItem('app_version');
    if (!storedVersion) {
      localStorage.setItem('app_version', APP_VERSION);
    }

    const checkForUpdates = async () => {
      try {
        // Fetch index.html with aggressive cache bypass
        // Use PUBLIC_URL to handle GitHub Pages subdirectory
        const baseUrl = process.env.PUBLIC_URL || '';
        const response = await fetch(baseUrl + '/?t=' + Date.now(), {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        });
        const html = await response.text();

        // Check if the JS bundle hash changed
        const scriptMatch = html.match(/main\.([a-f0-9]+)\.js/);
        const currentMatch = document.querySelector('script[src*="main."]')?.getAttribute('src')?.match(/main\.([a-f0-9]+)\.js/);

        if (scriptMatch && currentMatch && scriptMatch[1] !== currentMatch[1]) {
          logger.log('🎉 New version detected! Current:', currentMatch[1], 'New:', scriptMatch[1]);
          logger.log('⏳ Auto-reloading in 3 seconds...');
          setUpdateAvailable(true);

          // Auto-reload after 3 seconds
          setTimeout(() => {
            handleRefresh();
          }, 3000);
        }
      } catch (error) {
        logger.error('Failed to check for updates:', error);
      }
    };

    // Check on mount
    checkForUpdates();

    // Check periodically
    const interval = setInterval(checkForUpdates, CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    logger.log('🔄 Forcing hard refresh and clearing all caches...');

    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();

    // Clear service worker caches if any
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    // Force hard reload
    window.location.reload();
  };

  if (!updateAvailable) return null;

  return (
    <div className="update-notification">
      <div className="update-content">
        <span>🎉 New version detected! Auto-reloading in 3s...</span>
      </div>
    </div>
  );
}
