import type { GlobalThemeOverrides } from 'naive-ui'

const shared: GlobalThemeOverrides = {
  common: {
    primaryColor: '#0F62D6',
    primaryColorHover: '#4096FF',
    primaryColorPressed: '#0958D9',
    primaryColorSuppl: '#13C2C2',
    successColor: '#18A058',
    warningColor: '#F0A020',
    errorColor: '#D03050',
    infoColor: '#2080F0',
    borderRadius: '6px',
    borderRadiusSmall: '4px',
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif',
    fontFamilyMono: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
  },
  Button: {
    heightMedium: '36px',
    borderRadiusMedium: '6px',
    fontWeight: '600',
  },
  Card: {
    borderRadius: '10px',
    paddingMedium: '20px',
  },
}

export const lightThemeOverrides: GlobalThemeOverrides = {
  ...shared,
  common: {
    ...shared.common,
    bodyColor: '#F5F7FB',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    textColorBase: '#172033',
    textColor1: '#172033',
    textColor2: '#667085',
    borderColor: '#E4E9F2',
    dividerColor: '#E4E9F2',
  },
  Tag: {
    textColor: '#475467',
    color: '#F2F4F7',
    textColorPrimary: '#175CD3',
    colorPrimary: '#EFF8FF',
    textColorInfo: '#175CD3',
    colorInfo: '#EFF8FF',
    textColorSuccess: '#067647',
    colorSuccess: '#ECFDF3',
    textColorWarning: '#93370D',
    colorWarning: '#FFFAEB',
    textColorError: '#B42318',
    colorError: '#FEF3F2',
  },
}

export const darkThemeOverrides: GlobalThemeOverrides = {
  ...shared,
  common: {
    ...shared.common,
    primaryColor: '#5AA9FF',
    primaryColorHover: '#79B8FF',
    primaryColorPressed: '#4096FF',
    primaryColorSuppl: '#5AA9FF',
    successColor: '#55D98A',
    errorColor: '#FF7595',
    infoColor: '#63A8FF',
    bodyColor: '#0C111D',
    cardColor: '#151C2C',
    modalColor: '#1D2638',
    textColorBase: '#F4F7FC',
    textColor1: '#F4F7FC',
    textColor2: '#AAB5C7',
    borderColor: '#2B3548',
    dividerColor: '#2B3548',
  },
  Button: {
    ...shared.Button,
    colorPrimary: '#0F62D6',
    colorHoverPrimary: '#1677E8',
    colorPressedPrimary: '#0958C8',
    textColorPrimary: '#FFFFFF',
  },
}
