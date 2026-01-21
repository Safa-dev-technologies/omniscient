import { FastifyRequest, FastifyReply } from 'fastify';
import * as analyticsService from './analytics.service.js';
import { dateRangeQuerySchema } from './analytics.schema.js';

/**
 * Get overview metrics
 * GET /v1/analytics/overview?from=2024-01-01&to=2024-01-31&interval=day
 */
export async function getOverview(request: FastifyRequest, reply: FastifyReply) {
  const query = dateRangeQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const data = await analyticsService.getOverview(tenantId, query);
  return reply.send({ success: true, data });
}

/**
 * Get conversation time series
 * GET /v1/analytics/conversations?from=2024-01-01&to=2024-01-31&interval=day
 */
export async function getConversationTimeSeries(request: FastifyRequest, reply: FastifyReply) {
  const query = dateRangeQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const data = await analyticsService.getConversationTimeSeries(tenantId, query);
  return reply.send({ success: true, data });
}

/**
 * Get channel breakdown
 * GET /v1/analytics/channels?from=2024-01-01&to=2024-01-31
 */
export async function getChannelBreakdown(request: FastifyRequest, reply: FastifyReply) {
  const query = dateRangeQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const data = await analyticsService.getChannelBreakdown(tenantId, query);
  return reply.send({ success: true, data });
}

/**
 * Get escalation metrics
 * GET /v1/analytics/escalations?from=2024-01-01&to=2024-01-31
 */
export async function getEscalationMetrics(request: FastifyRequest, reply: FastifyReply) {
  const query = dateRangeQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const data = await analyticsService.getEscalationMetrics(tenantId, query);
  return reply.send({ success: true, data });
}

/**
 * Get knowledge statistics
 * GET /v1/analytics/knowledge?from=2024-01-01&to=2024-01-31
 */
export async function getKnowledgeStats(request: FastifyRequest, reply: FastifyReply) {
  const query = dateRangeQuerySchema.parse(request.query);
  const tenantId = request.tenant!.id;

  const data = await analyticsService.getKnowledgeStats(tenantId, query);
  return reply.send({ success: true, data });
}
