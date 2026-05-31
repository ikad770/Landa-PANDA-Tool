import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class UiErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Landa PANDA Tool UI failed to initialize', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <FallbackPage error={this.state.error} />;
    }

    return this.props.children;
  }
}

function FallbackPage({ error }) {
  const message = error?.message || String(error || 'Unknown error');

  return (
    <main className="fallback-page" role="alert">
      <section className="fallback-card">
        <div className="brand-mark">P</div>
        <h1>Landa PANDA Tool loaded, but UI failed to initialize</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function renderFallback(error) {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = '';
  createRoot(root).render(<FallbackPage error={error} />);
}

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root was not found in index.html');
  }

  createRoot(rootElement).render(
    <UiErrorBoundary>
      <App />
    </UiErrorBoundary>
  );
} catch (error) {
  console.error('Landa PANDA Tool failed before React could mount', error);
  renderFallback(error);
}
