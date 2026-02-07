// Jest setup file
// This file runs before all tests

// Import testing-library matchers
import "@testing-library/jest-dom";

// Mock Electron APIs
global.window = global.window || {};

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.sessionStorage = sessionStorageMock as any;

// Mock better-sqlite3 is handled automatically by Jest via __mocks__ folder

// Suppress console errors in tests (optional)
// global.console.error = jest.fn();
// global.console.warn = jest.fn();

// Add custom matchers if needed
expect.extend({
  // Custom matchers can be added here
});
