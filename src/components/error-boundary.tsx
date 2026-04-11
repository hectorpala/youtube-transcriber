"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback(this.state.error!, this.handleReset)
          : this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-6">
          <div className="h-16 w-16 rounded-full bg-loss/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-loss" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Algo salió mal
          </h2>
          <p className="text-sm text-muted-foreground max-w-md text-center">
            Ocurrió un error inesperado al renderizar esta sección.
          </p>
          {this.state.error && (
            <pre className="text-xs text-muted-foreground font-mono bg-secondary rounded-md px-4 py-2 max-w-lg overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-secondary text-sm text-foreground hover:bg-secondary/80 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
