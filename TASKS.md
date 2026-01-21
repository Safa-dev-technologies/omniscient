# Omniscient - Task Board

**Last Updated:** 2026-01-20
**Current Phase:** Phase 4 (Admin Dashboard)

---

## Quality Gates (ALL TASKS)

Before marking any task complete, verify:

- [ ] `pnpm tsc --noEmit` passes with 0 errors
- [ ] `pnpm lint` passes with 0 errors, 0 warnings
- [ ] No `any` types - use proper TypeScript typing
- [ ] All imports are used (no unused imports)
- [ ] Loading and error states handled in all components
- [ ] Forms have validation with error messages
- [ ] Console has no errors or warnings

---

## Completed Phases

- Phase 1: Foundation (MVP) ✅
- Phase 2: Channels ✅
- Phase 3: Knowledge Expansion ✅

---

## Phase 4: Admin Dashboard

**Goal:** Self-service tenant management

---

### TASK-011-A: Initialize Next.js Project
**Status:** Complete ✅ | **Depends on:** None

---

### TASK-011-B: Create API Client
**Status:** Complete ✅ | **Depends on:** TASK-011-A

---

### TASK-011-C: Auth and Layout
**Status:** Complete ✅ | **Depends on:** TASK-011-B

---

### TASK-013-A: Knowledge List Page
**Status:** Complete ✅ | **Depends on:** TASK-011-C

---

### TASK-013-B: Add Knowledge Modal
**Status:** Complete ✅ | **Depends on:** TASK-013-A

---

### TASK-013-C: Knowledge Detail Page
**Status:** Complete ✅ | **Depends on:** TASK-013-A

---

### TASK-014-A: Channels Page
**Status:** Complete ✅ | **Depends on:** TASK-011-C

---

### TASK-014-B: Channel Config Forms
**Status:** Complete ✅ | **Depends on:** TASK-014-A

---

### TASK-015-A: Conversations List
**Status:** Complete ✅ | **Depends on:** TASK-011-C

---

### TASK-015-B: Conversation Detail
**Status:** Complete ✅ | **Depends on:** TASK-015-A

**Files created:**
- `dashboard/src/app/(dashboard)/conversations/[id]/page.tsx` ✅
- `dashboard/src/components/conversations/MessageThread.tsx` ✅
- `dashboard/src/components/conversations/MessageBubble.tsx` ✅
- `dashboard/src/components/conversations/StatusActions.tsx` ✅
- `dashboard/src/components/conversations/UserSidebar.tsx` ✅

**Hooks (already existed in useConversations.ts):**
- `useConversation(id)` ✅
- `useConversationHistory(id)` ✅
- `useAllowedTransitions(id)` ✅
- `useTransitionStatus()` ✅

**Acceptance Criteria:**
- [x] Two-column layout: messages (main), user info (sidebar)
- [x] Messages displayed in chat bubble style
- [x] Auto-scroll to bottom of thread
- [x] User messages on right, bot on left
- [x] System messages centered and muted
- [x] Timestamp on each message
- [x] Status actions based on allowed transitions
- [x] Escalate button (if allowed)
- [x] Resolve/Close buttons (if allowed)
- [x] User sidebar with contact info
- [x] Back link to /conversations
- [x] Error handling for failed message history load

---

### TASK-016-PRE: Backend Analytics API
**Status:** Complete ✅ | **Priority:** P1 | **Depends on:** None (Backend Task)

**Overview:**
Create analytics endpoints that compute metrics server-side using SQL aggregations. Client-side aggregation is not scalable.

**Files to create:**
```
src/modules/analytics/
├── analytics.routes.ts
├── analytics.controller.ts
├── analytics.service.ts
└── analytics.schema.ts
```

**Update:** `src/server.ts` - Register analytics routes

