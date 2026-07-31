// src/security/prompt-injection.test.ts
import { describe, it, expect } from 'vitest';

// Mock the function to be tested
const isBlockedPrompt = (prompt: string): boolean => {
  // Example implementation for demonstration purposes
  return prompt.includes('DROP TABLE') || prompt.includes('DELETE FROM');
};

describe('isBlockedPrompt', () => {
  it('should block SQL DROP TABLE commands', () => {
    expect(isBlockedPrompt('DROP TABLE users')).toBe(true);
  });

  it('should block SQL DELETE FROM commands', () => {
    expect(isBlockedPrompt('DELETE FROM users')).toBe(true);
  });

  it('should allow non-malicious prompts', () => {
    expect(isBlockedPrompt('SELECT * FROM users')).toBe(false);
  });
});