import React, { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import type { Message as ChatMessage } from './ChatMessages';
import CopyButton from './CopyButton';

export type Citation = { chunkId: string; snippet: string };
export type Flagged = { chunkId: string; text: string; risk: 'HIGH'|'MEDIUM'|'LOW'; symbol: string };

export interface MessageExtras {
  citations?: Citation[];
  flaggedClauses?: Flagged[];
  followUps?: string[];
  structured?: { summary?: string; keyPoints?: string[] };
  meta?: { timeMs?: number; topChunkIds?: string[] };
}

interface Props {
  messages: ChatMessage[];
  extrasById: Record<string, MessageExtras>;
  pendingAssistant?: boolean;
  pendingSinceMs?: number | null;
  onFollowUp?: (text: string) => void;
}

const ChatMessageList: React.FC<Props> = ({ messages, extrasById, pendingAssistant = false, pendingSinceMs = null, onFollowUp }) => {
  const { theme } = useTheme();
  const stillThinking = useMemo(() => {
    if (!pendingSinceMs) return false;
    const elapsed = Date.now() - pendingSinceMs;
    return elapsed > 10000; // 10s
  }, [pendingSinceMs]);

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((message) => {
          const alignment =
            message.sender === 'user'
              ? 'justify-end'
              : message.sender === 'system'
                ? 'justify-center'
                : 'justify-start';

          const bubbleClass =
            message.sender === 'user'
              ? 'bg-blue-600 text-white'
              : message.sender === 'system'
                ? (theme === 'dark' ? 'bg-gray-600 text-gray-200' : 'bg-gray-300 text-gray-700')
                : (theme === 'dark' ? 'bg-gray-700 text-slate-100' : 'bg-gray-200 text-slate-900');

          const extras = extrasById[message.id];

          return (
            <div key={message.id} className={`mb-2 flex ${alignment}`}>
              <div className={`relative rounded-lg p-3 max-w-xl w-fit ${bubbleClass}`}>
                {message.sender === 'ai' && (
                  <div className="absolute top-2 right-2">
                    <CopyButton text={message.text} />
                  </div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed">{message.text}</div>
                {/* Structured sections for AI answers */}
                {message.sender === 'ai' && extras && (
                  <div className="mt-3 space-y-3 text-sm">
                    {extras.structured?.summary && (
                      <div>
                        <div className="font-semibold mb-1">Summary</div>
                        <div className="opacity-90 whitespace-pre-wrap">{extras.structured.summary}</div>
                      </div>
                    )}
                    {extras.structured?.keyPoints && extras.structured.keyPoints.length > 0 && (
                      <div>
                        <div className="font-semibold mb-1">Key Points</div>
                        <ul className="list-disc ml-5 space-y-1">
                          {extras.structured.keyPoints.map((kp, idx) => (
                            <li key={idx} className="opacity-90">{kp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {extras.flaggedClauses && extras.flaggedClauses.length > 0 && (
                      <div>
                        <div className="font-semibold mb-1">Key Clauses</div>
                        <ul className="list-disc ml-5 space-y-1">
                          {extras.flaggedClauses.map((f, idx) => (
                            <li key={`${f.chunkId}-${idx}`}>
                              <span className="mr-1">{f.symbol}</span>
                              <span className={
                                f.risk === 'HIGH' ? 'text-red-300' : f.risk === 'MEDIUM' ? 'text-yellow-300' : 'text-blue-200'
                              }>
                                [{f.risk}]
                              </span>{' '}
                              <span className="opacity-90">{f.text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {extras.citations && extras.citations.length > 0 && (
                      <div>
                        <div className="font-semibold mb-1">Citations</div>
                        <ul className="list-disc ml-5 space-y-1 opacity-90">
                          {extras.citations.map((c, idx) => (
                            <li key={`${idx}`}>
                              <span className="font-mono text-xs mr-2">Source {idx + 1}</span>
                              <span className="italic">{c.snippet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {extras.followUps && extras.followUps.length > 0 && onFollowUp && (
                      <div>
                        <div className="font-semibold mb-2">Follow-up questions</div>
                        <div className="flex flex-wrap gap-2">
                          {extras.followUps.map((q, idx) => (
                            <button
                              type="button"
                              key={idx}
                              onClick={() => onFollowUp(q)}
                              className="px-3 py-1 rounded-full border border-slate-500/50 hover:border-slate-400/80 text-xs bg-slate-800/40 hover:bg-slate-800/70"
                              title="Ask this follow-up"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {pendingAssistant && (
          <div className="mb-2 flex justify-start">
            <div className={`rounded-lg p-3 max-w-xl w-fit ${theme === 'dark' ? 'bg-gray-700 text-slate-100' : 'bg-gray-200 text-slate-900'}`}>
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                <span className="opacity-90">Thinking…</span>
              </div>
              <div className="mt-2 animate-pulse h-3 w-64 rounded bg-slate-500/40" />
              <div className="mt-2 animate-pulse h-3 w-40 rounded bg-slate-500/30" />
              {stillThinking && (
                <div className="mt-3 text-xs opacity-80">Still thinking…</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessageList;