**API Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/analytics/overview` | Dashboard summary metrics |
| GET | `/v1/analytics/conversations` | Time-series conversation data |
| GET | `/v1/analytics/channels` | Breakdown by channel |
| GET | `/v1/analytics/escalations` | Escalation rate and resolution time |
| GET | `/v1/analytics/knowledge` | Knowledge source statistics |

**Query Parameters (all endpoints):**
```typescript
interface AnalyticsQuery {
  from?: string;  // ISO date, default: 30 days ago
  to?: string;    // ISO date, default: now
  interval?: 'day' | 'week' | 'month';  // for time-series
}
```

**Response Schemas:**

```typescript
// GET /v1/analytics/overview
interface OverviewResponse {
  conversations: {
    total: number;
    period: number;        // count in selected period
    previousPeriod: number; // for trend calculation
    byStatus: Record<ConversationStatus, number>;
  };
  messages: {
    total: number;
    period: number;
    avgPerConversation: number;
  };
  escalations: {
    total: number;
    rate: number;  // percentage
    avgResolutionMinutes: number | null;
  };
  knowledge: {
    sources: number;
    chunks: number;
    tokens: number;
  };
}

// GET /v1/analytics/conversations?interval=day
interface ConversationsTimeSeriesResponse {
  data: Array<{
    date: string;      // ISO date
    total: number;
    byChannel: Record<Channel, number>;
    byStatus: Record<ConversationStatus, number>;
  }>;
  summary: {
    total: number;
    avgPerDay: number;
  };
}

// GET /v1/analytics/channels
interface ChannelsResponse {
  data: Array<{
    channel: Channel;
    conversations: number;
    messages: number;
    percentage: number;
  }>;
}

// GET /v1/analytics/escalations
interface EscalationsResponse {
  total: number;
  rate: number;
  byReason: Record<EscalationReason, number>;
  avgResolutionMinutes: number | null;
  resolved: number;
  pending: number;
}

// GET /v1/analytics/knowledge
interface KnowledgeResponse {
  sources: {
    total: number;
    byType: Record<KnowledgeSourceType, number>;
    byStatus: Record<IndexStatus, number>;
  };
  chunks: {
    total: number;
    tokens: number;
  };
  recentActivity: Array<{
    sourceId: string;
    name: string;
    action: 'created' | 'updated' | 'reindexed';
    timestamp: string;
  }>;
}
```

**Service Implementation Notes:**

Use Prisma aggregations, NOT fetch-all-and-count:
```typescript
// GOOD - SQL aggregation
const byChannel = await prisma.conversation.groupBy({
  by: ['channel'],
  where: { tenantId, startedAt: { gte: from, lte: to } },
  _count: true,
});

