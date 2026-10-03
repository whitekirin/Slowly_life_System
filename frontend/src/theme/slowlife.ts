// 慢生活製造所 Design System — 員工後台的唯一色彩／字體／圓角來源。
// 頁面裡需要顏色時從這裡拿（import { sl } from '../theme/slowlife'），不要再寫死 #1890ff 之類的 antd 預設色。
// 會員前台（MemberTheme）與 LIFF（LiffTheme）有各自的主題，不吃這份。
import type { ThemeConfig } from 'antd';

export const sl = {
  // 背景／表面
  bg: '#F5EFE6',
  bgSoft: '#FDF6EC',
  surface: '#FFFDF8',
  surface2: '#FCF8F1',
  surface3: '#F8F3EA',
  sider: '#FAF4EA',
  // 品牌棕
  primary: '#8B6545',
  primaryHover: '#A07A57',
  primaryActive: '#74523A',
  primarySoft: '#F1E6D6',
  primaryDeep: '#5E4330',
  // 墨綠
  green: '#4F6B58',
  greenSoft: '#E6EEE6',
  // 暖橘／土黃
  warning: '#B98035',
  warningSoft: '#F7EAD3',
  warningText: '#7A5427',
  // 磚紅
  error: '#B25B4C',
  errorSoft: '#F6E3DD',
  // 文字
  text: '#3E352D',
  textSecondary: '#66594C',
  textTertiary: '#786A5A',
  placeholder: '#968877',
  // 線
  border: '#E3D9CB',
  divider: '#EFE8DD',
  // 陰影：「紙張輕輕放在桌面上」
  shadow: '0 2px 12px rgba(80, 60, 40, 0.05)',
  shadowRaised: '0 8px 28px rgba(80, 60, 40, 0.08)',
  // 圖表三色（主／輔／第三），不要用彩虹色
  chart: ['#8B6545', '#4F6B58', '#B07F45', '#8E8171'],
} as const;

export const fontSans =
  '"Noto Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Segoe UI", sans-serif';
export const fontSerif = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';

