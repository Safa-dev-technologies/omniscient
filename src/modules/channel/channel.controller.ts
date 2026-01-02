import { FastifyRequest, FastifyReply } from 'fastify';
import * as channelService from './channel.service.js';
import {
  createChannelConfigSchema,
  updateChannelConfigSchema,
  channelParamSchema,
} from './channel.schema.js';
import type { Channel } from '@prisma/client';

/**
 * Create channel configuration
 */
export async function createConfig(request: FastifyRequest, reply: FastifyReply) {
  const input = createChannelConfigSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const config = await channelService.createConfig(tenantId, input);
    return reply.status(201).send({ success: true, data: config });
  } catch (error: any) {
    if (error.message.includes('already configured')) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'CHANNEL_ALREADY_CONFIGURED',
          message: error.message,
        },
      });
    }
    if (error.message.includes('not yet implemented')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CHANNEL_NOT_SUPPORTED',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * List all channel configs for tenant
 */
export async function listConfigs(request: FastifyRequest, reply: FastifyReply) {
  const tenantId = request.tenant!.id;
  const configs = await channelService.listConfigs(tenantId);
  return reply.send({ success: true, data: configs });
}

/**
 * Get specific channel config
 */
export async function getConfig(
  request: FastifyRequest<{ Params: { channel: string } }>,
  reply: FastifyReply
) {
  const { channel } = channelParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  const config = await channelService.getConfig(tenantId, channel as Channel);

  if (!config) {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Channel config not found for channel ${channel}`,
      },
    });
  }

  return reply.send({ success: true, data: config });
}

/**
 * Update channel config
 */
export async function updateConfig(
  request: FastifyRequest<{ Params: { channel: string } }>,
  reply: FastifyReply
) {
  const { channel } = channelParamSchema.parse(request.params);
  const input = updateChannelConfigSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const config = await channelService.updateConfig(tenantId, channel as Channel, input);
    return reply.send({ success: true, data: config });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      });
    }
    if (error.message.includes('not yet implemented')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CHANNEL_NOT_SUPPORTED',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Delete channel config
 */
export async function deleteConfig(
  request: FastifyRequest<{ Params: { channel: string } }>,
  reply: FastifyReply
) {
  const { channel } = channelParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    await channelService.deleteConfig(tenantId, channel as Channel);
    return reply.send({ success: true, data: { deleted: true } });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Test channel connection
 */
export async function testConnection(
  request: FastifyRequest<{ Params: { channel: string } }>,
  reply: FastifyReply
) {
  const { channel } = channelParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const result = await channelService.testConnection(tenantId, channel as Channel);
    return reply.send({ success: true, data: result });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Rotate webhook secret
 */
export async function rotateWebhookSecret(
  request: FastifyRequest<{ Params: { channel: string } }>,
  reply: FastifyReply
) {
  const { channel } = channelParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const newSecret = await channelService.rotateWebhookSecret(tenantId, channel as Channel);
    return reply.send({ success: true, data: { secret: newSecret } });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
      });
    }
    throw error;
  }
}
