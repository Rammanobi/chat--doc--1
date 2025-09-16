import { Plus, Clock, User, LogOut } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import FileList from './FileList';
import DeleteButton from './DeleteButton';
import { useChatSessions } from '../contexts/ChatSessionsContext';
import { useSelectedDoc } from '../contexts/SelectedDocContext';

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar = ({ isOpen }: SidebarProps) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { sessions, activeSessionId, newSession, switchSession, deleteSession } = useChatSessions();
  const { setSelectedDocId } = useSelectedDoc();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // User will be redirected to login page by the ProtectedRoute
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };
  
  return (
    <div className={`w-64 p-4 flex flex-col transform transition-transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:relative absolute h-full z-10 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'}`}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Chatdoc</h1>
      </div>
      <nav className="flex-grow">
        <ul>
          <li className="mb-4">
            <button
              onClick={() => { newSession(); setSelectedDocId(null); }}
              className={`w-full text-left flex items-center p-2 rounded-md ${theme === 'dark' ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-300'}`}
            >
              <Plus size={20} className="mr-3" />
              New Chat
            </button>
          </li>
          <li className="mb-4">
            <div className={`flex items-center p-2 rounded-md ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              <Clock size={20} className="mr-3" />
              History
            </div>
            {/* Sessions list */}
            <ul className="mt-2 pl-2 space-y-1 max-h-64 overflow-y-auto pr-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-1">
                  <button
                    onClick={() => { switchSession(s.id); setSelectedDocId(null); }}
                    className={`flex-1 text-left truncate p-2 rounded-md text-sm ${s.id === activeSessionId ? (theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-gray-300 text-black') : (theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-300')}`}
                    title={s.title}
                  >
                    {s.title || 'New Chat'}
                  </button>
                  <DeleteButton
                    onConfirm={() => deleteSession(s.id)}
                    tooltip="Delete chat"
                  />
                </li>
              ))}
            </ul>
          </li>
          {/* Add other nav items here */}
        </ul>
        <FileList />
      </nav>
      {user && (
        <div>
          <div className={`flex items-center p-2 rounded-md mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            <User size={20} className="mr-3" />
            <span>{user.displayName || user.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center p-2 rounded-md ${theme === 'dark' ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-300'}`}
          >
            <LogOut size={20} className="mr-3" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
