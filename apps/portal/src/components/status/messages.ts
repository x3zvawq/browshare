export const portalStatusMessages = {
  'zh-CN': {
    routeFailure: {
      loading: '正在连接 BrowShare…',
      'page-unavailable': {
        title: '页面资源加载失败',
        description: '网络中断或站点更新可能使此页面暂时无法打开。连接恢复后，可重新加载原页面。',
      },
      reloadPage: '重新加载原页面',
      reloadHint: '此操作会重新加载整个页面，未保存的修改可能丢失。页面不会自动刷新。',
      'not-found': {
        title: '找不到这个页面',
        description: '地址可能已更改，或页面已被移除。请检查地址，或返回入口继续。',
      },
      forbidden: {
        title: '你没有访问此页面的权限',
        description: '当前账户无法打开此页面。如管理员已调整权限，可以重新检查后继续。',
      },
      unavailable: {
        title: '暂时无法连接 BrowShare',
        description: '无法确认当前登录状态。请检查网络，或等待服务恢复后重试；已有登录信息会保留。',
      },
      incompatible: {
        title: 'Portal 与服务端 API 版本不兼容',
        description: '请使用与服务端 API 匹配的 Portal。部署完成后，可重新检查并继续访问原页面。',
      },
      upgradeHint: '请由管理员协调更新 Portal 与 Backend；产品补丁版本不同不会触发此限制。',
      portalApi: 'Portal 支持的 API',
      backendApi: 'Backend API',
      retry: '重新连接',
      checkAccess: '重新检查权限',
      retryFailed: '仍无法连接服务，请稍后重试。',
      deniedAgain: '已重新检查，当前账户仍无权访问此页面。',
      home: '返回入口',
      restoreTarget: '恢复后会继续打开你原来访问的页面。',
      requestId: '请求 ID',
      code: '错误代码',
    },
    liveUpdates: {
      connected: '状态通知已连接',
      connecting: '正在连接状态通知',
      reconnecting: '状态通知已断开，正在重连',
      paused: '状态通知已暂停',
      unauthorized: '状态通知需要重新验证权限',
      accessChanged: '请重新检查权限或登录。已失去读取权限的数据将不再显示。',
      retained: '已显示的数据会保留，可手动刷新获取最新状态。',
      viewerRetained: '业务状态可能延迟，此提示不代表远程画面连接中断。',
      lastRead: '最近读取',
      noSnapshot: '尚未成功读取数据',
      refresh: '刷新状态',
    },
  },
  'en-US': {
    routeFailure: {
      loading: 'Connecting to BrowShare…',
      'page-unavailable': {
        title: 'Page resources could not be loaded',
        description:
          'A connection problem or site update may have made this page unavailable. Reload the original page when your connection is restored.',
      },
      reloadPage: 'Reload original page',
      reloadHint:
        'This reloads the entire page. Unsaved changes may be lost. The page will not refresh automatically.',
      'not-found': {
        title: 'Page not found',
        description:
          'The address may have changed or the page may have been removed. Check the address or return to the app.',
      },
      forbidden: {
        title: 'You do not have access to this page',
        description:
          'Your account cannot open this page. If an administrator has changed your permissions, check access again to continue.',
      },
      unavailable: {
        title: 'BrowShare is temporarily unavailable',
        description:
          'Your session could not be verified. Check your connection or retry when the service recovers. Your existing sign-in information is retained.',
      },
      incompatible: {
        title: 'Portal and Backend API versions are incompatible',
        description:
          'Use a Portal that supports the Backend API. After deployment, check again to continue to your original page.',
      },
      upgradeHint:
        'Ask an administrator to coordinate the Portal and Backend versions. Different product patch versions do not cause this restriction.',
      portalApi: 'Portal supports API',
      backendApi: 'Backend API',
      retry: 'Reconnect',
      checkAccess: 'Check access again',
      retryFailed: 'The service is still unavailable. Please try again shortly.',
      deniedAgain: 'Access checked. Your account still cannot open this page.',
      home: 'Return to the app',
      restoreTarget: 'After recovery, you will return to the page you were opening.',
      requestId: 'Request ID',
      code: 'Error code',
    },
    liveUpdates: {
      connected: 'Status notifications connected',
      connecting: 'Connecting status notifications',
      reconnecting: 'Status notifications disconnected; reconnecting',
      paused: 'Status notifications paused',
      unauthorized: 'Status notifications require an access check',
      accessChanged: 'Check access or sign in again. Data you can no longer read will be cleared.',
      retained: 'Displayed data is retained. Refresh manually to get the latest status.',
      viewerRetained:
        'Business status may be delayed. This does not indicate a remote video disconnection.',
      lastRead: 'Last read',
      noSnapshot: 'No successful data read yet',
      refresh: 'Refresh status',
    },
  },
}