// BAD - Fetching all records
const all = await prisma.conversation.findMany({ where: { tenantId } });
const byChannel = groupBy(all, 'channel'); // Don't do this!
```

**Caching Strategy:**
- Cache overview metrics in Redis (TTL: 5 minutes)
- Cache key: `analytics:${tenantId}:overview:${from}:${to}`
- Invalidate on conversation/escalation create

**Acceptance Criteria:**
- [ ] All 5 endpoints implemented with proper typing
- [ ] Uses SQL GROUP BY, not client-side aggregation
- [ ] Query parameters for date range filtering
- [ ] Tenant isolation enforced (all queries filter by tenantId)
- [ ] Response times < 500ms for typical data sizes
- [ ] Redis caching for overview endpoint
- [ ] Unit tests for analytics service

---

### TASK-016-A: Analytics Dashboard (Frontend)
**Status:** Complete ✅ | **Depends on:** TASK-016-PRE, TASK-011-C

**Files to create:**
- Update `dashboard/src/app/(dashboard)/page.tsx`
- `dashboard/src/components/analytics/MetricCard.tsx`
- `dashboard/src/components/analytics/ConversationChart.tsx`
- `dashboard/src/components/analytics/ChannelPieChart.tsx`
- `dashboard/src/components/analytics/DateRangePicker.tsx`
- `dashboard/src/hooks/useAnalytics.ts`

**Update API Client:** `dashboard/src/lib/api-client.ts`
```typescript
// Add analytics methods
async getAnalyticsOverview(query?: AnalyticsQuery): Promise<OverviewResponse>
async getConversationsTimeSeries(query?: AnalyticsQuery): Promise<ConversationsTimeSeriesResponse>
async getChannelsAnalytics(query?: AnalyticsQuery): Promise<ChannelsResponse>
async getEscalationsAnalytics(query?: AnalyticsQuery): Promise<EscalationsResponse>
async getKnowledgeAnalytics(): Promise<KnowledgeResponse>
```

**Hooks to create:**
```typescript
// useAnalytics.ts
useAnalyticsOverview(query?: AnalyticsQuery)
useConversationsTimeSeries(query?: AnalyticsQuery)
useChannelsAnalytics(query?: AnalyticsQuery)
```

**MetricCard Props:**
```typescript
interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: { value: number; isPositive: boolean };
}
```

**ConversationChart Props:**
```typescript
interface ConversationChartProps {
  data: Array<{ date: string; count: number }>;
  dateRange: { from: Date; to: Date };
}
// Line chart using Recharts
// X-axis: dates, Y-axis: conversation count
```

**ChannelPieChart Props:**
```typescript
interface ChannelPieChartProps {
  data: Array<{ channel: Channel; count: number; percentage: number }>;
}
// Pie chart using Recharts
// Legend showing channel names and counts
```

**DateRangePicker Props:**
```typescript
interface DateRangePickerProps {
  value: { from: Date; to: Date };
  onChange: (range: { from: Date; to: Date }) => void;
  presets: Array<{ label: string; days: number }>; // e.g., "7 days", "30 days"
}
```

**Metrics to Display:**
1. Total Conversations (with trend vs previous period)
2. Total Messages
3. Knowledge Sources count
4. Total Chunks indexed
5. Escalation Rate (%)
6. Conversations by Channel (pie chart)
7. Conversations over Time (line chart)

**Acceptance Criteria:**
- [ ] 4 metric cards at top (conversations, messages, sources, escalation rate)
- [ ] Date range picker with presets (7d, 30d, 90d)
- [ ] Line chart: conversations over time
- [ ] Pie chart: distribution by channel
- [ ] All charts responsive
- [ ] Loading states for each section
- [ ] Graceful handling if no data

---

### TASK-012-A: Onboarding Wizard
**Status:** Complete ✅ | **Depends on:** TASK-011-C

**Files to create:**
- `dashboard/src/components/onboarding/OnboardingWizard.tsx`
- `dashboard/src/components/onboarding/WelcomeStep.tsx`
- `dashboard/src/components/onboarding/UploadStep.tsx`
- `dashboard/src/components/onboarding/TestChatStep.tsx`
- `dashboard/src/components/onboarding/ChannelStep.tsx`
- `dashboard/src/app/(dashboard)/getting-started/page.tsx`
- `dashboard/src/hooks/useOnboarding.ts`

**OnboardingWizard Props:**
```typescript
interface OnboardingWizardProps {
  initialStep?: number;
  onComplete: () => void;
}
// Steps: 1. Welcome, 2. Upload, 3. Test Chat, 4. Channel (optional)
```

**Step Components:**
```typescript
interface StepProps {
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
}
```

**useOnboarding Hook:**
```typescript
interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  hasCompletedOnboarding: boolean;
}
// Persist to localStorage
// Check on dashboard load, redirect to /getting-started if not complete
```

**WelcomeStep Content:**
- Greeting with tenant name
- Brief explanation of steps
- "Get Started" button

**UploadStep Content:**
- Reuse UploadDropzone component from TASK-013-B
- Show success when first source uploaded
- Allow skip

**TestChatStep Content:**
- Simple chat interface
- Send test message to `/v1/chat` endpoint
- Show bot response
- "Continue" when at least one exchange complete

**ChannelStep Content:**
- Show channel options (Web, WhatsApp, Telegram)
- Link to configure each
- Allow skip (can configure later)

**Acceptance Criteria:**
- [ ] Progress indicator showing current step (1/4, 2/4, etc.)
- [ ] Back button on steps 2-4
- [ ] Skip button on steps 2-4
- [ ] Step 1: Welcome message with tenant name
- [ ] Step 2: File upload with success confirmation
- [ ] Step 3: Test chat with working bot response
- [ ] Step 4: Channel selection (optional)
- [ ] Completion saves to localStorage
- [ ] Redirect to dashboard on completion
- [ ] Don't show onboarding again after completion

---

## Task Dependencies

```
TASK-011-A ──→ TASK-011-B ──→ TASK-011-C ──┬─→ TASK-013-A ──→ TASK-013-B
                                           │              ──→ TASK-013-C
                                           ├─→ TASK-014-A ──→ TASK-014-B
                                           ├─→ TASK-015-A ──→ TASK-015-B
                                           ├─→ TASK-012-A
                                           │
