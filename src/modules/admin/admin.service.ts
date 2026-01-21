import { prisma } from '../../lib/prisma.js';
import {
  documentQueue,
  embeddingQueue,
  crawlQueue,
  syncQueue,
  deadLetterQueue,
} from '../../jobs/queue.js';

/**
 * Platform-wide statistics
 */
export interface PlatformStats {
  tenants: {
    total: number;
    active: number;
    inactive: number;
  };
  conversations: {
    total: number;
    last24h: number;
    last7d: number;
    last30d: number;
  };
  messages: {
    total: number;
    last24h: number;
    last7d: number;
    last30d: number;
  };
  knowledgeSources: {
    total: number;
    indexed: number;
    processing: number;
    failed: number;
  };
  system: {
    documentQueueDepth: number;
    embeddingQueueDepth: number;
    crawlQueueDepth: number;
    syncQueueDepth: number;
    deadLetterQueueDepth: number;
  };
}

/**
 * Tenant health metrics
 */
export interface TenantHealth {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  status: 'healthy' | 'warning' | 'critical';
  metrics: {
    failedJobsCount: number;
    errorRate: number; // Percentage
    lastActivity: string | null; // ISO string
    conversationCount: number;
    knowledgeSourceCount: number;
    indexedSourceCount: number;
    failedSourceCount: number;
  };
}

/**
 * Detailed tenant statistics
 */
export interface TenantStats {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  createdAt: Date;
  stats: {
    conversations: {
      total: number;
      active: number;
      escalated: number;
      closed: number;
    };
    messages: {
      total: number;
      last24h: number;
      last7d: number;
      last30d: number;
    };
    knowledgeSources: {
      total: number;
      indexed: number;
      processing: number;
      failed: number;
      byType: Record<string, number>;
    };
    apiKeys: {
      total: number;
      active: number;
    };
  };
  health: {
    failedJobs: number;
    errorRate: number;
    lastActivity: string | null;
  };
}

/**
 * Get platform-wide statistics
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch all stats in parallel
  const [
    totalTenants,
    activeTenants,
    totalConversations,
    conversations24h,
    conversations7d,
    conversations30d,
    totalMessages,
    messages24h,
    messages7d,
    messages30d,
    totalKnowledgeSources,
    indexedSources,
    processingSources,
    failedSources,
    documentQueueDepth,
    embeddingQueueDepth,
    crawlQueueDepth,
    syncQueueDepth,
    deadLetterQueueDepth,
  ] = await Promise.all([
    // Tenant counts
    prisma.tenant.count(),
    prisma.tenant.count({
      where: {
        conversations: {
          some: {
            lastActivityAt: {
              gte: last30d,
            },
          },
        },
      },
    }),

    // Conversation counts
    prisma.conversation.count(),
    prisma.conversation.count({ where: { startedAt: { gte: last24h } } }),
    prisma.conversation.count({ where: { startedAt: { gte: last7d } } }),
    prisma.conversation.count({ where: { startedAt: { gte: last30d } } }),

    // Message counts
    prisma.message.count(),
    prisma.message.count({ where: { createdAt: { gte: last24h } } }),
    prisma.message.count({ where: { createdAt: { gte: last7d } } }),
    prisma.message.count({ where: { createdAt: { gte: last30d } } }),

    // Knowledge source counts
    prisma.knowledgeSource.count(),
    prisma.knowledgeSource.count({ where: { status: 'INDEXED' } }),
    prisma.knowledgeSource.count({
      where: {
        status: {
          in: ['PENDING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'],
        },
      },
    }),
    prisma.knowledgeSource.count({ where: { status: 'FAILED' } }),

    // Queue depths
    documentQueue.count(),
    embeddingQueue.count(),
    crawlQueue.count(),
    syncQueue.count(),
    deadLetterQueue.count(),
  ]);

  return {
    tenants: {
      total: totalTenants,
      active: activeTenants,
      inactive: totalTenants - activeTenants,
    },
    conversations: {
      total: totalConversations,
      last24h: conversations24h,
      last7d: conversations7d,
      last30d: conversations30d,
    },
    messages: {
      total: totalMessages,
      last24h: messages24h,
      last7d: messages7d,
      last30d: messages30d,
    },
    knowledgeSources: {
      total: totalKnowledgeSources,
      indexed: indexedSources,
      processing: processingSources,
      failed: failedSources,
    },
    system: {
      documentQueueDepth,
      embeddingQueueDepth,
      crawlQueueDepth,
      syncQueueDepth,
      deadLetterQueueDepth,
    },
  };
}

/**
 * Get health metrics for all tenants or a specific tenant
 */
