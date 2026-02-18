/**
 * APP TESTS
 * Basic tests for the App component structure
 * Note: Full App rendering requires complex mocking due to react-router-dom v7 ESM
 */

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

describe('App Component', () => {
  describe('File Structure', () => {
    it('should have App.tsx', () => {
      const appPath = path.resolve(__dirname, '../App.tsx');
      expect(fs.existsSync(appPath)).toBe(true);
    });

    it('should export default App component', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('export default');
    });

    it('should use BrowserRouter', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('BrowserRouter');
    });

    it('should have Routes configuration', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('Routes');
      expect(content).toContain('Route');
    });

    it('should include EditorPage route', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('EditorPage');
    });

    it('should include LoginPage route', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('LoginPage');
    });

    it('should use AuthProvider', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain('AuthProvider');
    });
  });

  describe('Route Configuration', () => {
    it('should have room route with parameter', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toContain(':roomId');
    });

    it('should handle root path', () => {
      const content = fs.readFileSync(
        path.resolve(__dirname, '../App.tsx'),
        'utf-8'
      );
      expect(content).toMatch(/path=["']\//);
    });
  });
});
