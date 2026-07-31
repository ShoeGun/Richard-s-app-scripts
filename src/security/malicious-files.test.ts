// src/security/malicious-files.test.ts
import { describe, it, expect } from 'vitest';

// Mock the function to be tested
const isSafeUploadName = (fileName: string): boolean => {
  // Example implementation for demonstration purposes
  const blockedExtensions = ['.exe', '.bat', '.sh'];
  return !blockedExtensions.some(ext => fileName.endsWith(ext));
};

describe('isSafeUploadName', () => {
  it('should block executable files', () => {
    expect(isSafeUploadName('malware.exe')).toBe(false);
  });

  it('should block batch script files', () => {
    expect(isSafeUploadName('script.bat')).toBe(false);
  });

  it('should block shell script files', () => {
    expect(isSafeUploadName('setup.sh')).toBe(false);
  });

  it('should allow non-malicious file names', () => {
    expect(isSafeUploadName('data.csv')).toBe(true);
  });
});