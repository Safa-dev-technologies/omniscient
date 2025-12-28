export interface BotGenerateParams {
  tenantId: string;
  tenant: {
    id: string;
    botName: string;
    systemPrompt: string | null;
    fallbackMessage: string | null;
  };
  conversationId: string;
  userMessage: string;
  history: Array<{
    role: string;
    content: string;
  }>;
}

export interface BotResponse {
  response: string;
  confidence: number;
  tokensUsed: number;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    chunkIndex: number;
    sectionTitle?: string;
    score: number;
  }>;
  shouldEscalate: boolean;
  escalationReason?: string;
}

export interface RetrievedContext {
  text: string;
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  sectionTitle?: string;
  score: number;
}
