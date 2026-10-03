import React from 'react';
import { ConfigProvider, theme } from 'antd';

interface MemberThemeProps {
  children: React.ReactNode;
}

const MemberTheme: React.FC<MemberThemeProps> = ({ children }) => {
  return (
    <ConfigProvider
      theme={{
        token: {
          // Premium brand style (Dark Violet / Gold / Elegant)
          colorPrimary: '#531dab', // Purple base
          colorSuccess: '#b37feb',
          colorWarning: '#faad14',
          colorError: '#f5222d',
          colorInfo: '#531dab',
          borderRadius: 12,
          fontFamily: '"Noto Sans TC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          boxShadow: '0 8px 24px rgba(83, 29, 171, 0.12)',
        },
        components: {
          Button: {
            borderRadius: 24,
            controlHeight: 40,
            controlHeightLG: 48,
          },
          Card: {
            borderRadiusLG: 16,
            boxShadowTertiary: '0 4px 12px rgba(0, 0, 0, 0.05)',
          },
          Input: {
            borderRadius: 8,
            controlHeight: 40,
            controlHeightLG: 48,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 40,
            controlHeightLG: 48,
          },
          DatePicker: {
            borderRadius: 8,
            controlHeight: 40,
            controlHeightLG: 48,
          },
          Layout: {
            headerBg: '#ffffff',
            bodyBg: '#f9f0ff', // Light purple background
          },
          Tabs: {
            itemColor: '#8c8c8c',
            itemSelectedColor: '#531dab',
            inkBarColor: '#531dab',
          }
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
};

export default MemberTheme;
