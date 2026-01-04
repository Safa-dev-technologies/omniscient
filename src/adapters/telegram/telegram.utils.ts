import crypto from 'node:crypto';
import type { TelegramUser } from './telegram.types.js';

/**
 * Verify Telegram webhook using secret token
 * Telegram supports optional secret_token in setWebhook
 * If set, it's sent in X-Telegram-Bot-Api-Secret-Token header
 */
export function verifyWebhookSecret(
  headerToken: string | undefined,
  expectedSecret: string
): boolean {
  if (!headerToken || !expectedSecret) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  if (headerToken.length !== expectedSecret.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(headerToken, 'utf8'),
    Buffer.from(expectedSecret, 'utf8')
  );
}

/**
 * Get file download URL from file_id
 * Requires calling getFile first to get file_path
 */
export async function getFileUrl(fileId: string, botToken: string): Promise<string> {
  // First, get file info
  const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const response = await fetch(getFileUrl);
  const data = (await response.json()) as { ok: boolean; result?: { file_path: string } };

  if (!data.ok || !data.result?.file_path) {
    throw new Error('Failed to get file path');
  }

  // Build download URL
  return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
}

/**
 * Build display name from Telegram user
 */
export function getDisplayName(user: TelegramUser): string {
  if (user.username) {
    return `@${user.username}`;
  }

  const parts = [user.first_name];
  if (user.last_name) {
    parts.push(user.last_name);
  }

  return parts.join(' ');
}

/**
 * Escape special characters for MarkdownV2
 * Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  // Characters that need escaping in MarkdownV2
  const specialChars = /[_*[\]()~`>#+\-=|{}.!]/g;
  return text.replace(specialChars, '\\$&');
}
