// src/security/privacy-boundaries.test.ts
import { describe, it, expect } from 'vitest';

// Mock the function to be tested
const canExposeField = (fieldName: string): boolean => {
  // Example implementation for demonstration purposes
  const privateFields = ['password', 'ssn'];
  return !privateFields.includes(fieldName);
};

describe('canExposeField', () => {
  it('should not expose password field', () => {
    expect(canExposeField('password')).toBe(false);
  });

  it('should not expose SSN field', () => {
    expect(canExposeField('ssn')).toBe(false);
  });

  it('should expose non-private fields', () => {
    expect(canExposeField('name')).toBe(true);
  });
});