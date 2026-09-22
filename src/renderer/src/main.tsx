import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, ErrorBoundaryFallback } from './App'
import './index.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the in-app fallback; also logged for the console view.
    // eslint-disable-next-line no-console
    console.error('Puxl renderer error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return <ErrorBoundaryFallback message={this.state.error.message} />
    }
    return this.props.children
  }
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element missing from index.html')
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

window.addEventListener('error', (event) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught error in renderer', event.error ?? event.message)
})
