import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockTenantId,
  mockDateRange,
  mockOverviewData,
  mockConversationTimeSeriesData,
  mockChannelBreakdownData,
  mockEscalationMetricsData,
  mockKnowledgeStatsData,
  mockAnalyticsRequest,
  mockAnalyticsReply,
} from '../../fixtures/analytics.fixtures.js';

// Mock analytics service
vi.mock('../../../src/modules/analytics/analytics.service.js', () => ({
  getOverview: vi.fn(),
  getConversationTimeSeries: vi.fn(),
  getChannelBreakdown: vi.fn(),
  getEscalationMetrics: vi.fn(),
  getKnowledgeStats: vi.fn(),
}));

import * as analyticsService from '../../../src/modules/analytics/analytics.service.js';
import * as controller from '../../../src/modules/analytics/analytics.controller.js';

describe('Analytics Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOverview', () => {
    it('should return overview metrics', async () => {
      vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverviewData);

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getOverview(request as any, reply);

      expect(analyticsService.getOverview).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockOverviewData);
    });

    it('should parse date range from query', async () => {
      vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverviewData);

      const request = mockAnalyticsRequest({
        query: {
          from: '2024-01-01',
          to: '2024-01-31',
          interval: 'day',
        },
      });
      const reply = mockAnalyticsReply();

      await controller.getOverview(request as any, reply);

      expect(analyticsService.getOverview).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          from: expect.any(Date),
          to: expect.any(Date),
          interval: 'day',
        })
      );
    });

    it('should use default interval when not provided', async () => {
      vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverviewData);

      const request = mockAnalyticsRequest({
        query: {},
      });
      const reply = mockAnalyticsReply();

      await controller.getOverview(request as any, reply);

      expect(analyticsService.getOverview).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
    });

    it('should handle service errors', async () => {
      vi.mocked(analyticsService.getOverview).mockRejectedValue(new Error('Database error'));

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await expect(controller.getOverview(request as any, reply)).rejects.toThrow('Database error');
    });
  });

  describe('getConversationTimeSeries', () => {
    it('should return time series data', async () => {
      vi.mocked(analyticsService.getConversationTimeSeries).mockResolvedValue(
        mockConversationTimeSeriesData
      );

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getConversationTimeSeries(request as any, reply);

      expect(analyticsService.getConversationTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockConversationTimeSeriesData);
    });

    it('should support hour interval', async () => {
      vi.mocked(analyticsService.getConversationTimeSeries).mockResolvedValue({
        ...mockConversationTimeSeriesData,
        interval: 'hour',
      });

      const request = mockAnalyticsRequest({
        query: { interval: 'hour' },
      });
      const reply = mockAnalyticsReply();

      await controller.getConversationTimeSeries(request as any, reply);

      expect(analyticsService.getConversationTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'hour' })
      );
    });

    it('should support week interval', async () => {
      vi.mocked(analyticsService.getConversationTimeSeries).mockResolvedValue({
        ...mockConversationTimeSeriesData,
        interval: 'week',
      });

      const request = mockAnalyticsRequest({
        query: { interval: 'week' },
      });
      const reply = mockAnalyticsReply();

      await controller.getConversationTimeSeries(request as any, reply);

      expect(analyticsService.getConversationTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'week' })
      );
    });

    it('should support month interval', async () => {
      vi.mocked(analyticsService.getConversationTimeSeries).mockResolvedValue({
        ...mockConversationTimeSeriesData,
        interval: 'month',
      });

      const request = mockAnalyticsRequest({
        query: { interval: 'month' },
      });
      const reply = mockAnalyticsReply();

      await controller.getConversationTimeSeries(request as any, reply);

      expect(analyticsService.getConversationTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'month' })
      );
    });
  });

  describe('getChannelBreakdown', () => {
    it('should return channel breakdown data', async () => {
      vi.mocked(analyticsService.getChannelBreakdown).mockResolvedValue(mockChannelBreakdownData);

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getChannelBreakdown(request as any, reply);

      expect(analyticsService.getChannelBreakdown).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockChannelBreakdownData);
    });

    it('should parse custom date range', async () => {
      vi.mocked(analyticsService.getChannelBreakdown).mockResolvedValue(mockChannelBreakdownData);

      const request = mockAnalyticsRequest({
        query: {
          from: '2024-02-01',
          to: '2024-02-29',
        },
      });
      const reply = mockAnalyticsReply();

      await controller.getChannelBreakdown(request as any, reply);

      expect(analyticsService.getChannelBreakdown).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          from: expect.any(Date),
          to: expect.any(Date),
        })
      );
    });
  });

  describe('getEscalationMetrics', () => {
    it('should return escalation metrics', async () => {
      vi.mocked(analyticsService.getEscalationMetrics).mockResolvedValue(mockEscalationMetricsData);

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getEscalationMetrics(request as any, reply);

      expect(analyticsService.getEscalationMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockEscalationMetricsData);
    });

    it('should handle empty escalation data', async () => {
      vi.mocked(analyticsService.getEscalationMetrics).mockResolvedValue({
        byReason: [],
        byStatus: [],
        avgResolutionTime: null,
        dateRange: mockDateRange,
      });

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getEscalationMetrics(request as any, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.byReason).toHaveLength(0);
      expect(reply.body.data.avgResolutionTime).toBeNull();
    });
  });

  describe('getKnowledgeStats', () => {
    it('should return knowledge statistics', async () => {
      vi.mocked(analyticsService.getKnowledgeStats).mockResolvedValue(mockKnowledgeStatsData);

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getKnowledgeStats(request as any, reply);

      expect(analyticsService.getKnowledgeStats).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ interval: 'day' })
      );
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockKnowledgeStatsData);
    });

    it('should handle empty knowledge stats', async () => {
      vi.mocked(analyticsService.getKnowledgeStats).mockResolvedValue({
        byType: [],
        byStatus: [],
        totalChunks: 0,
        avgChunksPerSource: null,
        dateRange: mockDateRange,
      });

      const request = mockAnalyticsRequest();
      const reply = mockAnalyticsReply();

      await controller.getKnowledgeStats(request as any, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.byType).toHaveLength(0);
      expect(reply.body.data.totalChunks).toBe(0);
    });
  });

  describe('Tenant isolation', () => {
    it('should use tenant ID from request for all endpoints', async () => {
      const tenantId = 'different-tenant-id';
      vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverviewData);
      vi.mocked(analyticsService.getConversationTimeSeries).mockResolvedValue(
        mockConversationTimeSeriesData
      );
      vi.mocked(analyticsService.getChannelBreakdown).mockResolvedValue(mockChannelBreakdownData);
      vi.mocked(analyticsService.getEscalationMetrics).mockResolvedValue(mockEscalationMetricsData);
      vi.mocked(analyticsService.getKnowledgeStats).mockResolvedValue(mockKnowledgeStatsData);

      const request = mockAnalyticsRequest({
        tenant: { id: tenantId, name: 'Different Tenant' },
      });
      const reply = mockAnalyticsReply();

      await controller.getOverview(request as any, reply);
      expect(analyticsService.getOverview).toHaveBeenCalledWith(tenantId, expect.any(Object));

      await controller.getConversationTimeSeries(request as any, mockAnalyticsReply());
      expect(analyticsService.getConversationTimeSeries).toHaveBeenCalledWith(
        tenantId,
        expect.any(Object)
      );

      await controller.getChannelBreakdown(request as any, mockAnalyticsReply());
      expect(analyticsService.getChannelBreakdown).toHaveBeenCalledWith(
        tenantId,
        expect.any(Object)
      );

      await controller.getEscalationMetrics(request as any, mockAnalyticsReply());
      expect(analyticsService.getEscalationMetrics).toHaveBeenCalledWith(
        tenantId,
        expect.any(Object)
      );

      await controller.getKnowledgeStats(request as any, mockAnalyticsReply());
      expect(analyticsService.getKnowledgeStats).toHaveBeenCalledWith(tenantId, expect.any(Object));
    });
  });

  describe('Query validation', () => {
    it('should reject invalid interval', async () => {
      const request = mockAnalyticsRequest({
        query: { interval: 'invalid' },
      });
      const reply = mockAnalyticsReply();

      await expect(controller.getOverview(request as any, reply)).rejects.toThrow();
    });

    it('should coerce string dates to Date objects', async () => {
      vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverviewData);

      const request = mockAnalyticsRequest({
        query: {
          from: '2024-06-15T00:00:00.000Z',
          to: '2024-06-30T23:59:59.999Z',
        },
      });
      const reply = mockAnalyticsReply();

      await controller.getOverview(request as any, reply);

      const [, queryArg] = vi.mocked(analyticsService.getOverview).mock.calls[0];
      expect(queryArg.from).toBeInstanceOf(Date);
      expect(queryArg.to).toBeInstanceOf(Date);
    });
  });
});
