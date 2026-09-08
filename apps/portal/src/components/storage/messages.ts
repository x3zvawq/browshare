export const storageMessages = {
  'zh-CN': {
    storage: {
      title: '存储保护',
      quotaStates: { OK: '额度内', EXCEEDED: '额度受限', UNKNOWN: '用量未知' },
      diskStates: {
        OK: '磁盘正常',
        LOW_DISK: '磁盘空间不足',
        CRITICAL_DISK: '磁盘空间严重不足',
        UNKNOWN: '磁盘状态未知',
      },
      availableInodes: '可用 inode',
      totalInodes: 'inode 总量',
      inodesExhausted:
        '此卷的 inode 已耗尽，即使仍有可用字节，也无法创建新文件，按 CRITICAL 限制新增操作。',
      available: '可用空间',
      total: '卷总空间',
      profilesVolume: 'Profile 所在卷',
      temporaryVolume: '临时文件所在卷',
      lowThreshold: 'LOW 生效阈值',
      criticalThreshold: 'CRITICAL 生效阈值',
      thresholdFormula: '实际阈值取固定字节数和卷总空间比例中的较大值。',
      lowConfigured: 'LOW 环境配置',
      criticalConfigured: 'CRITICAL 环境配置',
      stale: 'Worker 尚未就绪，以下为最后上报事实，不能代表当前准入状态。',
      lowDiskWorkers: 'LOW 磁盘 Worker',
      criticalDiskWorkers: 'CRITICAL 磁盘 Worker',
      quotaExceededWorkers: '额度受限 Worker',
      quotaExceededProfiles: '额度受限 Profile',
      unknownWorkers: '存储状态未知 Worker',
      pendingWorkers: '存储策略待应用 Worker',
      pendingProfiles: '存储策略待应用 Profile',
      unknownProfiles: '存储状态未知 Profile',
      quotaLabel: '存储软额度（字节）',
      unlimited: '不限额',
      profileScope:
        'Profile 额度统计持久 Chrome 用户目录，包含该 Profile 的网站登录态与浏览器数据。',
      workerScope:
        'Worker 额度统计全部业务 Profile 与临时上传、下载 spool 和保留文件，重叠根目录去重，不含身份、发布目录和日志。',
      softHint: '软额度限制相关新增操作；不会截断现有 Chrome 文件，也不会主动断开已有 Session。',
      zeroHint: '额度为 0 时拒绝相关新增写入。',
      invalidQuota: '请输入 0 至 {maximum} 之间的整数字节数，或选择不限额。',
      quotaBelowUsage:
        '保存的额度不高于当前用量，相关新增操作可能被拒绝。可提高额度或清理不再需要的数据后恢复。',
      used: '已用空间',
      expectedQuota: '期望额度',
      appliedQuota: '已应用额度',
      pending: '待应用',
      applied: '已应用',
      unknown: '尚无有效采样',
      observed: '采样时间',
      expectedVersion: '期望策略版本',
      appliedVersion: '已应用策略版本',
      pendingHint: 'Worker 尚未确认此版本。额度已保存，实际准入状态以 Worker 确认与新采样为准。',
      diskSettings:
        '磁盘 LOW／CRITICAL 阈值由 Worker 环境变量配置，修改后需按部署流程重启 Worker。',
      lowHint: '磁盘空间不足，暂停新浏览器启动、Session 和导入；已有 Session 可以继续。',
      criticalHint:
        '磁盘空间严重不足，暂停新浏览器、Session、导入、上传和下载；已有 Session 不会被主动断开。',
      quotaHint:
        '存储额度已达到限制，相关新增操作被暂停。提高额度或安全清理数据后，等待 Worker 确认并重新采样。',
      recovery:
        '请管理员检查 Worker 空间和额度，释放不再需要的存储或调整软额度；恢复后刷新状态再重试。',
      edit: '调整存储额度',
      save: '保存额度',
      saved: '存储额度已保存',
      cancel: '取消',
      close: '关闭',
      failed: '无法保存存储额度，请重试。',
      permission: '当前账户可查看存储状态；调整额度需要管理权限。',
      blocks: {
        LOW_DISK: '磁盘空间不足',
        CRITICAL_DISK: '磁盘空间严重不足',
        WORKER_STORAGE_QUOTA_EXCEEDED: 'Worker 存储额度受限',
        PROFILE_STORAGE_QUOTA_EXCEEDED: 'Profile 存储额度受限',
        STORAGE_UNAVAILABLE: '存储状态暂不可确认',
        STORAGE_POLICY_STALE: '存储策略待确认',
      },
      unavailableHint: 'Worker 尚未提供可用于准入的存储事实，请等待重新采样。',
    },
  },
  'en-US': {
    storage: {
      title: 'Storage protection',
      quotaStates: { OK: 'Within quota', EXCEEDED: 'Quota restricted', UNKNOWN: 'Usage unknown' },
      diskStates: {
        OK: 'Disk normal',
        LOW_DISK: 'Low disk space',
        CRITICAL_DISK: 'Critically low disk space',
        UNKNOWN: 'Disk state unknown',
      },
      availableInodes: 'Available inodes',
      totalInodes: 'Total inodes',
      inodesExhausted:
        'This volume has no free inodes. New files cannot be created even if bytes remain available, so CRITICAL restrictions apply.',
      available: 'Available space',
      total: 'Volume total',
      profilesVolume: 'Profile volume',
      temporaryVolume: 'Temporary file volume',
      lowThreshold: 'Effective LOW threshold',
      criticalThreshold: 'Effective CRITICAL threshold',
      thresholdFormula:
        'The effective threshold is the larger of the fixed byte value and the proportion of total volume space.',
      lowConfigured: 'LOW environment configuration',
      criticalConfigured: 'CRITICAL environment configuration',
      stale:
        'The Worker is not ready. These are its last reported facts, not current admission state.',
      lowDiskWorkers: 'Workers with LOW disk',
      criticalDiskWorkers: 'Workers with CRITICAL disk',
      quotaExceededWorkers: 'Workers at storage quota',
      quotaExceededProfiles: 'Profiles at storage quota',
      unknownWorkers: 'Workers with unknown storage',
      pendingWorkers: 'Workers awaiting storage policy',
      pendingProfiles: 'Profiles awaiting storage policy',
      unknownProfiles: 'Profiles with unknown storage',
      quotaLabel: 'Storage soft quota (bytes)',
      unlimited: 'No quota limit',
      profileScope:
        'The Profile quota covers its persistent Chrome user directory, including website sign-in state and browser data.',
      workerScope:
        'The Worker quota covers all business Profiles, temporary uploads, download spool files and retained files. Overlapping roots are counted once; identity, releases and logs are excluded.',
      softHint:
        'Soft quotas restrict related new operations. Existing Chrome files are not truncated and active sessions are not forcibly disconnected.',
      zeroHint: 'A quota of 0 rejects related new writes.',
      invalidQuota: 'Enter an integer from 0 to {maximum} bytes, or select no quota limit.',
      quotaBelowUsage:
        'The saved quota would not exceed current usage, so related new operations may be rejected. Increase it or remove unneeded data to recover.',
      used: 'Storage used',
      expectedQuota: 'Desired quota',
      appliedQuota: 'Applied quota',
      pending: 'Pending application',
      applied: 'Applied',
      unknown: 'No valid sample yet',
      observed: 'Sample time',
      expectedVersion: 'Desired policy version',
      appliedVersion: 'Applied policy version',
      pendingHint:
        'The Worker has not confirmed this version. The quota is saved; actual admission depends on Worker confirmation and a new sample.',
      diskSettings:
        'Disk LOW/CRITICAL thresholds are configured through Worker environment variables. Changes require a Worker restart through the deployment process.',
      lowHint:
        'Disk space is low. New browser starts, sessions and imports are paused. Existing sessions may continue.',
      criticalHint:
        'Disk space is critically low. New browsers, sessions, imports, uploads and downloads are paused. Existing sessions are not forcibly disconnected.',
      quotaHint:
        'Storage has reached its quota and related new operations are paused. Increase the quota or safely remove data, then wait for Worker confirmation and a new sample.',
      recovery:
        'Ask an administrator to check Worker space and quotas, free unneeded storage or adjust the soft quota. Refresh and retry after recovery.',
      edit: 'Adjust storage quota',
      save: 'Save quota',
      saved: 'Storage quota saved',
      cancel: 'Cancel',
      close: 'Close',
      failed: 'The storage quota could not be saved. Please retry.',
      permission:
        'Your account can view storage state. Changing quotas requires management permission.',
      blocks: {
        LOW_DISK: 'Low disk space',
        CRITICAL_DISK: 'Critically low disk space',
        WORKER_STORAGE_QUOTA_EXCEEDED: 'Worker storage quota restricted',
        PROFILE_STORAGE_QUOTA_EXCEEDED: 'Profile storage quota restricted',
        STORAGE_UNAVAILABLE: 'Storage state cannot be confirmed',
        STORAGE_POLICY_STALE: 'Storage policy awaiting confirmation',
      },
      unavailableHint:
        'The Worker has not provided storage facts suitable for admission. Wait for a new sample.',
    },
  },
}
