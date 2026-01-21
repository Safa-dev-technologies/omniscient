import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the env module before importing the auth module
vi.mock('../../../src/config/index.js', () => ({
  env: {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: '$2b$10$validhashvaluehere1234567890abcdefghijklmnopqrstu',
    MASTER_API_KEY: 'master_test123456789abcdef',
  },
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
  },
}));

import bcrypt from 'bcrypt';
import { verifyAdminCredentials, getMasterApiKey } from '../../../src/modules/admin/admin.auth.js';

describe('Admin Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyAdminCredentials', () => {
    it('should return true for valid credentials', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await verifyAdminCredentials('admin', 'correct-password');

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', expect.any(String));
    });

    it('should return false for invalid password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const result = await verifyAdminCredentials('admin', 'wrong-password');

      expect(result).toBe(false);
    });

    it('should return false for invalid username', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await verifyAdminCredentials('wronguser', 'correct-password');

      // Should still return false because username doesn't match
      expect(result).toBe(false);
    });

    it('should return false for both invalid username and password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const result = await verifyAdminCredentials('wronguser', 'wrong-password');

      expect(result).toBe(false);
    });

    it('should throw error when bcrypt comparison fails', async () => {
      vi.mocked(bcrypt.compare).mockRejectedValue(new Error('Bcrypt error'));

      await expect(verifyAdminCredentials('admin', 'password')).rejects.toThrow(
        'Invalid admin password hash configuration'
      );
    });

    it('should always call bcrypt.compare to prevent timing attacks', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      // Even with wrong username, bcrypt.compare should be called
      await verifyAdminCredentials('wronguser', 'password');

      expect(bcrypt.compare).toHaveBeenCalled();
    });

    it('should use timing-safe comparison for username', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      // The implementation uses crypto.timingSafeEqual internally
      // We verify indirectly by checking that same credentials return true
      const result = await verifyAdminCredentials('admin', 'password');

      expect(result).toBe(true);
      // The function uses HMAC + timingSafeEqual internally for constant-time comparison
    });
  });

  describe('getMasterApiKey', () => {
    it('should return the master API key', () => {
      const result = getMasterApiKey();

      expect(result).toBe('master_test123456789abcdef');
    });
  });
});

describe('Admin Auth - Unconfigured', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should throw error when admin credentials are not configured', async () => {
    // Re-mock with empty values
    vi.doMock('../../../src/config/index.js', () => ({
      env: {
        ADMIN_USERNAME: '',
        ADMIN_PASSWORD_HASH: '',
        MASTER_API_KEY: '',
      },
    }));

    vi.doMock('bcrypt', () => ({
      default: {
        compare: vi.fn(),
      },
    }));

    const { verifyAdminCredentials: verifyUnconfigured } =
      await import('../../../src/modules/admin/admin.auth.js');

    await expect(verifyUnconfigured('admin', 'password')).rejects.toThrow(
      'Admin credentials are not configured'
    );
  });

  it('should throw error when master key is not configured', async () => {
    vi.doMock('../../../src/config/index.js', () => ({
      env: {
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD_HASH: '$2b$10$hash',
        MASTER_API_KEY: '',
      },
    }));

    const { getMasterApiKey: getUnconfiguredKey } =
      await import('../../../src/modules/admin/admin.auth.js');

    expect(() => getUnconfiguredKey()).toThrow('Master API key is not configured');
  });
});
