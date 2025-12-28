declare module 'fastify' {
  interface FastifyRequest {
    tenant?: {
      id: string;
      slug: string;
      name: string;
      botName: string;
      systemPrompt: string | null;
      welcomeMessage: string | null;
      fallbackMessage: string | null;
      settings: Record<string, unknown> | null;
    };
    apiKey?: {
      id: string;
      permissions: Record<string, boolean>;
    };
    isMasterKey?: boolean;
  }
}

export {};
