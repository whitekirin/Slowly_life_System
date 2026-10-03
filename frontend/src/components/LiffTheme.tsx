import React from 'react';
import { ConfigProvider } from 'antd';
import { fontSans, sl } from '../theme/slowlife';

interface LiffThemeProps {
  children: React.ReactNode;
}

// LIFF pages open inside LINE's in-app browser on a phone: compact controls,
// generous tap targets, no sidebar/table chrome. 色彩與字體跟員工後台一樣用慢生活 token
// （docs/design-system-slowlife.md），尺寸則是手機觸控用的固定大小。
const LiffTheme: React.FC<LiffThemeProps> = ({ children }) => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: sl.primary,
          colorSuccess: sl.green,
          colorWarning: sl.warning,
          colorError: sl.error,
          colorText: sl.text,
          colorTextSecondary: sl.textSecondary,
          colorTextTertiary: sl.textTertiary,
          colorTextPlaceholder: sl.placeholder,
          colorBorder: sl.border,
          colorBorderSecondary: sl.divider,
          colorBgLayout: sl.bg,
          colorBgContainer: sl.surface,
          borderRadius: 10,
          fontFamily: fontSans,
        },
        components: {
          Button: {
            controlHeight: 44,
            controlHeightLG: 48,
          },
          Input: {
            controlHeight: 40,
          },
          Select: {
            controlHeight: 40,
          },
          Card: {
            borderRadiusLG: 16,
          },
        },
      }}
    >
      <div className="sl-liff">
        {children}
      </div>
    </ConfigProvider>
  );
};

export default LiffTheme;
