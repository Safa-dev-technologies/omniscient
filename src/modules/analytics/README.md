# Analytics Module

Backend analytics API for the Omniscient dashboard.

## Endpoints

All endpoints require authentication via API key and are tenant-isolated.

### 1. Overview Metrics
```
GET /v1/analytics/overview?from=2024-01-01&to=2024-01-31&interval=day
```

Returns:
- Total conversations in date range
- Active conversations (not closed)
- Total messages
- Escalation count
- Knowledge sources (indexed)
- Average response time (seconds)

### 2. Conversation Time Series
```
GET /v1/analytics/conversations?from=2024-01-01&to=2024-01-31&interval=day
```

Returns time-series data grouped by status with configurable intervals (hour, day, week, month).

### 3. Channel Breakdown
```
GET /v1/analytics/channels?from=2024-01-01&to=2024-01-31
```

Returns conversation and message counts per channel (WEB, WHATSAPP, TELEGRAM).

### 4. Escalation Metrics
```
GET /v1/analytics/escalations?from=2024-01-01&to=2024-01-31
```

Returns:
- Escalations by reason
- Escalations by status (resolved/pending)
- Average resolution time (seconds)

### 5. Knowledge Statistics
```
GET /v1/analytics/knowledge?from=2024-01-01&to=2024-01-31
```

Returns:
- Sources by type (PDF, TXT, CSV, URL, NOTION)
- Sources by status
- Total chunks
- Average chunks per source

## Query Parameters

- `from` (optional): Start date (ISO 8601). Default: 30 days ago
- `to` (optional): End date (ISO 8601). Default: now
- `interval` (optional): Time grouping for time-series (hour, day, week, month). Default: day

## Performance

- All queries use SQL GROUP BY aggregations (not client-side)
- Redis caching with 5-minute TTL
- Tenant isolation on all queries
- Target response time: < 500ms

## Example Response

```json
{
  "success": true,
  "data": {
    "totalConversations": 1234,
    "activeConversations": 45,
    "totalMessages": 5678,
    "escalationCount": 12,
    "knowledgeSources": 89,
    "avgResponseTime": 3,
    "dateRange": {
      "from": "2024-01-01T00:00:00.000Z",
      "to": "2024-01-31T23:59:59.999Z"
    }
  }
}
```

## Cache Keys

Cache keys follow the pattern:
```
analytics:{tenantId}:{endpoint}:{from}:{to}:{interval}
```

Example:
```
analytics:tenant-123:overview:2024-01-01T00:00:00.000Z:2024-01-31T23:59:59.999Z:day
```

## Implementation Notes

- Uses Prisma for database queries
- Uses Redis for caching
- All BigInt values are converted to Number for JSON serialization
- Date truncation uses PostgreSQL's `date_trunc` function
- Average calculations handle NULL values gracefully