// fs = 基準字級（px，由 useViewport.fluidFontSize 依視窗寬度算出）；其他尺寸都用它等比例推出
export function buildSlowlifeTheme(fs = 14): ThemeConfig {
  const k = (ratio: number) => Math.round(fs * ratio);
  return {
  token: {
    colorPrimary: sl.primary,
    colorInfo: sl.primary,
    colorSuccess: sl.green,
    colorWarning: sl.warning,
    colorError: sl.error,
    colorLink: sl.primary,
    colorLinkHover: sl.primaryHover,
    colorLinkActive: sl.primaryActive,

    // antd 的 preset 色（Tag color="green" 之類）都由這些種子色生成——全部調成低飽和
    blue: '#6F8190',
    geekblue: '#6D7594',
    purple: '#8B7592',
    magenta: '#A56A7C',
    pink: '#A56A7C',
    red: '#B25B4C',
    volcano: '#B46A4E',
    orange: '#BE8442',
    gold: '#BF9A52',
    yellow: '#C7A95C',
    lime: '#8C955F',
    green: '#5E7F68',
    cyan: '#5F8581',

    colorBgLayout: sl.bg,
    colorBgContainer: sl.surface,
    colorBgElevated: sl.surface,
    colorBgMask: 'rgba(74, 60, 46, 0.28)',
    colorFillAlter: sl.surface2,
    colorFillSecondary: '#F3ECE1',
    colorFillTertiary: '#F6F0E6',
    colorFillQuaternary: '#F9F4EC',

    colorText: sl.text,
    colorTextHeading: sl.text,
    colorTextSecondary: sl.textSecondary,
    colorTextTertiary: sl.textTertiary,
    colorTextQuaternary: sl.placeholder,
    colorTextPlaceholder: sl.placeholder,
    colorTextDescription: sl.textSecondary,

    colorBorder: sl.border,
    colorBorderSecondary: sl.divider,
    colorSplit: sl.divider,

    fontFamily: fontSans,
    fontSize: fs,
    fontSizeSM: k(0.86),
    fontSizeLG: k(1.15),
    fontSizeHeading1: k(2.3),
    fontSizeHeading2: k(1.86),
    fontSizeHeading3: k(1.43),
    fontSizeHeading4: k(1.2),
    fontSizeHeading5: k(1.07),
    lineHeight: 1.65,

    borderRadius: 10,
    borderRadiusSM: 8,
    borderRadiusLG: 16,
    borderRadiusXS: 6,

    controlHeight: k(2.57),
    controlHeightSM: k(1.86),
    controlHeightLG: k(2.86),
    controlOutline: 'rgba(139, 101, 69, 0.12)',
    controlItemBgActive: sl.primarySoft,
    controlItemBgHover: '#F6EEE2',

    boxShadow: sl.shadowRaised,
    boxShadowSecondary: sl.shadowRaised,
    boxShadowTertiary: sl.shadow,

    motionDurationMid: '0.24s',
    motionDurationSlow: '0.36s',
  },
  components: {
    Layout: {
      bodyBg: sl.bg,
      headerBg: 'rgba(253, 249, 242, 0.86)',
      headerHeight: k(4.86),
      headerPadding: '0 clamp(16px, 2.2vw, 56px)',
      siderBg: sl.sider,
      lightSiderBg: sl.sider,
      triggerBg: '#F3EADD',
      triggerColor: sl.textSecondary,
      lightTriggerBg: '#F3EADD',
      lightTriggerColor: sl.textSecondary,
      footerBg: 'transparent',
      footerPadding: `${k(1.43)}px 32px ${k(2)}px`,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#554A3F',
      itemHoverColor: sl.primaryDeep,
      itemHoverBg: '#F2E9DC',
      itemSelectedBg: sl.primarySoft,
      itemSelectedColor: sl.primaryDeep,
      itemActiveBg: '#EFE3D2',
      groupTitleColor: sl.textTertiary,
      itemBorderRadius: 10,
      subMenuItemBorderRadius: 10,
      itemMarginInline: 12,
      itemMarginBlock: 2,
      itemHeight: k(2.86),
      iconSize: k(1.15),
      collapsedIconSize: k(1.22),
      activeBarBorderWidth: 0,
      popupBg: sl.surface,
    },
    Button: {
      borderRadius: 10,
      borderRadiusSM: 8,
      borderRadiusLG: 12,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      defaultBg: sl.surface,
      defaultColor: sl.primaryDeep,
      defaultBorderColor: '#DCCDB9',
      defaultHoverBg: sl.surface2,
      defaultHoverColor: sl.primary,
      defaultHoverBorderColor: sl.primaryHover,
      textHoverBg: '#F3EADD',
      paddingInline: k(1.29),
    },
    Input: {
      activeBorderColor: sl.primary,
      hoverBorderColor: '#CDBBA4',
      activeShadow: '0 0 0 3px rgba(139, 101, 69, 0.10)',
      borderRadius: 10,
    },
    InputNumber: {
      activeBorderColor: sl.primary,
      hoverBorderColor: '#CDBBA4',
      activeShadow: '0 0 0 3px rgba(139, 101, 69, 0.10)',
    },
    Select: {
      activeBorderColor: sl.primary,
      hoverBorderColor: '#CDBBA4',
      activeOutlineColor: 'rgba(139, 101, 69, 0.10)',
      optionSelectedBg: sl.primarySoft,
      optionSelectedColor: sl.primaryDeep,
      optionActiveBg: '#F6EEE2',
    },
    DatePicker: {
      activeBorderColor: sl.primary,
      hoverBorderColor: '#CDBBA4',
      activeShadow: '0 0 0 3px rgba(139, 101, 69, 0.10)',
    },
    Table: {
      headerBg: '#F6EEE2',
      headerColor: '#66594C',
      headerSplitColor: 'transparent',
      headerBorderRadius: 12,
      rowHoverBg: '#FAF3E8',
      rowSelectedBg: '#F6ECDD',
      rowSelectedHoverBg: '#F1E4D1',
      borderColor: '#F0E8DC',
      cellPaddingBlock: k(1),
      cellPaddingInline: k(1.15),
      cellPaddingBlockMD: k(0.72),
      cellPaddingBlockSM: k(0.57),
      footerBg: sl.surface2,
      expandIconBg: sl.surface,
    },
    Card: {
      headerFontSize: k(1.15),
      headerHeight: k(4),
      bodyPadding: k(1.57),
      colorBorderSecondary: '#EEE5D8',
    },
    Modal: {
      contentBg: sl.surface,
      headerBg: sl.surface,
      footerBg: 'transparent',
      titleFontSize: k(1.29),
      borderRadiusLG: 16,
    },
    Drawer: {
      colorBgElevated: sl.surface,
      footerPaddingBlock: 14,
      footerPaddingInline: 24,
    },
    Tabs: {
      itemColor: sl.textSecondary,
      itemHoverColor: sl.primary,
      itemSelectedColor: sl.primaryDeep,
      inkBarColor: sl.primary,
      titleFontSize: k(1.07),
    },
    Tag: {
      defaultBg: '#F3ECE1',
      defaultColor: '#66594C',
    },
    Statistic: {
      titleFontSize: k(0.93),
      contentFontSize: k(1.86),
    },
    Badge: {
      colorError: sl.error,
    },
    Segmented: {
      itemSelectedBg: sl.surface,
      trackBg: '#F1E9DD',
    },
    Switch: {
      colorPrimary: sl.green,
      colorPrimaryHover: '#5E7F68',
    },
    Checkbox: {
      borderRadiusSM: 5,
    },
    Pagination: {
      itemActiveBg: sl.primarySoft,
    },
    Steps: {
      colorPrimary: sl.primary,
    },
    Alert: {
      withDescriptionPadding: '14px 18px',
    },
    Message: {
      contentBg: sl.surface,
    },
    Notification: {
      colorBgElevated: sl.surface,
    },
    Tooltip: {
      colorBgSpotlight: 'rgba(62, 53, 45, 0.92)',
    },
    Skeleton: {
      gradientFromColor: '#F1E9DD',
      gradientToColor: '#F8F2E9',
    },
    Typography: {
      titleMarginBottom: '0.4em',
    },
  },
};
}

/** 預設 14px 的主題（測試或不需要動態尺寸的地方用） */
export const slowlifeTheme: ThemeConfig = buildSlowlifeTheme(14);
