import { FastifyRequest, FastifyReply } from 'fastify';
import * as chatService from './chat.service.js';
import {
  chatMessageSchema,
  conversationIdParamSchema,
  escalateSchema,
  type EscalateInput,
} from './chat.schema.js';

export async function chat(request: FastifyRequest, reply: FastifyReply) {
  const input = chatMessageSchema.parse(request.body);

  const result = await chatService.processChat({
    tenantId: request.tenant!.id,
    tenant: request.tenant!,
    message: input.message,
    sessionId: input.sessionId,
    channel: input.channel || 'WEB',
    metadata: input.metadata,
  });

  return reply.send({ success: true, data: result });
}

export async function getConversation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);

  const conversation = await chatService.getConversation(request.tenant!.id, id);

  if (!conversation) {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Conversation not found' },
    });
  }

  return reply.send({ success: true, data: conversation });
}

export async function sendMessage(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const input = chatMessageSchema.parse(request.body);

  const result = await chatService.sendMessageToConversation({
    tenantId: request.tenant!.id,
    tenant: request.tenant!,
    conversationId: id,
    message: input.message,
    metadata: input.metadata,
  });

  return reply.send({ success: true, data: result });
}

export async function escalateConversation(
  request: FastifyRequest<{ Params: { id: string }; Body: EscalateInput }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);

  // Validate body with schema - returns 400 on validation failure
  const parseResult = escalateSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid escalation data',
        details: parseResult.error.flatten(),
      },
    });
  }

  const { reason, notes, priority } = parseResult.data;

  const result = await chatService.escalateConversation(request.tenant!.id, id, reason, {
    notes,
    priority,
  });

  return reply.send({ success: true, data: result });
}

export async function closeConversation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);

  await chatService.closeConversation(request.tenant!.id, id);

  return reply.send({ success: true, data: { closed: true } });
}
