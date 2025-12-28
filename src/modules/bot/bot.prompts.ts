export function buildSystemPrompt(params: {
  botName: string;
  customInstructions?: string | null;
  knowledgeContext?: string;
}): string {
  const { botName, customInstructions, knowledgeContext } = params;

  let prompt = `You are ${botName}, a helpful customer support assistant.

Your role:
- Answer questions using ONLY the provided knowledge base
- Be friendly, professional, and concise
- If you don't know the answer, say so honestly
- Never make up information

When responding:
- Keep answers concise (2-3 sentences when possible)
- Use bullet points for lists
- Offer to escalate to a human if the user seems frustrated or if you cannot help`;

  if (customInstructions) {
    prompt += `\n\nAdditional instructions:\n${customInstructions}`;
  }

  if (knowledgeContext) {
    prompt += `\n\nRelevant information from the knowledge base:\n---\n${knowledgeContext}\n---`;
  }

  return prompt;
}

export function buildFallbackResponse(fallbackMessage?: string | null): string {
  return (
    fallbackMessage ||
    "I'm sorry, I couldn't find relevant information to answer your question. Would you like me to connect you with a human agent?"
  );
}
