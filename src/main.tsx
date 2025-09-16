import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ThemeProvider } from './contexts/ThemeContext.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { SelectedDocProvider } from './contexts/SelectedDocContext.tsx'
import { ChatSessionsProvider } from './contexts/ChatSessionsContext.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ChatSessionsProvider>
          <SelectedDocProvider>
            <App />
          </SelectedDocProvider>
        </ChatSessionsProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
