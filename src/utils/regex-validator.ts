import safeRegex from 'safe-regex';
import { z } from 'zod';

/**
 * Maximum allowed length for a regex pattern
 * Longer patterns are more likely to be problematic
 */
const MAX_PATTERN_LENGTH = 100;

/**
 * Maximum number of patterns allowed in an array
 */
export const MAX_PATTERNS_COUNT = 10;

/**
 * Check if a regex pattern is safe from catastrophic backtracking (ReDoS)
 *
 * @param pattern - The regex pattern string to validate
 * @returns true if the pattern is safe, false otherwise
 */
export function isSafePattern(pattern: string): boolean {
  // Check length first (fast path)
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }

  // Empty pattern is safe
  if (pattern.length === 0) {
    return true;
  }

  // Check for catastrophic backtracking patterns using safe-regex
  return safeRegex(pattern);
}

/**
 * Validate that a pattern can be compiled as a valid regex
 *
 * @param pattern - The regex pattern string to validate
 * @returns true if the pattern is a valid regex, false otherwise
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Zod schema for safe regex patterns
 *
 * Validates that:
 * 1. Pattern is not too long (max 100 characters)
 * 2. Pattern is a valid regex syntax
 * 3. Pattern is safe from ReDoS attacks
 */
export const safePatternSchema = z
  .string()
  .max(MAX_PATTERN_LENGTH, `Pattern must be ${MAX_PATTERN_LENGTH} characters or less`)
  .refine(isValidRegex, {
    message: 'Invalid regex pattern syntax',
  })
  .refine(isSafePattern, {
    message: 'Unsafe regex pattern detected - pattern may cause performance issues',
  });

/**
 * Type for a validated safe pattern
 */
export type SafePattern = z.infer<typeof safePatternSchema>;
