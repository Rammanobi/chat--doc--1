// src/components/MainPanel.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Message as ChatMessage } from './ChatMessages';
import ChatMessageList from './ChatMessageList.tsx';
import MessageInput from './MessageInput.tsx';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useSelectedDoc } from '../contexts/SelectedDocContext';
import { useChatSessions } from '../contexts/ChatSessionsContext';

const SCROLL_STICKY_EPS = 80;

const MainPanel: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { activeSession, activeSessionId, addMessage, setTitleIfEmptyFromFirstUser, newSession } = useChatSessions();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { selectedDocId } = useSelectedDoc();
  const [remember, setRemember] = useState<boolean>(false);

  // Extras (citations, flagged clauses, follow-ups) keyed by message id
  const [extrasById, setExtrasById] = useState<Record<string, any>>({});
  const [pendingAssistant, setPendingAssistant] = useState(false);
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [shadowMessages, setShadowMessages] = useState<ChatMessage[]>([]);

  // scrolling
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distance < SCROLL_STICKY_EPS);
  }, []);
  useEffect(() => {
    if (stickToBottom && scrollerRef.current) {
      scrollerRef.current.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [activeSession?.messages?.length, stickToBottom]);

  const ask = useCallback(async (overrideQuestion?: string) => {
    if (!user) {
      addMessage({ id: `${Date.now()}_sys_auth`, text: 'You need to sign in to ask a question.', sender: 'system' });
      return;
    }
    const q = (overrideQuestion ?? input).trim();
    if (!q) return;
    if (!selectedDocId) {
      addMessage({ id: `${Date.now()}_sys_nodoc`, text: 'Please select or upload a document, then try again.', sender: 'system' });
      return;
    }

    // Ensure there is an active session when remembering
    let sid = activeSessionId;
    if (remember && !sid && newSession) {
      sid = await newSession();
    }

    const question = q;
    if (!overrideQuestion) setInput('');
    const userMsg: ChatMessage = { id: `${Date.now()}_u`, text: question, sender: 'user' };
    if (remember) {
      await addMessage(userMsg, sid);
      setTitleIfEmptyFromFirstUser(question, sid);
    } else {
      setShadowMessages((prev) => [...prev, userMsg]);
    }

    setLoading(true);
    setPendingAssistant(true);
    setPendingSince(Date.now());
    try {
      const callable = httpsCallable<
        { question: string; documentId: string; sessionId?: string; remember?: boolean },
        { answer: string; citations?: any[]; flaggedClauses?: any[]; followUps?: string[]; meta?: any }
      >(functions, 'askQuestion');
      const result = await callable({ question, documentId: selectedDocId, sessionId: remember ? sid : undefined, remember });
      const payload: any = result.data || {};
      // Hide internal chunk IDs that may appear inline in the model's raw text
      const rawAnswer = payload.answer ?? 'No answer returned.';
      const answer = rawAnswer.replace(/\[\[\s*chunkId\s*:[^\]]+\]\]/gi, '[source]');
      if (remember) {
        const aiId = await addMessage({ id: `${Date.now()}_a`, text: answer, sender: 'ai' }, sid);
        setExtrasById((prev) => ({
          ...prev,
          [aiId]: {
            citations: payload.citations || [],
            flaggedClauses: payload.flaggedClauses || [],
            followUps: payload.followUps || [],
            structured: payload.structured || undefined,
            meta: payload.meta || {},
          },
        }));
      } else {
        const aiId = `${Date.now()}_a_local`;
        const aiMsg: ChatMessage = { id: aiId, text: answer, sender: 'ai' };
        setShadowMessages((prev) => [...prev, aiMsg]);
        setExtrasById((prev) => ({
          ...prev,
          [aiId]: {
            citations: payload.citations || [],
            flaggedClauses: payload.flaggedClauses || [],
            followUps: payload.followUps || [],
            structured: payload.structured || undefined,
            meta: payload.meta || {},
          },
        }));
      }
    } catch (err) {
      console.error('Error asking question:', err);
      addMessage({ id: `${Date.now()}_sys_err`, text: 'Sorry, I encountered an error. Try again.', sender: 'system' });
    } finally {
      setLoading(false);
      setPendingAssistant(false);
      setPendingSince(null);
    }
  }, [user, input, selectedDocId, addMessage, setTitleIfEmptyFromFirstUser, remember, activeSessionId, newSession]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${theme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 text-sm opacity-90">
          <ArrowRight size={18} className="opacity-70" />
          <span>New Page</span>
        </div>
        <button onClick={toggleTheme} className="text-sm opacity-80 hover:opacity-100">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</button>
      </div>

      {/* Messages scroller */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={`flex-1 min-h-0 overflow-y-auto ${theme === 'dark' ? 'bg-slate-900' : 'bg-white'} px-4 py-6 md:px-6 md:py-8 space-y-4 scroll-smooth [scrollbar-gutter:stable] overscroll-contain`}
      >
        <ChatMessageList
          messages={remember ? (activeSession?.messages || []) : shadowMessages}
          extrasById={extrasById}
          pendingAssistant={pendingAssistant}
          pendingSinceMs={pendingSince}
          onFollowUp={(txt) => ask(txt)}
        />
      </div>

      {/* Composer (sticky) */}
      <div className={`sticky bottom-0 inset-x-0 border-t border-slate-800 backdrop-blur ${theme === 'dark' ? 'bg-slate-900/95 supports-[backdrop-filter]:bg-slate-900/80' : 'bg-white/95 supports-[backdrop-filter]:bg-white/80'}`}>
        <div className="mx-auto max-w-4xl px-4 py-3">
          <MessageInput
            value={input}
            onChange={setInput}
            onSubmit={() => ask()}
            disabled={loading}
            remember={remember}
            onToggleRemember={setRemember}
            placeholder={selectedDocId ? 'Type your message' : 'Upload a document to begin...'}
          />
        </div>
      </div>
    </div>
  );
};

export default MainPanel;