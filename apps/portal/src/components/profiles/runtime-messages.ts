export const profileRuntimeMessages = {
  'zh-CN': {
    runtimeRecovery: {
      dataMissing:
        '持久浏览器数据缺失。请管理员在原 Worker 上恢复此 Profile 的备份后，再手动启动。',
      action: '停止并结束全部会话',
      actionLabel: '停止 {name} 并结束其全部会话',
      title: '停止 Profile 并结束全部会话',
      description:
        '将结束“{name}”的全部普通和维护会话，并停止其 Chrome。已连接的用户会断开，尚未保存的页面操作可能丢失；持久登录态会保留。',
      cleanupHint: '请求接受后仍需等待 Worker 确认清理完成，期间不会提前释放会话占用。',
      alwaysOnHint: '此 Profile 为常驻模式。确认后会同时改为手动模式，避免 Chrome 自动重新启动。',
      failed: '停止请求未完成，请检查错误并重试。',
      blocks: {
        WORKER_UNAVAILABLE: 'Worker 认证控制连接不可用，恢复连接后再操作',
        WORKER_PROTOCOL_INCOMPATIBLE: '此 Worker 版本不支持恢复停止，请先升级',
        RUNTIME_UNOBSERVED: '等待当前 Worker 上报此运行实例后再操作',
        RUNTIME_STOPPED: '此 Profile 已停止，无需恢复清理',
      },
      errors: {
        NETWORK_ERROR: '无法连接服务器。恢复网络后可重试此请求。',
        FORBIDDEN: '当前账户无权停止此 Profile。',
        NOT_FOUND: 'Profile 或归属 Worker 已不存在，请关闭后刷新列表。',
        WORKER_OFFLINE: 'Worker 控制连接不可用，连接恢复后可重试。',
        CONFLICT: '当前状态暂不允许停止，请刷新 Profile 后重试。',
      },
    },
  },
  'en-US': {
    runtimeRecovery: {
      dataMissing:
        'Persistent browser data is missing. Ask an administrator to restore this Profile’s backup on its original Worker, then start it manually.',
      action: 'Stop and end all sessions',
      actionLabel: 'Stop {name} and end all of its sessions',
      title: 'Stop Profile and end all sessions',
      description:
        'End every normal and maintenance session in “{name}” and stop its Chrome. Connected users will be disconnected and unsaved page work may be lost. Persistent login state is retained.',
      cleanupHint:
        'After acceptance, Worker must still confirm cleanup. Session capacity remains occupied until cleanup completes.',
      alwaysOnHint:
        'This Profile is always on. Confirming also changes it to manual mode so Chrome does not restart automatically.',
      failed: 'The stop request did not complete. Check the error and retry.',
      blocks: {
        WORKER_UNAVAILABLE: 'The authenticated Worker control connection is unavailable',
        WORKER_PROTOCOL_INCOMPATIBLE: 'Upgrade this Worker to support recovery stops',
        RUNTIME_UNOBSERVED: 'Wait for the current Worker to report this runtime instance',
        RUNTIME_STOPPED: 'This Profile is already stopped; recovery is not needed',
      },
      errors: {
        NETWORK_ERROR: 'Cannot reach the server. Restore the connection and retry this request.',
        FORBIDDEN: 'Your account cannot stop this Profile.',
        NOT_FOUND: 'The Profile or its Worker no longer exists. Close and refresh the list.',
        WORKER_OFFLINE: 'The Worker control connection is unavailable. Retry after it reconnects.',
        CONFLICT: 'The current state does not allow this stop. Refresh the Profile and retry.',
      },
    },
  },
}
