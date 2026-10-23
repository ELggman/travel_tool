import React from 'react';
import ReactDOM from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import './styles.css';
import App from './App';

// Ship the worker as a local asset so both Vite dev and the Android WebView can load it.
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
