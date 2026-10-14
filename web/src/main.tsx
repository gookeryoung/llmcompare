import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import 'highlight.js/styles/github-dark.css';

try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 容器不存在');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
