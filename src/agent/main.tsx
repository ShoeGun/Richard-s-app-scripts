import React from 'react';
import ReactDOM from 'react-dom/client';

import AgentApp from './AgentApp';
import './agent.css';

const root = document.getElementById('root');
if (!root) throw new Error('Agent root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AgentApp />
  </React.StrictMode>
);
