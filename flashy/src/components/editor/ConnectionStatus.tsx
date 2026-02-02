import { useEffect, useState } from 'react';
import { supabase } from '../../config/supabase';
import './ConnectionStatus.css';

export function ConnectionStatus() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Monitor Supabase connection status
    const channel = supabase.channel('status-check');

    channel.subscribe((status) => {
      setIsConnected(status === 'SUBSCRIBED');
    });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  return (
    <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
      <span className="status-dot"></span>
      <span className="status-text">
        {isConnected ? 'Live' : 'Connecting...'}
      </span>
    </div>
  );
}
