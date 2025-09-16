import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedDoc } from '../contexts/SelectedDocContext';
import DeleteButton from './DeleteButton';
import { useChatSessions } from '../contexts/ChatSessionsContext';

interface DocItem {
  id: string;
  fileName?: string;
  status?: string;
  createdAt?: any;
}

const FileList: React.FC = () => {
  const { user } = useAuth();
  const { selectedDocId, setSelectedDocId } = useSelectedDoc();
  const { activeSessionId } = useChatSessions();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // no local deleting state needed; DeleteButton handles busy state

  useEffect(() => {
    if (!user || !activeSessionId) {
      setDocs([]);
      setErr(null);
      return;
    }
    const col = collection(db, 'documents');
    // Query by userId for permissions and index simplicity, filter by session on client
    const q = query(col, where('userId', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let items: DocItem[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        items = items.filter((it: any) => it.sessionId === activeSessionId);
        // Sort client-side by createdAt desc, handling undefined safely
        items.sort((a, b) => {
          const aTime = (a as any).createdAt?.toMillis?.() ?? 0;
          const bTime = (b as any).createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });
        setDocs(items);
        setErr(null);
      },
      (error) => {
        console.error('FileList snapshot error', error);
        setErr('Unable to load files.');
      }
    );
    return () => unsub();
  }, [user, activeSessionId]);

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      const callable = httpsCallable<{ documentId: string }, { success: boolean }>(functions, 'deleteFile');
      await callable({ documentId: id });
      if (selectedDocId === id) setSelectedDocId(null);
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-700 pt-4 space-y-2">
      <h3 className="text-sm font-semibold mb-2 px-2">Files in this chat</h3>
      {!user && (
        <div className="text-xs opacity-70 px-2">Sign in to view your files.</div>
      )}
      {user && !activeSessionId && (
        <div className="text-xs opacity-70 px-2">Open or create a chat to see its files.</div>
      )}
      {err && (
        <div className="text-xs text-red-400 px-2">{err}</div>
      )}
      {docs.map((d) => (
        <div key={d.id} className={`flex items-center justify-between rounded border px-3 py-2 ${selectedDocId === d.id ? 'border-blue-500' : 'border-slate-700'}`}>
          <button
            className="text-left truncate flex-1"
            title={d.fileName || d.id}
            onClick={() => setSelectedDocId(d.id)}
          >
            <div className="text-sm font-medium">{d.fileName || d.id}</div>
            <div className="text-xs opacity-80">{d.status || ''}</div>
          </button>
          <DeleteButton
            className="ml-2"
            onConfirm={() => handleDelete(d.id)}
            tooltip="Delete file"
          />
        </div>
      ))}
      {docs.length === 0 && (
        <div className="text-xs opacity-70">No files uploaded yet.</div>
      )}
    </div>
  );
};

export default FileList;
