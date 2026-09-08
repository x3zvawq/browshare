export const setupMessages = {
  'zh-CN': {
    setup: {
      title: '初始化 BrowShare',
      description: '验证部署者身份并创建首位管理员。此操作只能完成一次。',
      token: '初始化 Token',
      tokenHint: '由部署者提供的一次性初始化凭据。它不是管理员登录密码。',
      displayName: '管理员显示名称',
      email: '管理员邮箱',
      password: '管理员密码',
      confirmation: '确认管理员密码',
      create: '创建管理员并完成初始化',
      recheck: '重新检查初始化状态',
      login: '前往登录',
      disabledTitle: '等待部署者配置初始化',
      disabled:
        '当前系统尚未初始化，交互式初始化凭据也未配置。请联系部署者提供初始化 Token，或通过部署配置创建首位管理员，完成后重新检查。',
      completeTitle: '初始化完成',
      complete: '首位管理员已创建。请使用刚设置的邮箱与密码登录。',
      alreadyTitle: '系统已完成初始化',
      already: '另一项初始化操作已先完成。现有管理员没有被覆盖，请使用已创建的账户登录。',
      requestId: '请求 ID',
      required: '请填写此项',
      emailInvalid: '请输入有效邮箱',
      passwordLength: '密码至少包含 10 个字符',
      mismatch: '两次输入的密码不一致',
      errors: {
        BOOTSTRAP_TOKEN_INVALID: '初始化 Token 未被接受，请向部署者核对。',
        BOOTSTRAP_DISABLED: '部署者尚未启用交互式初始化，请重新检查状态。',
        BOOTSTRAP_STATE_INCONSISTENT: '数据库初始化状态不一致，请联系部署者处理。',
        VALIDATION_FAILED: '请检查填写内容是否符合要求。',
        UNKNOWN: '无法完成请求，请稍后重试。已填写的内容会保留。',
      },
    },
  },
  'en-US': {
    setup: {
      title: 'Initialize BrowShare',
      description:
        'Verify operator access and create the first administrator. Initialization can complete only once.',
      token: 'Initialization Token',
      tokenHint:
        'A one-time initialization credential supplied by the operator. It is separate from your administrator password.',
      displayName: 'Administrator display name',
      email: 'Administrator email',
      password: 'Administrator password',
      confirmation: 'Confirm administrator password',
      create: 'Create administrator and initialize',
      recheck: 'Check initialization status again',
      login: 'Go to sign in',
      disabledTitle: 'Waiting for the deployment operator',
      disabled:
        'This system is not initialized and interactive initialization is not configured. Ask the operator to supply an initialization Token or create the first administrator through deployment configuration, then check again.',
      completeTitle: 'Initialization complete',
      complete:
        'The first administrator has been created. Sign in with the email and password you just set.',
      alreadyTitle: 'This system is already initialized',
      already:
        'Another initialization completed first. The existing administrator was preserved. Sign in with the account that was created.',
      requestId: 'Request ID',
      required: 'This field is required',
      emailInvalid: 'Enter a valid email address',
      passwordLength: 'Use at least 10 characters',
      mismatch: 'The passwords do not match',
      errors: {
        BOOTSTRAP_TOKEN_INVALID:
          'The initialization Token was not accepted. Check it with the operator.',
        BOOTSTRAP_DISABLED:
          'Interactive initialization is not enabled. Check the current status again.',
        BOOTSTRAP_STATE_INCONSISTENT:
          'The database initialization state is inconsistent. Contact the operator.',
        VALIDATION_FAILED: 'Check that the form values meet the requirements.',
        UNKNOWN:
          'The request could not be completed. Try again later; your form values are preserved.',
      },
    },
  },
}
