import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

console.log('🚀 Renderer process starting...');

const container = document.getElementById('root');
if (!container) {
  console.error('❌ Root element not found');
  throw new Error('Root element not found');
}

console.log('✅ Root element found, creating React root...');
const root = createRoot(container);

console.log('✅ Rendering App component...');
root.render(<App />);

console.log('✅ App rendered successfully!');
