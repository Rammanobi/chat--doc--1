import { useTheme } from '../contexts/ThemeContext';

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'system';
}

interface ChatMessagesProps {
  messages: Message[];
}

const ChatMessages = ({ messages }: ChatMessagesProps) => {
  const { theme } = useTheme();

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
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
                : (theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200');

          return (
            <div key={message.id} className={`mb-4 flex ${alignment}`}>
              <div className={`rounded-lg p-3 max-w-lg ${bubbleClass}`}>
                <p>{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChatMessages;
