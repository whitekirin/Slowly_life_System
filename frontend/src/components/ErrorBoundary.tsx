import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result, Typography } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const { Paragraph, Text } = Typography;

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    // Attempt to clear local storage if it might be the cause (optional, maybe too aggressive?)
    // But for a "black screen fix", clearing potential bad state is good.
    // Let's just reload first. User can manually clear if needed, or we provide a "Hard Reset" button.
    window.location.reload();
  };

  private handleResetApp = () => {
    localStorage.clear();
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh', 
          background: '#F5EFE6' 
        }}>
          <Result
            status="500"
            title="應用程式發生錯誤 (Something went wrong)"
            subTitle="很抱歉，應用程式遇到無法處理的錯誤。請嘗試重新整理或重置應用程式。"
            extra={[
              <Button type="primary" key="reload" onClick={this.handleReload}>
                重新整理 (Reload)
              </Button>,
              <Button key="reset" danger onClick={this.handleResetApp}>
                重置應用程式 (Hard Reset)
              </Button>
            ]}
          >
            <div className="desc">
              <Paragraph>
                <Text
                  strong
                  style={{
                    fontSize: 16,
                  }}
                >
                  錯誤詳情 (Error Details):
                </Text>
              </Paragraph>
              <Paragraph>
                <Text type="danger">{this.state.error?.toString()}</Text>
              </Paragraph>
              {this.state.errorInfo && (
                <Paragraph>
                  <pre style={{ maxHeight: 200, overflow: 'auto', background: '#fff', padding: 10 }}>
                    {this.state.errorInfo.componentStack}
                  </pre>
                </Paragraph>
              )}
            </div>
          </Result>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
