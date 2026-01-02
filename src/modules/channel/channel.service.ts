import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { encrypt, decryptJson, generateWebhookSecret } from '../../utils/crypto.js';
import {
  whatsappCredentialsSchema,
  telegramCredentialsSchema,
  webCredentialsSchema,
} from './channel.schema.js';
import { Prisma } from '@prisma/client';
import type { Channel } from '@prisma/client';
import type {
  CreateChannelConfigInput,
  UpdateChannelConfigInput,
  ChannelConfigResponse,
} from './channel.types.js';

/**
 * Mask credentials in API responses
 * Shows only last 4 characters for security
 */
function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === 'string' && value.length > 4) {
      // Mask strings longer than 4 chars
      masked[key] = `****...${value.slice(-4)}`;
    } else if (Array.isArray(value)) {
      // For arrays (like allowedOrigins), show count
      masked[key] = `[${value.length} item${value.length !== 1 ? 's' : ''}]`;
    } else {
      // Keep other types as-is
      masked[key] = value;
    }
  }
  return masked;
}

/**
 * Validate credentials based on channel type
 */
function validateCredentials(channel: Channel, credentials: Record<string, unknown>): void {
  switch (channel) {
    case 'WHATSAPP':
      whatsappCredentialsSchema.parse(credentials);
      break;
    case 'TELEGRAM':
      telegramCredentialsSchema.parse(credentials);
      break;
    case 'WEB':
      webCredentialsSchema.parse(credentials);
      break;
    case 'SLACK':
    case 'EMAIL':
    case 'SMS':
      throw new Error(`Channel ${channel} is not yet implemented`);
    default:
      throw new Error(`Unknown channel type: ${channel}`);
  }
}

/**
 * Generate webhook URL for a channel
 */
export async function generateWebhookUrl(tenantId: string, channel: Channel): Promise<string> {
  // Get tenant slug for URL
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL || 'https://api.omniscient.ai';
  const channelLower = channel.toLowerCase();
  return `${baseUrl}/v1/webhooks/${channelLower}/${tenant.slug}`;
}

/**
 * Create a new channel configuration
 */
export async function createConfig(
  tenantId: string,
  data: CreateChannelConfigInput
): Promise<ChannelConfigResponse> {
  // Validate tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Validate credentials per channel type
  validateCredentials(data.channel, data.credentials);

  // Check if channel config already exists
  const existing = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel: data.channel,
      },
    },
  });

  if (existing) {
    throw new Error(`Channel ${data.channel} is already configured for this tenant`);
  }

  // Encrypt credentials
  const encryptedCredentials = encrypt(JSON.stringify(data.credentials));

  // Generate webhook secret
  const webhookSecret = generateWebhookSecret();

  // Generate webhook URL if not provided
  const webhookUrl = data.webhookUrl || (await generateWebhookUrl(tenantId, data.channel));

  // Create channel config
  const config = await prisma.channelConfig.create({
    data: {
      tenantId,
      channel: data.channel,
      enabled: data.enabled ?? true,
      credentials: encryptedCredentials as Prisma.InputJsonValue,
      webhookUrl,
      webhookSecret,
      settings: data.settings ? (data.settings as Prisma.InputJsonValue) : undefined,
    },
  });

  logger.info({ tenantId, channel: data.channel, configId: config.id }, 'Channel config created');

  // Decrypt credentials for masking (only for response)
  const decryptedCredentials = decryptJson<Record<string, unknown>>(encryptedCredentials);
  const maskedCredentials = maskCredentials(decryptedCredentials);

  return {
    id: config.id,
    tenantId: config.tenantId,
    channel: config.channel,
    enabled: config.enabled,
    webhookUrl: config.webhookUrl,
    credentials: maskedCredentials,
    settings: config.settings as Record<string, unknown> | null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * List all channel configs for a tenant
 */
export async function listConfigs(tenantId: string): Promise<ChannelConfigResponse[]> {
  const configs = await prisma.channelConfig.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });

  return configs.map((config) => {
    // Decrypt and mask credentials
    const encryptedCredentials = config.credentials as string;
    const decryptedCredentials = decryptJson<Record<string, unknown>>(encryptedCredentials);
    const maskedCredentials = maskCredentials(decryptedCredentials);

    return {
      id: config.id,
      tenantId: config.tenantId,
      channel: config.channel,
      enabled: config.enabled,
      webhookUrl: config.webhookUrl,
      credentials: maskedCredentials,
      settings: config.settings as Record<string, unknown> | null,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  });
}

