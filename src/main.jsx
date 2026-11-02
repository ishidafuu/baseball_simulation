import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// 入口を分け、オンラインで一人用の画面や日次副作用をマウントしない。
const online = window.location.pathname.replace(/\/$/, '') === '/online';
class OnlineBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" style={{ padding: 24 }}>
        画面を表示できませんでした。
        <button onClick={() => window.location.reload()}>再読込</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root = ReactDOM.createRoot(document.getElementById('root'));
if (online) {
  import('./online/OnlineApp.jsx').then(({ default: OnlineApp }) =>
    root.render(
      <React.StrictMode>
        <OnlineBoundary>
          <OnlineApp />
        </OnlineBoundary>
      </React.StrictMode>,
    ),
  );
} else {
  Promise.all([
    import('./App.jsx'),
    import('./components/AppErrorBoundary.jsx'),
    import('./components/GameDialog.jsx'),
  ]).then(([{ default: App }, { default: AppErrorBoundary }, { GameDialogHost }]) =>
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
        <GameDialogHost />
      </React.StrictMode>,
    ),
  );
}
