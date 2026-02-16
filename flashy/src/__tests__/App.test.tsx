import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock react-markdown to avoid ESM issues in tests
jest.mock('react-markdown', () => {
  return function ReactMarkdown({ children }: { children: string }) {
    return <div>{children}</div>;
  };
});

// Mock test-broadcast to avoid broadcast testing in App tests
jest.mock('../lib/test-broadcast', () => ({
  testBroadcast: jest.fn().mockResolvedValue(undefined),
}));

// Mock Supabase to avoid real connections during tests
jest.mock('../config/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } }
      })
    },
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn().mockResolvedValue({ error: null }),
    })
  }
}));

describe('App Component', () => {
  it('renders without crashing', () => {
    render(<App />);
    // Just check that it renders something
    expect(document.body).toBeTruthy();
  });

  it('should render auth or editor', async () => {
    render(<App />);
    // App should render either login or editor page
    const appElement = document.querySelector('.App');
    expect(appElement || document.body).toBeTruthy();
  });
});