TASK-016-PRE (Backend) ✅ ─────────────────┴─→ TASK-016-A (Frontend)
```

---

## Critical Issues (Priority Fixes)

These issues were identified during code review and should be addressed before production deployment.

---

### TASK-FIX-001: Add Error Boundary to Dashboard
**Status:** Complete ✅ | **Priority:** P0 - Critical | **Effort:** Small

**File to modify:**
- `dashboard/src/app/(dashboard)/layout.tsx`

**Problem:**
No error boundary exists for dashboard routes. Runtime errors crash the entire layout, leaving users with a blank page.

**Fix:**
- Create `dashboard/src/components/ErrorBoundary.tsx`
- Wrap dashboard layout children with ErrorBoundary
- Display user-friendly fallback UI with "Try Again" button

**Acceptance Criteria:**
- [ ] ErrorBoundary component created with fallback UI
- [ ] Dashboard layout wrapped with ErrorBoundary
- [ ] Runtime errors show fallback instead of blank page
- [ ] "Try Again" button resets error state

---

### TASK-FIX-002: Fix Unhandled Promise in AddSourceModal
**Status:** Complete ✅ | **Priority:** P0 - Critical | **Effort:** Small

**File to modify:**
- `dashboard/src/components/knowledge/AddSourceModal.tsx` (lines 29-46)

**Problem:**
Modal closes even when upload/crawl/connect fails because `mutateAsync` is not wrapped in try-catch.

```typescript
// Current (broken):
const handleUpload = async (file: File, name?: string) => {
  await uploadSource.mutateAsync(input);
  onOpenChange(false); // Executes even on error!
};
```

**Fix:**
- Wrap `mutateAsync` calls in try-catch
- Only close modal on success
- Error toast already handled by mutation hooks

**Acceptance Criteria:**
- [ ] All three handlers (upload, crawl, notion) have try-catch
- [ ] Modal only closes on successful operation
- [ ] Error toast displays on failure

---

### TASK-FIX-003: Secure API Key Storage
**Status:** Complete ✅ | **Priority:** P0 - Critical | **Effort:** Medium

**Files to modify:**
- `dashboard/src/lib/auth.ts`
- `dashboard/src/stores/auth.ts`
- `dashboard/src/middleware.ts` (create if needed)

**Problem:**
API keys stored in plain localStorage are vulnerable to XSS attacks.

```typescript
// Current (insecure):
localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
```

**Options (choose one):**
1. **httpOnly Cookie** (Recommended): Set cookie via API response, use middleware to attach to requests
2. **Encrypted localStorage**: Encrypt key before storage (less secure but simpler)
3. **Session-only storage**: Use sessionStorage instead (clears on tab close)

**Acceptance Criteria:**
- [ ] API key not accessible via `localStorage.getItem()` in browser console
- [ ] Authentication still works after page refresh
- [ ] Logout properly clears stored credentials

---

### TASK-FIX-004: Add Missing Error States
**Status:** Partial ✅ | **Priority:** P1 - High | **Effort:** Small

**Files to modify:**
- `dashboard/src/app/(dashboard)/conversations/[id]/page.tsx` ✅
- `dashboard/src/components/knowledge/NotionConnectForm.tsx`

**Problem:**
1. ~~Conversation detail page doesn't show error state when history fails to load~~ ✅ Fixed
2. Notion form doesn't validate API key format before submission

**Acceptance Criteria:**
- [x] Conversation history shows error state on fetch failure
- [ ] Notion API key validated client-side (starts with `secret_` or `ntn_`)
- [ ] Clear error messages displayed to user

---

### TASK-FIX-005: Remove Console Statements
**Status:** Open | **Priority:** P1 - High | **Effort:** Small

**Files to modify:**
- `dashboard/src/app/(auth)/login/page.tsx` (line 42)
- `dashboard/src/app/(dashboard)/channels/[type]/page.tsx` (line 102)
- `dashboard/src/stores/auth.ts` (line 92)

**Problem:**
`console.error` statements left in production code expose error details in browser console.

**Fix:**
- Remove console statements, or
- Replace with proper error logging service (e.g., Sentry)

**Acceptance Criteria:**
- [ ] No `console.log` or `console.error` in production code
- [ ] Errors still handled gracefully for users

---

### TASK-FIX-006: Add Pagination to Knowledge List
**Status:** Open | **Priority:** P1 - High | **Effort:** Medium

**Files to modify:**
- `dashboard/src/app/(dashboard)/knowledge/page.tsx`
- `dashboard/src/components/knowledge/SourceTable.tsx`

**Problem:**
Pagination not implemented - offset always 0, users can't navigate beyond first 50 sources.

```typescript
// Current:
query.limit = 50;
query.offset = 0; // Always 0!
```

**Fix:**
- Add pagination state (page number or offset)
- Add Previous/Next buttons or page numbers
- Use `data.total` and `data.hasMore` for navigation

**Acceptance Criteria:**
- [ ] Users can navigate to page 2, 3, etc.
- [ ] "Previous" disabled on first page
- [ ] "Next" disabled on last page
- [ ] Shows "Page X of Y" or similar indicator

---

### TASK-FIX-007: Add Performance Optimizations
**Status:** Open | **Priority:** P2 - Medium | **Effort:** Medium

**Files to modify:**
- `dashboard/src/app/(dashboard)/knowledge/page.tsx`
- `dashboard/src/components/knowledge/SourceTable.tsx`
- `dashboard/src/hooks/useConversations.ts`

**Problems:**
1. No `useMemo` on filtered sources - recalculates every render
2. Table rows not memoized - all re-render on any state change
3. Conversations poll every 5s even on background tabs

**Fixes:**
```typescript
// 1. Memoize filtering:
const filteredSources = useMemo(() =>
  sources.filter(...),
  [sources, searchQuery]
);

