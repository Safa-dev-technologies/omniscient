import { FastifyRequest, FastifyReply } from 'fastify';

export function requirePermission(permission: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.apiKey) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const permissions = request.apiKey.permissions;

    if (!permissions[permission]) {
      reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Permission '${permission}' is required`,
        },
      });
      return;
    }
  };
}
