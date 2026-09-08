export const maintenanceZh = {
  title: 'Profile 维护',
  intro:
    '独占浏览器环境，完成网站登录、配置或脚本验证。维护结束后，登录态保留供后续 Session 使用。',
  start: '开始维护',
  continue: '继续维护',
  preparing: '准备维护',
  active: '维护中',
  cleaning: '清理中',
  disabled: '已停用',
  occupancy: '普通会话：{count} 个',
  owner: '维护者：{name}',
  cleaningHint: '正在确认标签页和附属窗口已清理。清理完成前，仍不能创建新会话。',
  empty: '没有匹配的 Profile。请调整搜索，或联系管理员创建浏览器环境。',
  startHint:
    '开始维护会结束此 Profile 的全部普通 Session，未保存的页面内容可能丢失。维护期间禁止新普通 Session；网站登录与存储的修改会影响后续使用者。',
  drainAndStart: '结束普通会话并开始维护',
  startingHint:
    '正在结束此 Profile 的普通会话并准备独占维护标签页。页面会自动更新；也可返回维护清单查看进度。',
  leaveHint: '返回列表只断开 Viewer，维护仍占用此 Profile。完成后请结束维护。',
  end: '结束维护',
  endTitle: '结束这个维护 Session？',
  endHint:
    '“{name}”的维护标签页、附属窗口和临时文件将被清理，未保存的页面内容可能丢失。Profile 的网站登录态与存储保留；清理确认后恢复普通会话准入。',
  test: '在维护中测试',
  testTitle: '测试已保存的 Page Script',
  testSnapshot:
    '本次维护会固定使用所选已保存版本的源码，不受后续草稿编辑影响。已有维护 Session 不会切换脚本；需结束后重新测试。',
  saveFirst: '先保存草稿，再测试实际保存的源码。',
  backScript: '返回 Page Script',
  blocked: {
    PROFILE_MAINTENANCE_ACTIVE: '此 Profile 已有维护 Session。',
    PROFILE_DISABLED: 'Profile 已停用，请先由管理员启用。',
    PROFILE_NOT_READY: '浏览器正在切换运行状态，请稍后刷新。',
    PROFILE_HEALTHCHECK_REQUIRED: '请先由管理员配置健康检查。',
    WORKER_UNAVAILABLE: '浏览器服务器当前不可用。',
    WORKER_PROTOCOL_INCOMPATIBLE: '浏览器服务器需要升级后才能维护。',
  },
}
export const maintenanceEn = {
  title: 'Profile maintenance',
  intro:
    'Exclusively use a browser environment to sign in, configure websites, or verify scripts. Website sign-ins persist for later Sessions.',
  start: 'Start maintenance',
  continue: 'Continue maintenance',
  preparing: 'Preparing maintenance',
  active: 'Under maintenance',
  cleaning: 'Cleaning up',
  disabled: 'Disabled',
  occupancy: 'Normal Sessions: {count}',
  owner: 'Maintainer: {name}',
  cleaningHint:
    'Waiting for confirmation that tabs and child windows are closed. New Sessions remain blocked until cleanup finishes.',
  empty:
    'No matching Profiles. Adjust the search or ask an administrator to create a browser environment.',
  startHint:
    'Starting maintenance ends every normal Session in this Profile. Unsaved work may be lost. New normal Sessions are blocked during maintenance; changes to website sign-ins and storage affect later users.',
  drainAndStart: 'End normal Sessions and start maintenance',
  startingHint:
    'Ending normal Sessions and preparing the exclusive maintenance tab. This page updates automatically; you can also return to the maintenance list.',
  leaveHint:
    'Returning disconnects this Viewer but keeps the Profile under maintenance. End maintenance when finished.',
  end: 'End maintenance',
  endTitle: 'End this maintenance Session?',
  endHint:
    'The maintenance tab, child windows and temporary files for “{name}” will be cleared. Unsaved work may be lost. Website sign-ins and Profile storage persist; normal Sessions can resume after cleanup is confirmed.',
  test: 'Test in maintenance',
  testTitle: 'Test the saved Page Script',
  testSnapshot:
    'This maintenance Session uses the selected saved source, unaffected by later draft edits. Existing maintenance Sessions do not switch scripts; end them before testing again.',
  saveFirst: 'Save the draft before testing its saved source.',
  backScript: 'Back to Page Script',
  blocked: {
    PROFILE_MAINTENANCE_ACTIVE: 'This Profile already has a maintenance Session.',
    PROFILE_DISABLED: 'The Profile is disabled. Ask an administrator to enable it.',
    PROFILE_NOT_READY: 'The browser is changing runtime state. Refresh shortly.',
    PROFILE_HEALTHCHECK_REQUIRED: 'An administrator must configure a health check first.',
    WORKER_UNAVAILABLE: 'The browser server is unavailable.',
    WORKER_PROTOCOL_INCOMPATIBLE: 'The browser server must be upgraded for maintenance.',
  },
}
