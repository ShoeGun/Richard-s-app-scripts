# Security Boundaries Documentation

This document outlines the security boundaries and test coverage implemented in the project to protect against various types of attacks and ensure data privacy.

## Prompt Injection
- **Function**: `isBlockedPrompt`
- **Description**: Blocks SQL commands like `DROP TABLE` and `DELETE FROM` to prevent malicious database operations.

## Unsupported Operations
- **Function**: `isSupportedOperation`
- **Description**: Limits supported operations to `SELECT`, `INSERT`, and `UPDATE` to restrict unauthorized data modifications.

## Malicious File Contents
- **Function**: `isSafeUploadName`
- **Description**: Blocks executable files (e.g., `.exe`, `.bat`, `.sh`) from being uploaded to prevent malicious code execution.

## Privacy Boundaries
- **Function**: `canExposeField`
- **Description**: Prevents sensitive fields like `password` and `ssn` from being exposed in data outputs.