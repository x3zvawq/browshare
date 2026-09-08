export const workerCleanupMessages = {
  'zh-CN': {
    workerCleanup: {
      title: '对账与待清理资源',
      connectedNotReady:
        'Worker 身份已认证，控制连接仍然保持，但尚未完成检查或状态对账，不能接收新的 Session 调度。',
      disconnected:
        '控制连接已断开。下方为最后收到的待清理事实，当前清理结果须等待 Worker 重新连接并完成对账后确认。',
      pending:
        '以下为 Worker 上报的清理失败资源。每条记录的登记状态由服务端确认；错误码和时间来自最近收到的运行时事实。',
      recovery:
        '已登记对象可在 Profile 或 Session 管理中处理；未登记对象由 Worker 对账清理。此处不对任意上报 ID 提供操作。',
      empty: '最近收到的状态中没有清理失败记录。',
      waiting: '尚未就绪不能说明清理已经完成，请等待后续状态更新。',
      restricted: '查看相关 Profile、Session 标识及管理入口需要 profile.read 权限。',
      PROFILE: 'Profile 运行时清理失败',
      SESSION: 'Session 清理失败',
      registered: '已登记',
      unregistered: '未登记',
      profile: 'Profile ID',
      session: 'Session ID',
      runtime: 'Runtime ID',
      generation: '运行代次',
      code: '错误码',
      occurredAt: '发生时间',
      profiles: '打开 Profile 管理',
      sessions: '打开 Session 管理',
      count: '待清理记录：{count}',
    },
  },
  'en-US': {
    workerCleanup: {
      title: 'Reconciliation and pending cleanup',
      connectedNotReady:
        'The Worker is authenticated and its control connection is still active. Checks or state reconciliation are not complete, so it cannot accept new Session scheduling.',
      disconnected:
        'The control connection is disconnected. These are the last received cleanup facts. Current cleanup results require the Worker to reconnect and reconcile.',
      pending:
        'These resources failed cleanup according to the Worker. The server confirms each record’s registration status. Error codes and times come from the most recently received runtime facts.',
      recovery:
        'Use Profile or Session management for registered objects. Worker reconciliation handles unregistered objects. This panel provides no actions against arbitrary reported IDs.',
      empty: 'The most recently received state contains no cleanup failure records.',
      waiting:
        'Not being ready does not confirm cleanup is complete. Wait for further state updates.',
      restricted:
        'Viewing related Profile and Session IDs and management links requires profile.read permission.',
      PROFILE: 'Profile runtime cleanup failed',
      SESSION: 'Session cleanup failed',
      registered: 'Registered',
      unregistered: 'Unregistered',
      profile: 'Profile ID',
      session: 'Session ID',
      runtime: 'Runtime ID',
      generation: 'Runtime generation',
      code: 'Error code',
      occurredAt: 'Occurred at',
      profiles: 'Open Profile management',
      sessions: 'Open Session management',
      count: 'Pending cleanup records: {count}',
    },
  },
}
