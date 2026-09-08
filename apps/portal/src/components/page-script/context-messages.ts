export const profileContextMessages = {
  'zh-CN': {
    profileContext: {
      title: '用户页面变量',
      intro:
        '为此 Profile 的指定用户配置 Page Script 上下文。保存不会授予该用户访问 Profile 的权限。',
      publicHint:
        '这些变量会通过 event.detail.context.variables 公开给目标页面。不要填写密码、Cookie、Token、代理凭据或其他秘密；服务端会拒绝敏感变量。',
      snapshotHint:
        '保存只对该用户此后创建的新 Session 生效；已有 Session 保留创建时的上下文快照。',
      target: '目标用户',
      empty: '选择用户后查看或编辑此 Profile 的页面变量。',
      readonly: '查看和编辑用户页面变量均需要 profile.manage 权限。',
      json: '变量 JSON 对象',
      rules:
        '必须是 JSON 对象，序列化后不超过 32 KiB、嵌套不超过 8 层。空对象会清空该用户在此 Profile 的变量。',
      invalidJson: '请输入有效的 JSON 对象；不能使用数组、字符串或 null。',
      tooLarge: 'JSON 对象序列化后的 UTF-8 大小不能超过 32 KiB。',
      savedAt: '最近保存',
      neverSaved: '尚未保存变量，默认使用空对象。',
      unsaved: '有未保存的变量修改',
      clean: '与已保存变量一致',
      save: '保存用户变量',
      saved: '用户变量已保存，将用于新 Session',
      clear: '将变量清空为空对象',
      refresh: '重新读取变量',
      loading: '正在读取此用户的变量…',
      retry: '重试读取',
      discardTitle: '放弃未保存的变量修改？',
      discardHint: '切换用户、重新读取或离开页面会丢弃当前变量草稿。',
      discard: '放弃修改',
      keep: '继续编辑',
      failed: '无法完成用户变量操作',
      errors: {
        NETWORK_ERROR: '无法连接服务器。草稿已保留，请恢复网络后重试。',
        BAD_REQUEST:
          '变量未通过服务端校验。请检查对象大小、嵌套层数，以及是否含凭据、密码、Cookie 或 Token。草稿已保留。',
        VALIDATION_FAILED: '变量格式未通过校验，请按 JSON 对象要求修改。草稿已保留。',
        FORBIDDEN: '当前账户无权管理用户变量。请检查权限后重试。',
        NOT_FOUND: '目标用户或 Profile 不存在，或已被删除。',
        CONFLICT: 'Profile 正在删除，暂时不能保存变量。',
        UNKNOWN: '操作失败，草稿已保留。请稍后重试。',
      },
    },
  },
  'en-US': {
    profileContext: {
      title: 'User page variables',
      intro:
        'Configure Page Script context for one user in this Profile. Saving variables does not grant access to the Profile.',
      publicHint:
        'These variables are exposed to the destination page through event.detail.context.variables. Do not enter passwords, Cookies, Tokens, Proxy credentials or other secrets. The server rejects sensitive variables.',
      snapshotHint:
        'Saving affects only new Sessions created for this user. Existing Sessions retain their context snapshot from creation.',
      target: 'Target user',
      empty: 'Select a user to view or edit page variables for this Profile.',
      readonly: 'Viewing and editing user page variables both require profile.manage permission.',
      json: 'Variables as a JSON object',
      rules:
        'Use a JSON object, at most 32 KiB when serialized and no more than 8 levels deep. An empty object clears this user’s variables for the Profile.',
      invalidJson: 'Enter a valid JSON object, not an array, string or null.',
      tooLarge: 'The serialized JSON object must not exceed 32 KiB in UTF-8.',
      savedAt: 'Last saved',
      neverSaved: 'No variables have been saved. An empty object is used by default.',
      unsaved: 'Unsaved variable changes',
      clean: 'Matches saved variables',
      save: 'Save user variables',
      saved: 'User variables saved for new Sessions',
      clear: 'Clear variables to an empty object',
      refresh: 'Reload variables',
      loading: 'Loading this user’s variables…',
      retry: 'Retry loading',
      discardTitle: 'Discard unsaved variable changes?',
      discardHint:
        'Switching users, reloading or leaving the page discards the current variable draft.',
      discard: 'Discard changes',
      keep: 'Keep editing',
      failed: 'User variable operation failed',
      errors: {
        NETWORK_ERROR:
          'The server could not be reached. Your draft is preserved. Restore the connection and retry.',
        BAD_REQUEST:
          'The server rejected these variables. Check object size, nesting, and credentials, passwords, Cookies or Tokens. Your draft is preserved.',
        VALIDATION_FAILED:
          'The variables did not pass validation. Follow the JSON object requirements. Your draft is preserved.',
        FORBIDDEN: 'Your account cannot manage user variables. Check permissions before retrying.',
        NOT_FOUND: 'The target user or Profile does not exist or has been deleted.',
        CONFLICT: 'The Profile is being deleted and variables cannot be saved.',
        UNKNOWN: 'The operation failed. Your draft is preserved. Please retry later.',
      },
    },
  },
}
