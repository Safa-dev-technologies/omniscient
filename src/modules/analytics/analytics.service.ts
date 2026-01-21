import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import type { DateRangeQuery } from './analytics.schema.js';
import { getDefaultDateRange } from './analytics.schema.js';

/**
 * Cache TTL in seconds (5 minutes)
 */
const CACHE_TTL = 300;

/**
 * Generate cache key for analytics queries
 */
function getCacheKey(tenantId: string, endpoint: string, query: DateRangeQuery): string {
  const from = query.from?.toISOString() || 'default';
  const to = query.to?.toISOString() || 'default';
  return `analytics:${tenantId}:${endpoint}:${from}:${to}:${query.interval}`;
}

/**
 * Get cached data or compute and cache
 */
async function getCachedOrCompute<T>(key: string, computeFn: () => Promise<T>): Promise<T> {
  try {
    // Try to get from cache
    const cached = await redis.get(key);
    if (cached) {
      logger.debug({ key }, 'Analytics cache hit');
      return JSON.parse(cached) as T;
    }

    // Compute if not in cache
    logger.debug({ key }, 'Analytics cache miss, computing');
    const result = await computeFn();

    // Store in cache
    await redis.setex(key, CACHE_TTL, JSON.stringify(result));

    return result;
  } catch (error) {
    logger.error({ error, key }, 'Analytics cache error, computing without cache');
    // If cache fails, just compute without caching
    return computeFn();
  }
}

/**
 * Get overview metrics
 */