export async function getTenantHealthMetrics(tenantId?: string): Promise<TenantHealth[]> {
  const now = new Date();

  // Build where clause
  const where = tenantId ? { id: tenantId } : {};

  // Fetch all tenants with their related data
  const tenants = await prisma.tenant.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      conversations: {
        select: {
          id: true,
          lastActivityAt: true,
        },
        orderBy: {
          lastActivityAt: 'desc',
        },
        take: 1,
      },
      knowledgeSources: {
        select: {
          status: true,
        },
      },
      _count: {
        select: {
          conversations: true,
        },
      },
    },
  });

  // Calculate health metrics for each tenant
  const healthMetrics: TenantHealth[] = tenants.map((tenant) => {
    const failedSources = tenant.knowledgeSources.filter(
      (source) => source.status === 'FAILED'
    ).length;
    const indexedSources = tenant.knowledgeSources.filter(
      (source) => source.status === 'INDEXED'
    ).length;
    const totalSources = tenant.knowledgeSources.length;

    // Calculate error rate (percentage of failed sources)
    const errorRate = totalSources > 0 ? (failedSources / totalSources) * 100 : 0;

    // Last activity
    const lastActivity = tenant.conversations[0]?.lastActivityAt || null;

    // Determine health status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (failedSources > 5 || errorRate > 20) {
      status = 'critical';
    } else if (failedSources > 0 || errorRate > 5) {
      status = 'warning';
    }

    // Check for stale activity (no activity in last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (lastActivity && lastActivity < thirtyDaysAgo) {
      status = 'warning';
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      status,
      metrics: {
        failedJobsCount: failedSources,
        errorRate: Math.round(errorRate * 100) / 100,
        lastActivity: lastActivity ? lastActivity.toISOString() : null, // Serialize to ISO string
        conversationCount: tenant._count.conversations,
        knowledgeSourceCount: totalSources,
        indexedSourceCount: indexedSources,
        failedSourceCount: failedSources,
      },
    };
  });

  return healthMetrics;
}

/**
 * Get detailed statistics for a specific tenant
 */
export async function getTenantStats(tenantId: string): Promise<TenantStats | null> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch tenant with all related data
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      conversations: {
        select: {
          id: true,
          status: true,
          lastActivityAt: true,
        },
      },
      knowledgeSources: {
        select: {
          status: true,
          type: true,
        },
      },
      apiKeys: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!tenant) {
    return null;
  }

  // Count messages for this tenant
  const [totalMessages, messages24h, messages7d, messages30d] = await Promise.all([
    prisma.message.count({
      where: {
        conversation: {
          tenantId,
        },
      },
    }),
    prisma.message.count({
      where: {
        conversation: {
          tenantId,
        },
        createdAt: { gte: last24h },
      },
    }),
    prisma.message.count({
      where: {
        conversation: {
          tenantId,
        },
        createdAt: { gte: last7d },
      },
    }),
    prisma.message.count({
      where: {
        conversation: {
          tenantId,
        },
        createdAt: { gte: last30d },
      },
    }),
  ]);

  // Calculate conversation stats
  const activeConversations = tenant.conversations.filter(
    (conv) => conv.status === 'BOT_ACTIVE' || conv.status === 'HUMAN_ACTIVE'
  ).length;
  const escalatedConversations = tenant.conversations.filter(
    (conv) => conv.status === 'ESCALATED'
  ).length;
  const closedConversations = tenant.conversations.filter(
    (conv) => conv.status === 'CLOSED'
  ).length;

  // Calculate knowledge source stats
  const indexedSources = tenant.knowledgeSources.filter(
    (source) => source.status === 'INDEXED'
  ).length;
  const processingSources = tenant.knowledgeSources.filter((source) =>
    ['PENDING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'].includes(source.status)
  ).length;
  const failedSources = tenant.knowledgeSources.filter(
    (source) => source.status === 'FAILED'
  ).length;

  // Count sources by type
  const sourcesByType: Record<string, number> = {};
  tenant.knowledgeSources.forEach((source) => {
    sourcesByType[source.type] = (sourcesByType[source.type] || 0) + 1;
  });

  // Calculate API key stats
  // All existing API keys are active (revoked keys are deleted, not marked)
  const activeApiKeys = tenant.apiKeys.length;

  // Calculate health metrics
  const totalSources = tenant.knowledgeSources.length;
  const errorRate = totalSources > 0 ? (failedSources / totalSources) * 100 : 0;
  const lastActivity =
    tenant.conversations.reduce(
      (latest, conv) => {
        if (!conv.lastActivityAt) return latest;
        if (!latest || conv.lastActivityAt > latest) return conv.lastActivityAt;
        return latest;
      },
      null as Date | null
    ) || null;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    createdAt: tenant.createdAt,
    stats: {
      conversations: {
        total: tenant.conversations.length,
        active: activeConversations,
        escalated: escalatedConversations,
        closed: closedConversations,
      },
      messages: {
        total: totalMessages,
        last24h: messages24h,
        last7d: messages7d,
        last30d: messages30d,
      },
      knowledgeSources: {
        total: totalSources,
        indexed: indexedSources,
        processing: processingSources,
        failed: failedSources,
        byType: sourcesByType,
      },
      apiKeys: {
        total: tenant.apiKeys.length,
        active: activeApiKeys,
      },
    },
    health: {
      failedJobs: failedSources,
      errorRate: Math.round(errorRate * 100) / 100,
      lastActivity: lastActivity ? lastActivity.toISOString() : null,
    },
  };
}
