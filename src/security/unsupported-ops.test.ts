// src/security/unsupported-ops.test.ts
import { describe, it, expect } from 'vitest';

// Mock the function to be tested
const isSupportedOperation = (operation: string): boolean => {
  // Example implementation for demonstration purposes
  const supportedOperations = ['SELECT', 'INSERT', 'UPDATE'];
  return supportedOperations.includes(operation);
};

describe('isSupportedOperation', () => {
  it('should support SELECT operation', () => {
    expect(isSupportedOperation('SELECT')).toBe(true);
  });

  it('should support INSERT operation', () => {
    expect(isSupportedOperation('INSERT')).toBe(true);
  });

  it('should support UPDATE operation', () => {
    expect(isSupportedOperation('UPDATE')).toBe(true);
  });

  it('should not support DROP TABLE operation', () => {
    expect(isSupportedOperation('DROP TABLE')).toBe(false);
  });
});