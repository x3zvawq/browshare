export const mediaMessages = {
  'zh-CN': {
    mediaSettings: {
      title: '全局媒体上限',
      globalHint:
        '分辨率、帧率和码率与 Profile 配置分别取更严格的上限。只有全局与 Profile 都允许音频时，会话才会传输音频。',
      appliesToNewSessions: '保存后对新建会话生效，已有会话保持创建时的配置。',
    },
  },
  'en-US': {
    mediaSettings: {
      title: 'Global media limits',
      globalHint:
        'Resolution, frame rate, and bitrate each use the stricter of the global and Profile limits. Sessions transmit audio only when both the global and Profile settings allow it.',
      appliesToNewSessions:
        'Saved settings apply to new sessions. Existing sessions keep the settings used when they were created.',
    },
  },
}
