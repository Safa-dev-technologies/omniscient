import { z } from 'zod';

/**
 * Date range query schema
 * Default: last 30 days
 */
export const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  interval: z.enum(['hour', 'day', 'week', 'month']).default('day'),
});

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

/**
 * Helper to get default date range (last 30 days)
 */
export function getDefaultDateRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from, to };
}
