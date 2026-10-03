import React, { useEffect, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import zhTW from 'antd/locale/zh_TW';
import { buildSlowlifeTheme } from './slowlife';
import { fluidFontSize, useViewport } from './useViewport';
import EmptyState from './EmptyState';
import './slowlife.css';

// 員工後台（含登入頁）的主題外框。會員前台與 LIFF 不包這層，避免主題互相繼承。
const SlowLifeTheme: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 基準字級跟著視窗寬度變；只有跨整數 px 時才重建主題，拖拉視窗不會每一幀都重算
  const fs = useViewport(fluidFontSize);
  const theme = useMemo(() => buildSlowlifeTheme(fs), [fs]);
  useEffect(() => {
    // Modal／Drawer 掛在 body 下，也要拿得到基準字級
    document.body.style.setProperty('--sl-fs', `${fs}px`);
  }, [fs]);
  useEffect(() => {
    document.body.classList.add('sl-body');
    return () => document.body.classList.remove('sl-body');
  }, []);
  return (
  <ConfigProvider
    theme={theme}
    locale={zhTW}
    button={{ autoInsertSpace: false }}
    renderEmpty={(componentName) => <EmptyState compact={componentName !== 'Table' && componentName !== 'List'} />}
  >
    <div className="slowlife" style={{ '--sl-fs': `${fs}px` } as React.CSSProperties}>{children}</div>
  </ConfigProvider>
  );
};

export default SlowLifeTheme;
