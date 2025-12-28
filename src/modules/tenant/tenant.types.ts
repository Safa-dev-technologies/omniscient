import type { TenantStatus } from '@prisma/client';

export interface TenantCreateResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
    botName: string;
    createdAt: Date;
  };
  apiKey: {
    id: string;
    key: string; // ONLY TIME the raw key is exposed
    keyPrefix: string;
    name: string;
    permissions: Record<string, boolean>;
    createdAt: Date;
  };
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  botName: string;
  monthlyMessageLimit: number;
  monthlyMessagesUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantDetails extends TenantListItem {
  systemPrompt: string | null;
  welcomeMessage: string | null;
  fallbackMessage: string | null;
  settings: Record<string, unknown> | null;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: Record<string, boolean>;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}
