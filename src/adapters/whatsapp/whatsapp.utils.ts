import crypto from 'node:crypto';

/**
 * Verify WhatsApp webhook signature
 * CRITICAL: All incoming webhooks MUST be verified
 *
 * @param payload - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param appSecret - Facebook App Secret
 * @returns boolean - true if signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature?.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
  const actualSignature = signature.slice(7); // Remove "sha256=" prefix

  // Use timing-safe comparison to prevent timing attacks
  if (expectedSignature.length !== actualSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(actualSignature, 'hex')
  );
}

/**
 * Get media URL from media ID
 * Media IDs must be exchanged for URLs before downloading
 */
export async function getMediaUrl(mediaId: string, accessToken: string): Promise<string> {
  const url = `https://graph.facebook.com/v18.0/${mediaId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = (await response.json()) as {
    url: string;
    mime_type: string;
    sha256: string;
    file_size: number;
  };

  if (!data.url) {
    throw new Error('Failed to get media URL');
  }

  return data.url;
}

/**
 * Format phone number for WhatsApp
 * Removes +, spaces, dashes. Ensures country code.
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');

  // If doesn't start with country code, assume it's missing
  // This is a simplified check - in production, you'd want more validation
  if (cleaned.length < 10) {
    throw new Error('Invalid phone number format');
  }

  // Ensure it starts with country code (add + for display, but WhatsApp API expects digits only)
  // WhatsApp expects E.164 format without the + sign in the API
  return cleaned;
}
