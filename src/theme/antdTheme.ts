import { theme, type ThemeConfig } from 'antd'

/**
 * antd 6 theme mapped onto the app's "Frost Glass" dark palette
 * (see styles/tokens.css). The cyan accent, layered dark backgrounds and
 * glass borders are carried over so antd controls blend with the rest of
 * the shell instead of looking like stock Ant Design.
 */
export const antdTheme: ThemeConfig = {
  // CSS variables mode is the default in antd 6 — plain CSS can reference
  // --ant-* tokens.
  hashed: false,
  algorithm: theme.darkAlgorithm,
  token: {
    // Accent
    colorPrimary: '#2dd4bf',
    colorInfo: '#2dd4bf',
    colorSuccess: '#34d399',
    colorWarning: '#fbbf24',
    colorError: '#fb7185',
    colorLink: '#5eead4',
    colorLinkHover: '#2dd4bf',

    // Surfaces (Frost Glass layering)
    colorBgBase: '#06090f',
    colorBgContainer: '#101828',
    colorBgElevated: '#0d1524',
    colorBgLayout: '#06090f',
    colorBgSpotlight: '#0f1a2c',
    colorBorder: 'rgba(255, 255, 255, 0.12)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
    colorSplit: 'rgba(255, 255, 255, 0.08)',

    // Text
    colorTextBase: '#eef3fb',
    colorText: '#c3cedd',
    colorTextSecondary: '#9aa8bc',
    colorTextTertiary: '#6b7a90',
    colorTextQuaternary: '#48576b',

    // Typography & geometry
    fontFamily:
      "'IBM Plex Sans', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif",
    fontFamilyCode:
      "'IBM Plex Mono', 'Cascadia Code', 'Fira Code', Consolas, ui-monospace, monospace",
    fontSize: 13,
    borderRadius: 8,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    controlHeight: 30,
    controlHeightSM: 24,
    controlHeightLG: 36,
  },
  components: {
    Button: {
      fontWeight: 500,
      defaultShadow: 'none',
      primaryShadow: 'none',
      dangerShadow: 'none',
      contentFontSizeSM: 12,
      contentFontSize: 13,
    },
    Modal: {
      contentBg: 'rgba(10, 16, 28, 0.96)',
      headerBg: 'transparent',
      titleFontSize: 15,
      titleLineHeight: 1.5,
      borderRadiusLG: 16,
      boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04)',
      paddingContentHorizontal: 20,
      paddingMD: 20,
    },
    Tooltip: {
      colorBgSpotlight: '#0f1a2c',
      borderRadiusSM: 6,
    },
    Input: {
      activeBorderColor: '#2dd4bf',
      hoverBorderColor: 'rgba(45, 212, 191, 0.6)',
      paddingInlineSM: 8,
    },
    Select: {
      optionSelectedBg: 'rgba(45, 212, 191, 0.14)',
      optionSelectedColor: '#5eead4',
    },
    Menu: {
      itemBorderRadius: 6,
      itemMarginInline: 4,
      activeBarBorderWidth: 0,
    },
    Tabs: {
      itemSelectedColor: '#5eead4',
      inkBarColor: '#2dd4bf',
      titleFontSize: 13,
    },
    Tree: {
      nodeSelectedBg: 'rgba(45, 212, 191, 0.12)',
      nodeHoverBg: 'rgba(255, 255, 255, 0.05)',
    },
    Segmented: {
      itemSelectedBg: 'rgba(45, 212, 191, 0.14)',
      itemSelectedColor: '#5eead4',
      trackBg: 'rgba(255, 255, 255, 0.05)',
    },
    Dropdown: {
      borderRadiusLG: 10,
    },
    Message: {
      contentBg: 'rgba(10, 16, 28, 0.96)',
    },
    Notification: {
      colorBgElevated: 'rgba(10, 16, 28, 0.96)',
    },
    Popconfirm: {
      colorBgElevated: '#0d1524',
    },
    Table: {
      headerBg: 'rgba(255, 255, 255, 0.04)',
      headerColor: '#9aa8bc',
      rowHoverBg: 'rgba(255, 255, 255, 0.04)',
      borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    Tag: {
      defaultBg: 'rgba(255, 255, 255, 0.05)',
    },
  },
}
