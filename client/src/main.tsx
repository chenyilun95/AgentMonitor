import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { APP_BASE_PATH } from './lib/basePath';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={APP_BASE_PATH || undefined}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
