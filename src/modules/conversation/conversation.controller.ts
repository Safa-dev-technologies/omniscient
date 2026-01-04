import { FastifyRequest, FastifyReply } from 'fastify';
import * as conversationService from './conversation.service.js';
import {
  createConversationSchema,
  updateConversationSchema,
  conversationIdParamSchema,
  listConversationsQuerySchema,
  transitionConversationStatusSchema,
} from './conversation.schema.js';

/**
 * Create a new conversation
 */
export async function createConversation(request: FastifyRequest, reply: FastifyReply) {
  const input = createConversationSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const conversation = await conversationService.createConversation(tenantId, input);
    return reply.status(201).send({ success: true, data: conversation });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Get conversation by ID
 */
export async function getConversation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const conversation = await conversationService.getConversation(tenantId, id);
    return reply.send({ success: true, data: conversation });
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
 * List conversations
 */
export async function listConversations(request: FastifyRequest, reply: FastifyReply) {
  const query = listConversationsQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const result = await conversationService.listConversations(tenantId, query);
  return reply.send({ success: true, data: result.conversations, pagination: result.pagination });
}

/**
 * Update conversation
 */
export async function updateConversation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const input = updateConversationSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const conversation = await conversationService.updateConversation(tenantId, id, input);
    return reply.send({ success: true, data: conversation });
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
    if (error.message.includes('Invalid status transition')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Transition conversation status
 */
export async function transitionStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const input = transitionConversationStatusSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const conversation = await conversationService.transitionConversationStatus(
      tenantId,
      id,
      input
    );
    return reply.send({ success: true, data: conversation });
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
    if (error.message.includes('Invalid status transition')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Get conversation history (messages)
 */
export async function getHistory(
  request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;
  const limit = request.query?.limit;

  const messages = await conversationService.getConversationHistory(tenantId, id, limit);
  return reply.send({ success: true, data: messages });
}

/**
 * Delete conversation (close it)
 */
export async function deleteConversation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const result = await conversationService.deleteConversation(tenantId, id);
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
 * Get allowed status transitions
 */
export async function getAllowedTransitions(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const result = await conversationService.getAllowedStatusTransitions(tenantId, id);
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