// 2. Memoize table rows:
const MemoizedRow = React.memo(SourceRow);

// 3. Only poll when visible:
refetchInterval: document.visibilityState === 'visible' ? 5000 : false,
```

**Acceptance Criteria:**
- [ ] Filtering uses `useMemo`
- [ ] Table rows use `React.memo`
- [ ] Polling pauses when tab is hidden

---

## Common Patterns

### React Query Hook Pattern
```typescript
// Query hook
export function useExample(id: string) {
  return useQuery({
    queryKey: ['example', id],
    queryFn: () => apiClient.getExample(id),
    enabled: !!id,
  });
}

// Mutation hook
export function useUpdateExample() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInput) => apiClient.updateExample(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['example'] });
      toast.success('Updated successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update');
    },
  });
}

// refetchInterval with proper typing (React Query v5)
refetchInterval: (query) => {
  const isProcessing = query.state.data?.status === 'PENDING';
  return isProcessing ? 3000 : false;
},
```

### Form Pattern with react-hook-form + zod
```typescript
const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Must be a valid URL'),
});

type FormData = z.infer<typeof schema>;

function MyForm() {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', url: '' },
  });

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* fields */}
    </form>
  );
}
```

---

## Security Issues (Priority Fixes)

These security vulnerabilities were identified during security audit and must be addressed before production deployment.

---

### TASK-SEC-001: Rotate Exposed API Keys
**Status:** Open | **Priority:** P0 - CRITICAL | **Effort:** Small

**Problem:**
Real API keys are exposed in `.env` file (may be in git history):
- Pinecone API key
- OpenAI API key
- Groq API key
- Encryption key
- Database credentials

**Immediate Actions:**
1. Rotate ALL API keys in respective dashboards (Pinecone, OpenAI, Groq)
2. Generate new ENCRYPTION_KEY: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Change database password
4. Remove `.env` from git history:
```bash
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .env' \
  --prune-empty --tag-name-filter cat -- --all
```

**Acceptance Criteria:**
- [ ] All API keys rotated
- [ ] New encryption key generated
- [ ] Database password changed
- [ ] `.env` removed from git history
- [ ] Verify `.env` is in `.gitignore`

---

### TASK-SEC-002: Add SSRF Protection (Private IP Blocking)
**Status:** Complete ✅ | **Priority:** P0 - CRITICAL | **Effort:** Medium

**Files to modify:**
- `src/modules/knowledge/processors/url.processor.ts`
- `src/modules/knowledge/crawlers/sitemap.parser.ts`

**Problem:**
URL crawling doesn't block private/internal IP addresses. Attackers can:
- Access AWS metadata: `http://169.254.169.254/latest/meta-data/`
- Scan internal network: `http://192.168.1.1/admin`
- Access localhost services: `http://127.0.0.1:5432`

