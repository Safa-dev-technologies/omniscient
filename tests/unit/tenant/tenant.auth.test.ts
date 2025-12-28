import { describe, it, expect } from 'vitest';
import { checkTenantAccess } from '../../../src/modules/tenant/tenant.auth.js';
import { mockFastifyRequest, mockFastifyReply } from '../../fixtures/tenant.fixtures.js';

describe('Tenant Auth', () => {
  describe('checkTenantAccess', () => {
    it('should allow master key access to any tenant', () => {
      const request = mockFastifyRequest({ isMasterKey: true }) as any;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, 'any-tenant-id');

      expect(result.authorized).toBe(true);
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow tenant key access to own tenant with admin permission', () => {
      const request = mockFastifyRequest() as any;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, request.tenant.id);

      expect(result.authorized).toBe(true);
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should deny access to different tenant', () => {
      const request = mockFastifyRequest() as any;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, 'different-tenant-id');

      expect(result.authorized).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error.code).toBe('FORBIDDEN');
    });

    it('should deny access without admin permission', () => {
      const request = mockFastifyRequest({
        apiKey: { id: 'key-id', permissions: { chat: true, knowledge: true, admin: false } },
      }) as any;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, request.tenant.id);

      expect(result.authorized).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error.message).toBe('Admin permission required');
    });

    it('should deny access when request.tenant is undefined', () => {
      const request = mockFastifyRequest() as any;
      request.tenant = undefined;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, 'some-tenant-id');

      expect(result.authorized).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error.code).toBe('FORBIDDEN');
    });

    it('should deny access when request.apiKey is undefined', () => {
      const request = mockFastifyRequest() as any;
      request.apiKey = undefined;
      const reply = mockFastifyReply();

      const result = checkTenantAccess(request, reply, request.tenant.id);

      expect(result.authorized).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error.message).toBe('Admin permission required');
    });
  });
});
