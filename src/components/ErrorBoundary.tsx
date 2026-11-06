import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A render error in one screen should not leave a blank white page. React
 * unmounts the tree when a component throws, so catch it here and offer the
 * two useful ways out: retry, or go back to the feed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GoatMedia render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="alert" size={26} />
          <h2>This page hit a snag</h2>
          <p>The rest of GoatMedia is fine. Try this screen again, or head back to the feed.</p>
          <div className="empty-state__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <a className="btn btn--quiet" href={import.meta.env.BASE_URL}>
              Back to the feed
            </a>
          </div>
        </div>
      </div>
    );
  }
}
