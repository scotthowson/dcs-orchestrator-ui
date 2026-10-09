import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_GHOST } from '../../lib/ui'
interface Props {
  children: React.ReactNode
  fallbackMessage?: string
  onNavigateHome?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
          <div className="gradient-border glass rounded-2xl p-8 flex flex-col items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose-500/10 glow-rose">
              <AlertTriangle className="h-6 w-6 text-rose-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-200">{this.props.fallbackMessage || 'Something went wrong'}</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">{this.state.error?.message}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={this.handleReset}
                type="button"
                className={BTN_TOOLBAR_QUIET}
              >
                <RefreshCw size={14} aria-hidden />
                Try again
              </button>
              {this.props.onNavigateHome && (
                <button
                  onClick={this.props.onNavigateHome}
                  type="button"
                  className={`${BTN_TOOLBAR} ${TONE_GHOST}`}
                >
                  <Home size={14} aria-hidden />
                  Go to the dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
