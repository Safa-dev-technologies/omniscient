import { FastifyRequest, FastifyReply } from 'fastify';
import * as tenantService from './tenant.service.js';
import { checkTenantAccess } from './tenant.auth.js';
import {
  createTenantSchema,
  updateTenantSchema,
  listTenantsSchema,
  createApiKeySchema,
  tenantIdParamSchema,
  apiKeyIdParamSchema,
} from './tenant.schema.js';

/**
 * Create tenant (Master key only)
 */
export async function createTenant(request: FastifyRequest, reply: FastifyReply) {
  const input = createTenantSchema.parse(request.body);

  try {
    const result = await tenantService.createTenant(input);
    return reply.status(201).send({ success: true, data: result });
  } catch (error: any) {
    if (error.message === 'Slug is reserved and cannot be used') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }
    if (error.message === 'Tenant with this slug already exists') {
      return reply.status(409).send({
        success: false,
        error: { code: 'CONFLICT', message: error.message },
      });
    }
    throw error;
  }
}

/**
 * List tenants (Master key only)
 */
export async function listTenants(request: FastifyRequest, reply: FastifyReply) {
  const input = listTenantsSchema.parse(request.query);
  const result = await tenantService.listTenants(input);
  return reply.send({ success: true, data: result });
}

/**
 * Get tenant details (Master key OR tenant key with admin permission)
 */
export async function getTenant(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = tenantIdParamSchema.parse(request.params);

  // Check authorization
  const { authorized } = checkTenantAccess(request, reply, id);
  if (!authorized) return;

  const tenant = await tenantService.getTenant(id);

  if (!tenant) {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Tenant not found' },
    });
  }

  return reply.send({ success: true, data: tenant });
}

/**
 * Update tenant (Master key OR tenant key with admin permission)
 */
export async function updateTenant(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = tenantIdParamSchema.parse(request.params);
  const input = updateTenantSchema.parse(request.body);

  // Check authorization
  const { authorized } = checkTenantAccess(request, reply, id);
  if (!authorized) return;

  try {
    const tenant = await tenantService.updateTenant(id, input);
    return reply.send({ success: true, data: tenant });
  } catch (error: any) {
    if (error.message === 'Tenant not found' || error.message === 'Cannot update deleted tenant') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Delete tenant (Master key only)
 */
export async function deleteTenant(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = tenantIdParamSchema.parse(request.params);

  try {
    const result = await tenantService.deleteTenant(id);
    return reply.send({ success: true, data: result });
  } catch (error: any) {
    if (error.message === 'Tenant not found' || error.message === 'Tenant already deleted') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Create API key (Master key OR tenant key with admin permission)
 */
export async function createApiKey(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = tenantIdParamSchema.parse(request.params);
  const input = createApiKeySchema.parse(request.body);

  // Check authorization
  const { authorized } = checkTenantAccess(request, reply, id);
  if (!authorized) return;

  try {
    const apiKey = await tenantService.createApiKey(id, input);
    return reply.status(201).send({ success: true, data: apiKey });
  } catch (error: any) {
    if (error.message === 'Tenant not found') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    if (error.message === 'Cannot create API key for deleted tenant') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }
    throw error;
  }
}

/**
 * List API keys (Master key OR tenant key with admin permission)
 */
export async function listApiKeys(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const { id } = tenantIdParamSchema.parse(request.params);

  // Check authorization
  const { authorized } = checkTenantAccess(request, reply, id);
  if (!authorized) return;

  try {
    const apiKeys = await tenantService.listApiKeys(id);
    return reply.send({ success: true, data: { apiKeys } });
  } catch (error: any) {
    if (error.message === 'Tenant not found') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    throw error;
  }
}

/**
 * Revoke API key (Master key OR tenant key with admin permission)
 */
export async function revokeApiKey(
  request: FastifyRequest<{ Params: { id: string; keyId: string } }>,
  reply: FastifyReply
) {
  const { id, keyId } = apiKeyIdParamSchema.parse(request.params);

  // Check authorization
  const { authorized } = checkTenantAccess(request, reply, id);
  if (!authorized) return;

  try {
    const result = await tenantService.revokeApiKey(id, keyId);
    return reply.send({ success: true, data: result });
  } catch (error: any) {
    if (error.message === 'Cannot revoke the last admin API key') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message },
      });
    }
    if (error.message === 'API key not found') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    throw error;
  }
}
