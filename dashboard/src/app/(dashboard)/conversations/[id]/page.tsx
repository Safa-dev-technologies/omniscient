'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConversationStatusBadge } from '@/components/conversations/ConversationStatusBadge';
import { MessageThread } from '@/components/conversations/MessageThread';
import { StatusActions } from '@/components/conversations/StatusActions';
import { UserSidebar } from '@/components/conversations/UserSidebar';
import {
  useConversation,
  useConversationHistory,
  useAllowedTransitions,
  useTransitionStatus,
} from '@/hooks/useConversations';
import type { ConversationStatus } from '@/types/api';

export default function ConversationDetailPage() {
  const params = useParams();
  const conversationId = params.id as string;

  const { data: conversation, isLoading: conversationLoading, error: conversationError } = useConversation(conversationId);
  const { data: messages, isLoading: messagesLoading, error: messagesError } = useConversationHistory(conversationId);
  const { data: transitionsData } = useAllowedTransitions(conversationId);
  const transitionMutation = useTransitionStatus();

  const allowedTransitions = (transitionsData?.allowed || []) as ConversationStatus[];

  const handleTransition = (status: ConversationStatus) => {
    transitionMutation.mutate({ conversationId, status });
  };

  // Loading state
  if (conversationLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-muted-foreground">Loading conversation...</div>
      </div>
    );
  }

  // Error state
  if (conversationError) {
    return (
      <div className="space-y-4">
        <Link href="/conversations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Conversations
          </Button>
        </Link>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Failed to load conversation: {conversationError instanceof Error ? conversationError.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  // Not found state
  if (!conversation) {
    return (
      <div className="space-y-4">
        <Link href="/conversations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Conversations
          </Button>
        </Link>
        <div className="rounded-lg border border-muted bg-muted/50 p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Conversation Not Found</h2>
          <p className="text-muted-foreground">
            The conversation you&apos;re looking for doesn&apos;t exist or has been deleted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-4">
          <Link href="/conversations">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">
              Conversation with {conversation.user?.displayName || 'Anonymous User'}
            </h1>
            <p className="text-sm text-muted-foreground">
              ID: {conversation.id}
            </p>
          </div>
        </div>
        <ConversationStatusBadge status={conversation.status} />
      </div>

      {/* Main content - Two column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Message thread - with error handling */}
          {messagesError ? (
            <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold mb-2">Failed to Load Messages</h3>
              <p className="text-sm text-muted-foreground">
                {messagesError instanceof Error ? messagesError.message : 'Unable to load conversation history'}
              </p>
            </div>
          ) : (
            <MessageThread messages={messages || []} isLoading={messagesLoading} />
          )}

          {/* Status actions */}
          <StatusActions
            conversation={conversation}
            allowedTransitions={allowedTransitions}
            onTransition={handleTransition}
            isLoading={transitionMutation.isPending}
          />
        </div>

        {/* User sidebar */}
        {conversation.user && (
          <UserSidebar
            user={conversation.user}
            conversation={conversation}
            messageCount={messages?.length || 0}
          />
        )}
      </div>
    </div>
  );
}
