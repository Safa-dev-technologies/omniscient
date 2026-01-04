import { FastifyRequest, FastifyReply } from 'fastify';
import * as escalationService from './escalation.service.js';
import {
  createEscalationSchema,
  updateEscalationSchema,
  resolveEscalationSchema,
  escalationIdParamSchema,
  listEscalationsQuerySchema,
  createExternalTicketSchema,
} from './escalation.schema.js';

/**
 * Create escalation
 */
export async function createEscalation(request: FastifyRequest, reply: FastifyReply) {
  const input = createEscalationSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const result = await escalationService.createEscalation(tenantId, input);
    return reply.status(201).send({ success: true, data: result });
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
    if (error.message.includes('already has an escalation')) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'ESCALATION_EXISTS',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Get escalation by ID
 */
export async function getEscalation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = escalationIdParamSchema.parse(request.params);
  const tenantId = request.tenant!.id;

  try {
    const escalation = await escalationService.getEscalation(tenantId, id);
    return reply.send({ success: true, data: escalation });
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
 * List escalations
 */
export async function listEscalations(request: FastifyRequest, reply: FastifyReply) {
  const query = listEscalationsQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const result = await escalationService.listEscalations(tenantId, query);
  return reply.send({ success: true, data: result.escalations, pagination: result.pagination });
}

/**
 * Update escalation
 */
export async function updateEscalation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = escalationIdParamSchema.parse(request.params);
  const input = updateEscalationSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const escalation = await escalationService.updateEscalation(tenantId, id, input);
    return reply.send({ success: true, data: escalation });
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
 * Resolve escalation
 */
export async function resolveEscalation(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = escalationIdParamSchema.parse(request.params);
  const input = resolveEscalationSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const escalation = await escalationService.resolveEscalation(tenantId, id, input);
    return reply.send({ success: true, data: escalation });
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
    if (error.message.includes('already resolved')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'ALREADY_RESOLVED',
          message: error.message,
        },
      });
    }
    throw error;
  }
}

/**
 * Create external ticket for escalation
 */
export async function createTicket(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = escalationIdParamSchema.parse(request.params);
  const input = createExternalTicketSchema.parse(request.body);
  const tenantId = request.tenant!.id;

  try {
    const result = await escalationService.createEscalationTicket(tenantId, id, input);
    return reply.status(201).send({ success: true, data: result });
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
    if (error.message.includes('Unsupported ticketing system')) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'UNSUPPORTED_SYSTEM',
          message: error.message,
        },
      });
    }
    throw error;
  }
}