**Fix:**
Create utility function to validate URLs:
```typescript
// src/utils/url-validator.ts
const BLOCKED_IP_RANGES = [
  /^127\./,                    // Loopback
  /^10\./,                     // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private Class B
  /^192\.168\./,               // Private Class C
  /^169\.254\./,               // Link-local
  /^0\./,                      // Current network
];

export async function isPrivateUrl(url: string): Promise<boolean> {
  const hostname = new URL(url).hostname;
  // Resolve DNS and check IP
  const addresses = await dns.promises.resolve4(hostname);
  return addresses.some(ip => BLOCKED_IP_RANGES.some(r => r.test(ip)));
}
```

**Acceptance Criteria:**
- [ ] Private IP ranges blocked (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- [ ] Link-local addresses blocked (169.254.0.0/16)
- [ ] DNS resolution checked (prevent DNS rebinding)
- [ ] Clear error message returned to user
- [ ] Unit tests for IP validation

---

### TASK-SEC-003: Fix ReDoS Vulnerability in Crawl Patterns
**Status:** Open | **Priority:** P0 - CRITICAL | **Effort:** Medium

**Files to modify:**
- `src/modules/knowledge/crawlers/crawl.manager.ts` (lines 290-359)
- `src/modules/knowledge/knowledge.schema.ts`

**Problem:**
User-supplied regex patterns in `includePatterns`/`excludePatterns` can cause catastrophic backtracking:
```typescript
const regex = new RegExp(pattern);  // pattern from user input!
```

Malicious patterns like `(a+)+b` can hang the worker indefinitely.

**Fix:**
1. Install `safe-regex` package: `pnpm add safe-regex`
2. Validate patterns before compilation:
```typescript
import safeRegex from 'safe-regex';

if (!safeRegex(pattern)) {
  throw new Error(`Unsafe regex pattern: ${pattern}`);
}
```
3. Add max length validation in schema:
```typescript
includePatterns: z.array(z.string().max(100)).max(10).optional(),
```

**Acceptance Criteria:**
- [ ] `safe-regex` validates all user patterns
- [ ] Pattern array limited to 10 items max
- [ ] Each pattern limited to 100 characters
- [ ] Clear error message for rejected patterns
- [ ] Unit tests for pattern validation

---

### TASK-SEC-004: Replace $queryRawUnsafe Usage
**Status:** Open | **Priority:** P1 - High | **Effort:** Medium

**File to modify:**
- `src/modules/analytics/analytics.service.ts` (line 163)

**Problem:**
Using `$queryRawUnsafe` is dangerous even with controlled input:
```typescript
${prisma.$queryRawUnsafe(truncateFunc)}
```

**Fix:**
Use separate queries per interval instead of dynamic SQL:
```typescript
// Instead of dynamic truncateFunc, use conditional queries
if (query.interval === 'hour') {
  return prisma.$queryRaw`SELECT date_trunc('hour', started_at) as date...`;
} else if (query.interval === 'day') {
  return prisma.$queryRaw`SELECT date_trunc('day', started_at) as date...`;
}
// etc.
```

Or use Prisma's groupBy with date formatting in application code.

**Acceptance Criteria:**
- [ ] No `$queryRawUnsafe` usage in codebase
- [ ] All SQL injection vectors eliminated
- [ ] Queries still performant
- [ ] Unit tests pass

---

### TASK-SEC-005: Fix Rate Limiting to Fail Closed
**Status:** Open | **Priority:** P1 - High | **Effort:** Small

**File to modify:**
- `src/webhooks/webhook.middleware.ts` (lines 174-218)

**Problem:**
Rate limiting fails open - if Redis is down, ALL requests are allowed:
```typescript
} catch (error) {
  logger.warn({ error }, 'Rate limit check failed, allowing request');
  return { allowed: true };  // DANGEROUS!
}
```

**Fix:**
```typescript
} catch (error) {
  logger.error({ error }, 'Rate limit check failed, blocking request');
  return { allowed: false, retryAfter: 60 };  // Fail closed
}
```

**Acceptance Criteria:**
- [ ] Rate limit errors return `allowed: false`
- [ ] Appropriate retry-after header set
- [ ] Error logged at ERROR level (not WARN)
- [ ] Consider in-memory fallback for Redis failures

---

### TASK-SEC-006: Add Per-Tenant Rate Limiting for Chat/Knowledge
**Status:** Open | **Priority:** P1 - High | **Effort:** Medium

**Files to modify:**
- `src/modules/chat/chat.routes.ts`
- `src/modules/knowledge/knowledge.routes.ts`

**Problem:**
Chat and knowledge endpoints only have global rate limiting (100/min per IP). A single tenant can overwhelm the system.

**Fix:**
Add tenant-specific rate limiting middleware:
```typescript
// Per-tenant limits
const TENANT_LIMITS = {
  chat: { max: 60, window: 60000 },      // 60 req/min
  upload: { max: 10, window: 60000 },    // 10 uploads/min
  crawl: { max: 5, window: 60000 },      // 5 crawls/min
};

async function tenantRateLimit(type: keyof typeof TENANT_LIMITS) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = `ratelimit:${type}:${request.tenant!.id}`;
    // Check Redis counter...
  };
}
```

**Acceptance Criteria:**
- [ ] Chat endpoint: 60 requests/minute per tenant
- [ ] Upload endpoint: 10 uploads/minute per tenant
- [ ] Crawl endpoint: 5 crawls/minute per tenant
- [ ] Returns 429 with Retry-After header
- [ ] Limits configurable via environment

---

### TASK-SEC-007: Add Input Validation for Escalation Reason
**Status:** Open | **Priority:** P2 - Medium | **Effort:** Small

**File to modify:**
- `src/modules/chat/chat.controller.ts` (line 61)
- `src/modules/chat/chat.schema.ts`

**Problem:**
Escalation reason is not validated - could be arbitrarily large or contain malicious content:
```typescript
const body = request.body as { reason?: string };  // No validation!
```

**Fix:**
Add Zod schema:
```typescript
// chat.schema.ts
export const escalateSchema = z.object({
  reason: z.string().max(500).optional(),
});

// chat.controller.ts
const body = escalateSchema.parse(request.body);
```

**Acceptance Criteria:**
- [ ] Reason field validated with Zod
- [ ] Max length: 500 characters
- [ ] Proper error message for validation failures

---

### TASK-SEC-008: Upgrade API Key Hashing
**Status:** Open | **Priority:** P2 - Medium | **Effort:** Medium

**File to modify:**
- `src/utils/hash.ts`
- Database migration required

**Problem:**
API keys hashed with simple SHA256 - no salt, no stretching:
```typescript
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
```

If database is compromised, rainbow table attacks are possible.

**Fix:**
Use bcrypt or Argon2 for API key hashing:
```typescript
import bcrypt from 'bcrypt';

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, 12);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}
```

**Note:** Requires migration strategy for existing keys.

**Acceptance Criteria:**
- [ ] bcrypt or Argon2 used for new API keys
- [ ] Migration plan for existing keys
- [ ] Auth middleware updated for async verification
- [ ] Performance tested (bcrypt is intentionally slow)

---

### TASK-SEC-009: Configure CORS Properly
**Status:** Open | **Priority:** P2 - Medium | **Effort:** Small

**File to modify:**
- `src/server.ts` (lines 31-34)

**Problem:**
CORS is too permissive in development and completely disabled in production:
```typescript
await server.register(cors, {
  origin: env.NODE_ENV === 'production' ? false : true,  // Bad!
  credentials: true,
});
```

**Fix:**
```typescript
await server.register(cors, {
  origin: env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3001',  // Dashboard dev
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
```

Add to env.ts:
```typescript
CORS_ORIGINS: z.string().optional(),  // Comma-separated list
```

**Acceptance Criteria:**
- [ ] Explicit origin whitelist in production
- [ ] CORS_ORIGINS configurable via environment
- [ ] Credentials only allowed for whitelisted origins

---

## Phase 5: Enterprise Features (Future)

| Task | Priority | Complexity |
|------|----------|------------|
| SSO integration | P4 | High |
| Advanced analytics | P4 | High |
| Webhook callbacks | P4 | Medium |
| Multi-language support | P4 | High |
| Audit logging | P4 | Medium |
| SLA monitoring | P4 | Medium |
