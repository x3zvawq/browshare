export const diagnosticsZh = {
  title: '管理员诊断包',
  intro:
    '生成当前系统或指定 Session 的状态快照，供人工排查。不会触发 Chrome 探测或中断正在运行的 Session。',
  privacy:
    '包含内部资源 ID、版本、采样时间和审计关联；不包含名称、地址、页面正文、凭据、脚本、文件内容或原始日志。文件仅下载到本机，请按内部诊断资料保管。',
  permission: '需要系统管理、Worker 查看、Profile 查看和审计查看权限。',
  session: 'Session ID（可选）',
  placeholder: '留空采样整个系统',
  invalid: '请输入完整的 Session UUID，或留空。',
  generate: '生成诊断包',
  download: '下载 JSON',
  preview: '查看 JSON',
  generated: '诊断包已生成',
  observed: '采样完成时间',
  limit:
    '每类最多保留 200 条最近记录；各组件采样存在时间差。指定 Session 时，包含该 Session、所属 Profile/Worker 及该 Session 的审计关联。',
  counts: 'Worker {workers} · Profile {profiles} · Session {sessions} · 审计 {audit}',
  truncated: '部分记录已截断；请填写具体 Session ID 重新生成，或在管理页面查询更多记录。',
  failed: '诊断包生成失败，可重试。',
  missing: '未找到该 Session，可能已按保留策略清理。',
  forbidden: '诊断权限不足或已撤销，请检查账户权限。',
  requestId: '请求 ID',
}
export const diagnosticsEn = {
  title: 'Administrator diagnostics',
  intro:
    'Capture current system state or a specific Session for investigation. This does not run a Chrome probe or interrupt active Sessions.',
  privacy:
    'Contains internal resource IDs, versions, observation times and audit correlations. Excludes names, addresses, page content, credentials, scripts, file content and raw logs. Downloads stay on this device; handle them as internal diagnostic data.',
  permission: 'Requires system management, Worker read, Profile read and audit read permissions.',
  session: 'Session ID (optional)',
  placeholder: 'Leave blank for a system snapshot',
  invalid: 'Enter a complete Session UUID or leave this empty.',
  generate: 'Generate diagnostics',
  download: 'Download JSON',
  preview: 'Inspect JSON',
  generated: 'Diagnostics generated',
  observed: 'Collection completed',
  limit:
    'Each section includes at most 200 recent records. Component observations may differ in time. A Session scope includes that Session, its Profile/Worker and its audit correlations.',
  counts: 'Workers {workers} · Profiles {profiles} · Sessions {sessions} · Audit {audit}',
  truncated:
    'Some records were truncated. Enter a specific Session ID to generate a focused snapshot, or use the administration pages for more records.',
  failed: 'Could not generate diagnostics. Try again.',
  missing: 'This Session was not found; retention may have removed it.',
  forbidden: 'Diagnostic access is missing or was revoked. Check your account permissions.',
  requestId: 'Request ID',
}
