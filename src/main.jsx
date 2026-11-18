import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AppProvider } from './app-context.jsx';
import { DialogProvider, ToastProvider } from './components/ui.jsx';

createRoot(document.getElementById('root')).render(
  <ToastProvider>
    <DialogProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </DialogProvider>
  </ToastProvider>,
);
