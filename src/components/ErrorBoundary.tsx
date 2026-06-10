import React from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare state: State;
  declare props: Props;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App error caught by boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border-2 border-zinc-900 rounded-[28px] p-6 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full border-2 border-zinc-900 bg-red-200 flex items-center justify-center">
            <RefreshCw className="h-8 w-8 text-zinc-900" />
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-950">Something went wrong</h2>
            {this.state.error && (
              <p className="mt-1 text-xs font-bold text-zinc-500 break-all">{this.state.error.message}</p>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-3 rounded-2xl border-2 border-zinc-900 bg-indigo-600 text-white text-xs font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
