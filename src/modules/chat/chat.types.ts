export interface ChatRequest {
  message: string;
  sessionId?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  messageId: string;
  confidence: number;
  sources: Array<{
    name: string;
    section?: string;
  }>;
  shouldEscalate: boolean;
  escalationReason?: string;
}
