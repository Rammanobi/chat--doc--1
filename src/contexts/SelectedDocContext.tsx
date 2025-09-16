import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SelectedDocContextType {
  selectedDocId: string | null;
  setSelectedDocId: (id: string | null) => void;
}

const SelectedDocContext = createContext<SelectedDocContextType | undefined>(undefined);

export const SelectedDocProvider = ({ children }: { children: ReactNode }) => {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('selected_doc_id');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (selectedDocId) {
        localStorage.setItem('selected_doc_id', selectedDocId);
      } else {
        localStorage.removeItem('selected_doc_id');
      }
    } catch {}
  }, [selectedDocId]);

  return (
    <SelectedDocContext.Provider value={{ selectedDocId, setSelectedDocId }}>
      {children}
    </SelectedDocContext.Provider>
  );
};

export const useSelectedDoc = () => {
  const ctx = useContext(SelectedDocContext);
  if (!ctx) throw new Error('useSelectedDoc must be used within SelectedDocProvider');
  return ctx;
};