/**
 * Get specific channel config
 */
export async function getConfig(
  tenantId: string,
  channel: Channel
): Promise<ChannelConfigResponse | null> {
  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
  });

  if (!config) {
    return null;
  }

  // Decrypt and mask credentials
  const encryptedCredentials = config.credentials as string;
  const decryptedCredentials = decryptJson<Record<string, unknown>>(encryptedCredentials);
  const maskedCredentials = maskCredentials(decryptedCredentials);

  return {
    id: config.id,
    tenantId: config.tenantId,
    channel: config.channel,
    enabled: config.enabled,
    webhookUrl: config.webhookUrl,
    credentials: maskedCredentials,
    settings: config.settings as Record<string, unknown> | null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * Update channel config
 */
export async function updateConfig(
  tenantId: string,
  channel: Channel,
  data: UpdateChannelConfigInput
): Promise<ChannelConfigResponse> {
  // Check if config exists
  const existing = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
  });

  if (!existing) {
    throw new Error(`Channel config not found for channel ${channel}`);
  }

  // If credentials are being updated, validate and encrypt them
  let encryptedCredentials: Prisma.InputJsonValue | undefined;
  if (data.credentials) {
    // Merge with existing credentials (don't replace entirely)
    const existingCredentials = decryptJson<Record<string, unknown>>(
      existing.credentials as string
    );
    const mergedCredentials = { ...existingCredentials, ...data.credentials };
    validateCredentials(channel, mergedCredentials);
    encryptedCredentials = encrypt(JSON.stringify(mergedCredentials)) as Prisma.InputJsonValue;
  }

  // Update config
  const updateData: Prisma.ChannelConfigUpdateInput = {};
  if (data.enabled !== undefined) {
    updateData.enabled = data.enabled;
  }
  if (encryptedCredentials) {
    updateData.credentials = encryptedCredentials;
  }
  if (data.webhookUrl !== undefined) {
    updateData.webhookUrl = data.webhookUrl;
  }
  if (data.settings !== undefined) {
    updateData.settings = data.settings
      ? (data.settings as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  const config = await prisma.channelConfig.update({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
    data: updateData,
  });

  logger.info({ tenantId, channel, configId: config.id }, 'Channel config updated');

  // Decrypt and mask credentials for response
  const finalCredentials = encryptedCredentials
    ? decryptJson<Record<string, unknown>>(encryptedCredentials as string)
    : decryptJson<Record<string, unknown>>(existing.credentials as string);
  const maskedCredentials = maskCredentials(finalCredentials);

  return {
    id: config.id,
    tenantId: config.tenantId,
    channel: config.channel,
    enabled: config.enabled,
    webhookUrl: config.webhookUrl,
    credentials: maskedCredentials,
    settings: config.settings as Record<string, unknown> | null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * Delete/disconnect channel config
 */
export async function deleteConfig(tenantId: string, channel: Channel): Promise<void> {
  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
  });

  if (!config) {
    throw new Error(`Channel config not found for channel ${channel}`);
  }

  await prisma.channelConfig.delete({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
  });

  logger.info({ tenantId, channel, configId: config.id }, 'Channel config deleted');
}

/**
 * Test channel connection
 * This is a placeholder - actual implementation will depend on the channel adapter
 */
export async function testConnection(
  tenantId: string,
  channel: Channel
): Promise<{ success: boolean; message: string }> {
  const config = await getConfig(tenantId, channel);

  if (!config) {
    throw new Error(`Channel config not found for channel ${channel}`);
  }

  if (!config.enabled) {
    return {
      success: false,
      message: 'Channel is disabled',
    };
  }

  // TODO: Implement actual connection testing when adapters are ready
  // For now, just validate that config exists and is enabled
  return {
    success: true,
    message: 'Channel configuration is valid (connection test not yet implemented)',
  };
}

/**
 * Rotate webhook secret
 */
export async function rotateWebhookSecret(tenantId: string, channel: Channel): Promise<string> {
  const existing = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
  });

  if (!existing) {
    throw new Error(`Channel config not found for channel ${channel}`);
  }

  const newSecret = generateWebhookSecret();

  await prisma.channelConfig.update({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
    data: {
      webhookSecret: newSecret,
    },
  });

  logger.info({ tenantId, channel }, 'Webhook secret rotated');

  return newSecret;
}
