import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { initErrorReporter } from './lib/errorReporter';
// import { runSupabaseDebugTest } from './lib/supabase-debug-test';

// Initialize error reporting to Supabase
initErrorReporter();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
// Disable StrictMode to prevent double-mounting issues with Supabase Realtime
root.render(<App />);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

// Auto-run Supabase debug test (commented out - was causing mixed credentials)
// console.log('');
// console.log('='.repeat(80));
// console.log('SUPABASE REALTIME DEBUG TEST - AUTO-RUNNING');
// console.log('='.repeat(80));
// console.log('');
// runSupabaseDebugTest();