export async function getOverview(tenantId: string, query: DateRangeQuery) {
  const { from, to } = query.from && query.to ? query : getDefaultDateRange();
  const cacheKey = getCacheKey(tenantId, 'overview', query);

  return getCachedOrCompute(cacheKey, async () => {
    // Run all queries in parallel
    const [
      totalConversations,
      activeConversations,
      totalMessages,
      escalationCount,
      knowledgeSources,
      avgResponseTime,
    ] = await Promise.all([
      // Total conversations in date range
      prisma.conversation.count({
        where: {
          tenantId,
          startedAt: { gte: from, lte: to },
        },
      }),

      // Active conversations (not closed)
      prisma.conversation.count({
        where: {
          tenantId,
          status: { notIn: ['CLOSED'] },
        },
      }),

      // Total messages in date range
      prisma.message.count({
        where: {
          conversation: { tenantId },
          createdAt: { gte: from, lte: to },
        },
      }),

      // Escalations in date range
      prisma.escalation.count({
        where: {
          conversation: { tenantId },
          createdAt: { gte: from, lte: to },
        },
      }),

      // Knowledge sources (indexed)
      prisma.knowledgeSource.count({
        where: {
          tenantId,
          status: 'INDEXED',
        },
      }),

      // Average response time (bot messages only)
      prisma.$queryRaw<Array<{ avg: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (m."createdAt" - prev."createdAt"))) as avg
        FROM "Message" m
        INNER JOIN "Conversation" c ON m."conversationId" = c.id
        INNER JOIN LATERAL (
          SELECT "createdAt"
          FROM "Message" m2
          WHERE m2."conversationId" = m."conversationId"
            AND m2."createdAt" < m."createdAt"
            AND m2.role = 'USER'
          ORDER BY m2."createdAt" DESC
          LIMIT 1
        ) prev ON true
        WHERE c."tenantId" = ${tenantId}
          AND m.role = 'ASSISTANT'
          AND m."createdAt" >= ${from}
          AND m."createdAt" <= ${to}
      `.then((result) => result[0]?.avg || null),
    ]);

    return {
      totalConversations,
      activeConversations,
      totalMessages,
      escalationCount,
      knowledgeSources,
      avgResponseTime: avgResponseTime ? Math.round(avgResponseTime) : null,
      dateRange: { from, to },
    };
  });
}

/**
 * Time series result type for conversation queries
 */
type TimeSeriesRow = { date: Date; count: bigint; status: string };

/**
 * Get conversation time series by interval using parameterized queries
 * Each interval has its own query to avoid $queryRawUnsafe
 */
async function getTimeSeriesByInterval(
  tenantId: string,
  from: Date,
  to: Date,
  interval: 'hour' | 'day' | 'week' | 'month'
): Promise<TimeSeriesRow[]> {
  switch (interval) {
    case 'hour':
      return prisma.$queryRaw<TimeSeriesRow[]>`
        SELECT
          date_trunc('hour', "startedAt") as date,
          status,
          COUNT(*)::bigint as count
        FROM "Conversation"
        WHERE "tenantId" = ${tenantId}
          AND "startedAt" >= ${from}
          AND "startedAt" <= ${to}
        GROUP BY date_trunc('hour', "startedAt"), status
        ORDER BY date_trunc('hour', "startedAt") ASC
      `;
    case 'week':
      return prisma.$queryRaw<TimeSeriesRow[]>`
        SELECT
          date_trunc('week', "startedAt") as date,
          status,
          COUNT(*)::bigint as count
        FROM "Conversation"
        WHERE "tenantId" = ${tenantId}
          AND "startedAt" >= ${from}
          AND "startedAt" <= ${to}
        GROUP BY date_trunc('week', "startedAt"), status
        ORDER BY date_trunc('week', "startedAt") ASC
      `;
    case 'month':
      return prisma.$queryRaw<TimeSeriesRow[]>`
        SELECT
          date_trunc('month', "startedAt") as date,
          status,
          COUNT(*)::bigint as count
        FROM "Conversation"
        WHERE "tenantId" = ${tenantId}
          AND "startedAt" >= ${from}
          AND "startedAt" <= ${to}
        GROUP BY date_trunc('month', "startedAt"), status
        ORDER BY date_trunc('month', "startedAt") ASC
      `;
    case 'day':
    default:
      return prisma.$queryRaw<TimeSeriesRow[]>`
        SELECT
          date_trunc('day', "startedAt") as date,
          status,
          COUNT(*)::bigint as count
        FROM "Conversation"
        WHERE "tenantId" = ${tenantId}
          AND "startedAt" >= ${from}
          AND "startedAt" <= ${to}
        GROUP BY date_trunc('day', "startedAt"), status
        ORDER BY date_trunc('day', "startedAt") ASC
      `;
  }
}

/**
 * Get conversation time series data
 */
export async function getConversationTimeSeries(tenantId: string, query: DateRangeQuery) {
  const dateRange =
    query.from && query.to ? { from: query.from, to: query.to } : getDefaultDateRange();
  const cacheKey = getCacheKey(tenantId, 'conversations', query);

  return getCachedOrCompute(cacheKey, async () => {
    const result = await getTimeSeriesByInterval(
      tenantId,
      dateRange.from,
      dateRange.to,
      query.interval
    );

    // Transform BigInt to Number for JSON serialization
    const data = result.map((row) => ({
      date: row.date,
      status: row.status,
      count: Number(row.count),
    }));

    return {
      data,
      interval: query.interval,
      dateRange,
    };
  });
}

/**
 * Get channel breakdown
 */
export async function getChannelBreakdown(tenantId: string, query: DateRangeQuery) {
  const { from, to } = query.from && query.to ? query : getDefaultDateRange();
  const cacheKey = getCacheKey(tenantId, 'channels', query);

  return getCachedOrCompute(cacheKey, async () => {
    const result = await prisma.$queryRaw<
      Array<{ channel: string; count: bigint; messages: bigint }>
    >`
      SELECT
        c.channel,
        COUNT(DISTINCT c.id)::bigint as count,
        COUNT(m.id)::bigint as messages
      FROM "Conversation" c
      LEFT JOIN "Message" m ON m."conversationId" = c.id
      WHERE c."tenantId" = ${tenantId}
        AND c."startedAt" >= ${from}
        AND c."startedAt" <= ${to}
      GROUP BY c.channel
      ORDER BY count DESC
    `;

    const data = result.map((row) => ({
      channel: row.channel,
      conversations: Number(row.count),
      messages: Number(row.messages),
    }));

    return {
      data,
      dateRange: { from, to },
    };
  });
}

/**
 * Get escalation metrics
 */
export async function getEscalationMetrics(tenantId: string, query: DateRangeQuery) {
  const { from, to } = query.from && query.to ? query : getDefaultDateRange();
  const cacheKey = getCacheKey(tenantId, 'escalations', query);

  return getCachedOrCompute(cacheKey, async () => {
    const [byReason, byStatus, avgResolutionTime] = await Promise.all([
      // Escalations by reason
      prisma.$queryRaw<Array<{ reason: string; count: bigint }>>`
        SELECT
          e.reason,
          COUNT(*)::bigint as count
        FROM "Escalation" e
        INNER JOIN "Conversation" c ON e."conversationId" = c.id
        WHERE c."tenantId" = ${tenantId}
          AND e."createdAt" >= ${from}
          AND e."createdAt" <= ${to}
        GROUP BY e.reason
        ORDER BY count DESC
      `,

      // Escalation resolution status
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT
          CASE
            WHEN e."resolvedAt" IS NOT NULL THEN 'resolved'
            ELSE 'pending'
          END as status,
          COUNT(*)::bigint as count
        FROM "Escalation" e
        INNER JOIN "Conversation" c ON e."conversationId" = c.id
        WHERE c."tenantId" = ${tenantId}
          AND e."createdAt" >= ${from}
          AND e."createdAt" <= ${to}
        GROUP BY CASE WHEN e."resolvedAt" IS NOT NULL THEN 'resolved' ELSE 'pending' END
      `,

      // Average resolution time (in seconds)
      prisma.$queryRaw<Array<{ avg: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (e."resolvedAt" - e."createdAt"))) as avg
        FROM "Escalation" e
        INNER JOIN "Conversation" c ON e."conversationId" = c.id
        WHERE c."tenantId" = ${tenantId}
          AND e."resolvedAt" IS NOT NULL
          AND e."createdAt" >= ${from}
          AND e."createdAt" <= ${to}
      `.then((result) => result[0]?.avg || null),
    ]);

    return {
      byReason: byReason.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
      avgResolutionTime: avgResolutionTime ? Math.round(avgResolutionTime) : null,
      dateRange: { from, to },
    };
  });
}

/**
 * Get knowledge source statistics
 */
export async function getKnowledgeStats(tenantId: string, query: DateRangeQuery) {
  const { from, to } = query.from && query.to ? query : getDefaultDateRange();
  const cacheKey = getCacheKey(tenantId, 'knowledge', query);

  return getCachedOrCompute(cacheKey, async () => {
    const [byType, byStatus, totalChunks, avgChunksPerSource] = await Promise.all([
      // Sources by type
      prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
        SELECT
          type,
          COUNT(*)::bigint as count
        FROM "KnowledgeSource"
        WHERE "tenantId" = ${tenantId}
          AND "uploadedAt" >= ${from}
          AND "uploadedAt" <= ${to}
        GROUP BY type
        ORDER BY count DESC
      `,

      // Sources by status
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT
          status,
          COUNT(*)::bigint as count
        FROM "KnowledgeSource"
        WHERE "tenantId" = ${tenantId}
        GROUP BY status
      `,

      // Total chunks
      prisma.knowledgeChunk.count({
        where: {
          source: {
            tenantId,
            uploadedAt: { gte: from, lte: to },
          },
        },
      }),

      // Average chunks per source
      prisma.$queryRaw<Array<{ avg: number | null }>>`
        SELECT AVG("chunkCount") as avg
        FROM "KnowledgeSource"
        WHERE "tenantId" = ${tenantId}
          AND "uploadedAt" >= ${from}
          AND "uploadedAt" <= ${to}
          AND "chunkCount" > 0
      `.then((result) => result[0]?.avg || null),
    ]);

    return {
      byType: byType.map((row) => ({
        type: row.type,
        count: Number(row.count),
      })),
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
      totalChunks,
      avgChunksPerSource: avgChunksPerSource ? Math.round(avgChunksPerSource) : null,
      dateRange: { from, to },
    };
  });
}
