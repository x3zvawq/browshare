export const focusMessages = {
  'zh-CN': {
    focus: {
      title: 'Viewer 失焦暂停',
      globalHint:
        '设置未单独配置的 Profile 使用的暂停策略。保存后在下一次打开或重新连接 Viewer 时生效；当前 Viewer 保持原配置。',
      mode: '暂停条件',
      NEVER: '不自动暂停',
      WHEN_HIDDEN: '仅页面隐藏时',
      WHEN_UNFOCUSED: '页面隐藏或窗口失焦时',
      grace: '宽限时间（毫秒）',
      graceHint: '允许 0–300000 毫秒；0 表示立即暂停。宽限期内返回会取消暂停计时。',
      invalid: '请输入 0–300000 之间的整数宽限时间。',
      inherit: '继承全局设置',
      inheritHint: '关闭继承后，仅此 Profile 使用下方配置。下一次打开或重新连接 Viewer 时生效。',
      behavior:
        '暂停仅停止音视频传输并禁用输入，远端页面继续运行。返回后恢复自动暂停的传输，也可点击恢复按钮。',
    },
  },
  'en-US': {
    focus: {
      title: 'Viewer focus suspension',
      globalHint:
        'Used by Profiles without an override. Saved settings apply when a Viewer is next opened or reconnected; current Viewers keep their configuration.',
      mode: 'Suspend when',
      NEVER: 'Never automatically',
      WHEN_HIDDEN: 'The page is hidden',
      WHEN_UNFOCUSED: 'The page is hidden or window loses focus',
      grace: 'Grace period (milliseconds)',
      graceHint:
        'An integer from 0 to 300000; 0 suspends immediately. Returning during the grace period cancels the timer.',
      invalid: 'Enter an integer grace period from 0 to 300000 milliseconds.',
      inherit: 'Inherit global settings',
      inheritHint:
        'Turn off inheritance to use a policy for this Profile. It applies when a Viewer is next opened or reconnected.',
      behavior:
        'Suspension stops audio/video and disables input while the remote page keeps running. Returning resumes automatically paused streams; a Resume button is also available.',
    },
  },
}
