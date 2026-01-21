/**
 * URL validation utilities for SSRF protection
 * Blocks requests to private/internal IP addresses
 */

import dns from 'dns';
import { promisify } from 'util';
import { logger } from '../lib/logger.js';

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

/**
 * Private/internal IPv4 ranges that should be blocked
 */
const BLOCKED_IPV4_RANGES = [
  // Loopback (127.0.0.0/8)
  { start: '127.0.0.0', end: '127.255.255.255', name: 'loopback' },
  // Private Class A (10.0.0.0/8)
  { start: '10.0.0.0', end: '10.255.255.255', name: 'private-class-a' },
  // Private Class B (172.16.0.0/12)
  { start: '172.16.0.0', end: '172.31.255.255', name: 'private-class-b' },
  // Private Class C (192.168.0.0/16)
  { start: '192.168.0.0', end: '192.168.255.255', name: 'private-class-c' },
  // Link-local (169.254.0.0/16) - includes AWS metadata service
  { start: '169.254.0.0', end: '169.254.255.255', name: 'link-local' },
  // Current network (0.0.0.0/8)
  { start: '0.0.0.0', end: '0.255.255.255', name: 'current-network' },
  // Shared address space (100.64.0.0/10)
  { start: '100.64.0.0', end: '100.127.255.255', name: 'shared-address' },
  // IETF protocol assignments (192.0.0.0/24)
  { start: '192.0.0.0', end: '192.0.0.255', name: 'ietf-protocol' },
  // Documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
  { start: '192.0.2.0', end: '192.0.2.255', name: 'documentation-1' },
  { start: '198.51.100.0', end: '198.51.100.255', name: 'documentation-2' },
  { start: '203.0.113.0', end: '203.0.113.255', name: 'documentation-3' },
  // Benchmarking (198.18.0.0/15)
  { start: '198.18.0.0', end: '198.19.255.255', name: 'benchmarking' },
  // Broadcast (255.255.255.255/32)
  { start: '255.255.255.255', end: '255.255.255.255', name: 'broadcast' },
];

/**
 * Blocked IPv6 ranges
 */
const BLOCKED_IPV6_PATTERNS = [
  /^::1$/i, // Loopback
  /^fe80:/i, // Link-local
  /^fc00:/i, // Unique local (fc00::/7)
  /^fd/i, // Unique local (fd00::/8)
  /^::ffff:(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i, // IPv4-mapped
];

/**
 * Blocked hostnames
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  // Cloud metadata endpoints
  'metadata.google.internal',
  'metadata.goog',
  // Common internal hostnames
  'internal',
  'intranet',
  'corp',
  'private',
];

/**
 * Convert IP address string to numeric value for range comparison
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * Check if IPv4 address is in a blocked range
 */
function isBlockedIPv4(ip: string): { blocked: boolean; reason?: string } {
  const ipNum = ipToNumber(ip);

  for (const range of BLOCKED_IPV4_RANGES) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);

    if (ipNum >= startNum && ipNum <= endNum) {
      return { blocked: true, reason: range.name };
    }
  }

  return { blocked: false };
}

/**
 * Check if IPv6 address is blocked
 */
function isBlockedIPv6(ip: string): { blocked: boolean; reason?: string } {
  const normalizedIp = ip.toLowerCase();

  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(normalizedIp)) {
      return { blocked: true, reason: 'ipv6-private' };
    }
  }

  return { blocked: false };
}

/**
 * Check if hostname is blocked
 */
function isBlockedHostname(hostname: string): { blocked: boolean; reason?: string } {
  const normalizedHostname = hostname.toLowerCase();

  // Check exact matches
  if (BLOCKED_HOSTNAMES.includes(normalizedHostname)) {
    return { blocked: true, reason: 'blocked-hostname' };
  }

  // Check if hostname ends with blocked suffix
  for (const blocked of BLOCKED_HOSTNAMES) {
    if (normalizedHostname.endsWith(`.${blocked}`)) {
      return { blocked: true, reason: 'blocked-hostname-suffix' };
    }
  }

  // Check for IP address in hostname
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(normalizedHostname)) {
    return isBlockedIPv4(normalizedHostname);
  }

  return { blocked: false };
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  resolvedIps?: string[];
}

/**
 * Validate a URL for SSRF protection
 * Checks hostname and resolves DNS to verify IP addresses are not private
 */
export async function validateUrlForSSRF(url: string): Promise<UrlValidationResult> {
  let urlObj: URL;

  // Parse URL
  try {
    urlObj = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Check protocol
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return { valid: false, error: `Unsupported protocol: ${urlObj.protocol}` };
  }

  const hostname = urlObj.hostname;

  // Check hostname against blocklist
  const hostnameCheck = isBlockedHostname(hostname);
  if (hostnameCheck.blocked) {
    logger.warn({ url, hostname, reason: hostnameCheck.reason }, 'URL blocked: hostname');
    return {
      valid: false,
      error: `Access to ${hostname} is not allowed: ${hostnameCheck.reason}`,
    };
  }

  // Resolve DNS to check actual IP addresses
  const resolvedIps: string[] = [];

  try {
    // Try IPv4
    const ipv4Addresses = await dnsResolve4(hostname).catch(() => []);
    resolvedIps.push(...ipv4Addresses);

    // Check each resolved IPv4 address
    for (const ip of ipv4Addresses) {
      const ipCheck = isBlockedIPv4(ip);
      if (ipCheck.blocked) {
        logger.warn(
          { url, hostname, resolvedIp: ip, reason: ipCheck.reason },
          'URL blocked: resolved to private IP'
        );
        return {
          valid: false,
          error: `URL resolves to private IP address (${ipCheck.reason})`,
          resolvedIps,
        };
      }
    }

    // Try IPv6 (if available)
    const ipv6Addresses = await dnsResolve6(hostname).catch(() => []);
    resolvedIps.push(...ipv6Addresses);

    // Check each resolved IPv6 address
    for (const ip of ipv6Addresses) {
      const ipCheck = isBlockedIPv6(ip);
      if (ipCheck.blocked) {
        logger.warn(
          { url, hostname, resolvedIp: ip, reason: ipCheck.reason },
          'URL blocked: resolved to private IPv6'
        );
        return {
          valid: false,
          error: `URL resolves to private IPv6 address (${ipCheck.reason})`,
          resolvedIps,
        };
      }
    }

    // If no IPs resolved, hostname might not exist
    if (resolvedIps.length === 0) {
      logger.warn({ url, hostname }, 'URL blocked: hostname does not resolve');
      return {
        valid: false,
        error: `Hostname ${hostname} does not resolve to any IP address`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ url, hostname, error: message }, 'DNS resolution failed');
    return {
      valid: false,
      error: `DNS resolution failed for ${hostname}: ${message}`,
    };
  }

  return { valid: true, resolvedIps };
}

/**
 * Synchronous hostname-only check (for quick rejection without DNS lookup)
 * Use validateUrlForSSRF for full validation including DNS resolution
 */
export function quickValidateUrl(url: string): UrlValidationResult {
  let urlObj: URL;

  try {
    urlObj = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return { valid: false, error: `Unsupported protocol: ${urlObj.protocol}` };
  }

  const hostnameCheck = isBlockedHostname(urlObj.hostname);
  if (hostnameCheck.blocked) {
    return {
      valid: false,
      error: `Access to ${urlObj.hostname} is not allowed: ${hostnameCheck.reason}`,
    };
  }

  return { valid: true };
}
