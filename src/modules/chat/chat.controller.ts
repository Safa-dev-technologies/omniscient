import { FastifyRequest, FastifyReply } from 'fastify';
import * as chatService from './chat.service.js';
import { chatMessageSchema, conversationIdParamSchema } from './chat.schema.js';

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
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = conversationIdParamSchema.parse(request.params);
  const body = request.body as { reason?: string };

  const result = await chatService.escalateConversation(request.tenant!.id, id, body.reason);

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
