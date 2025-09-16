import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, DocumentData, Timestamp, QuerySnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FileText, Loader, CheckCircle } from 'lucide-react';
import { useSelectedDoc } from '../contexts/SelectedDocContext';
import { useChatSessions } from '../contexts/ChatSessionsContext';

interface Document {
  id: string;
  fileName: string;
  status: string;
  createdAt?: Timestamp | null;
}

const DocumentList = () => {
  const { user } = useAuth();
  const { selectedDocId, setSelectedDocId } = useSelectedDoc();
  const { activeSessionId } = useChatSessions();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const q = query(
      collection(db, 'documents'),
      where('userId', '==', user.uid),
      where('sessionId', '==', activeSessionId)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot: QuerySnapshot<DocumentData>) => {
      const docs: Document[] = [];
      querySnapshot.forEach((doc: DocumentData) => {
        docs.push({ id: doc.id, ...doc.data() } as Document);
      });
      // Sort by creation date, newest first (handle missing/null timestamps safely)
      docs.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });
      setDocuments(docs);
      // Auto-select newest if none selected or if the selected doc no longer exists
      if (docs.length > 0 && (!selectedDocId || !docs.find(d => d.id === selectedDocId))) {
        setSelectedDocId(docs[0].id);
      }
      setLoading(false);
    }, (error: unknown) => {
      console.error("Error fetching documents: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, activeSessionId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processing':
        return <Loader size={16} className="text-yellow-500 animate-spin" />;
      case 'ready':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'failed':
        return <FileText size={16} className="text-red-500" />;
      case 'uploaded':
      default:
        return <FileText size={16} />;
    }
  };

  if (loading) {
    return <div className="text-xs text-center p-2">Loading documents...</div>;
  }

  return (
    <div className="mt-4 border-t border-gray-700 pt-4">
      <h3 className="text-sm font-semibold mb-2 px-2">Your Documents</h3>
      {documents.length > 0 ? (
        <ul>
          {documents.map((doc) => {
            const isSelected = selectedDocId === doc.id;
            return (
              <li
                key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className={`flex items-center justify-between p-2 rounded-md text-sm cursor-pointer ${isSelected ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                title={isSelected ? 'Selected' : 'Click to chat with this document'}
              >
                <span className="truncate flex-grow">{doc.fileName}</span>
                {getStatusIcon(doc.status)}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 px-2">No documents uploaded yet.</p>
      )}
    </div>
  );
};

export default DocumentList;
