# 下载保留与领取

产品要求下载完成后默认保留 30 分钟；Session 结束时，未领取文件的截止时间收紧为
`min(原截止时间, Session结束时间 + 10分钟)`，不得因重连、重启或重复结束而延长。
文件的保留不延长 Chrome、Extension 捕获或 Remote Tab Session 的生命周期。

## 当前实现与交接边界

Remote Tab 0.1.21 提供可选 `SessionDownloadSink`，用于将完成的 Chrome 下载交给 Embedder。
其同步 `reserve` 在下载长度变化时预留或调整空间；`commit` 在完成持久接收后返回；
`abort` 幂等释放未提交的预留。Core 保留 Chrome 来源归属、文件大小和下载过程校验。
配置 sink 后，无 Viewer 或 Viewer 断开不影响已授权下载完成，不再向 Viewer 发送即时文件 offer。
Session 关闭等待已完成文件的交接和异步取消，然后清理未完成下载。

Worker 的 `WorkerRetainedDownloads` 已实现本机文件与清单存储。下载目录必须位于 Profile 和
Session 临时目录之外，且与 Chrome spool 在同一文件系统。完成文件通过重命名交接到内部
UUIDv7 目录；文件内容路径固定为 `data`，展示文件名只进入元数据，不能参与路径拼接。
清单提交后才发布 AVAILABLE 记录；进程重启从清单恢复，并清理未完成的 staging 目录。

Worker 主运行时已接入此存储，使用固定的完成后 30 分钟、结束后最多 10 分钟产品默认值。
构建配置与运行时加载要求 Remote Tab Core 0.1.21，防止旧 Core 忽略 sink 并走即时传输。
控制面元数据已通过 Control 1.16 按有界批次同步到 Backend 的 session_downloads 表。
Backend 列表、领取凭据与 mTLS 消费/复查接口已实现；Worker 独立文件监听入口已接入 Control 1.17。
Portal 已接入“我的 Sessions”的下载收件箱。2026-09-06 候选部署通过真实 Google Chrome Stable
下载来源、Worker CLI、Control 1.17 元数据与领取鉴权、跨源 HTTPS 原生保存的完整路径验收；
覆盖已结束 Session、Worker 重启、离线/恢复、错误重试，以及未领取文件的真实 10 分钟到期清理。
部署使用测试证书和私有入口；公开入口、正式证书及完整发布 Gate 仍按部署验收要求执行。

## 归属与状态

记录包含 `id`、`sessionId`、`displayName`、`size`、`status`、`completedAt`、`expiresAt`、
`sessionEndedAt`、`claimedAt`。状态为 AVAILABLE、CLAIMED、EXPIRED。Backend 根据经过认证的
Worker 身份与已有 Session 关系确定 Worker、Profile 和用户，不能接受上传者自报的所有权。

文件过期或成功领取后立即删除字节。终态元数据保留至 Backend 对账确认，再由 Worker 清除；
清理字节和确认元数据是两个独立步骤，控制面短暂离线不能令文件永久占用空间或丢失终态。
下载完成后，使用者仍可能在网站稍后读取已上传 File 对象，因此上传文件继续占用空间直到
Session 清理；持久下载与这些上传必须使用同一 Session 配额。

## 运行时接入约束

`EmbeddedRemoteTabRuntime` 在 Core 绑定前初始化 `temporaryStorageDirectory/retained-downloads`，
为 Session 创建 sink，将上传占用与持久下载占用相加校验。该路径与 Chrome spool 同卷持久挂载，
不能将整个 temporaryStorageDirectory 放在重启即丢失的 tmpfs 中。
Core.close 返回后再提交 Session 结束时间，保证已经完成但正在交接的文件也使用收紧后的期限。
Worker 重启时，对无法恢复的 Session 按结束处理；已有结束时间保持不变。过期清理由 Worker
自有定时任务每秒执行，关停先停止定时器并等待正在执行的清理，再结束 Session。启动时清除
无法恢复的 `sessions/` 上传目录和 `.browser-downloads/` 未交接文件，保留下载独立于这两个
清理范围。重复启动不延长任何已有截止时间。此卷必须由单个 Worker 进程独占。
元数据通过现有 mTLS 控制链路按有界批次对账，文件内容不进入控制协议。

## 元数据对账

Control 1.16 的 worker.downloads 每批最多 100 条，独立于 Runtime snapshot。
Worker 连接并完成运行时对账后开始上报，每轮完成后等待 5 秒再同步；同一连接每次只等待一批。
Backend 校验连接的 Worker/instance 身份，并从已有 Session 推导用户、Profile 和 Worker。
0015 迁移增加 session_downloads 和 Session 四字段归属外键，只存名称、大小、状态与时间。

每批在单一事务内提交；文件 ID、Session、名称、大小和完成时间不可改变。旧 AVAILABLE 报告
不覆盖终态，较晚的截止时间不延长已保存期限，冲突终态和错误所有权令整批失败。
事务提交后 worker.downloads.accepted 返回本批终态 ID；Worker 校验关联消息、实例与精确
ID 集合后才删除本地终态清单。丢失 ACK 时，下次连接重放同一元数据不会丢失文件终态。

普通和维护 Session 的新预约要求协商 Control minor ≥ 16；持有下载存储的 Worker 也拒绝
向旧 Backend 建立工作连接，避免无人接收文件元数据。旧持久命令的解码规则保留。
对账不授予文件读取权限；当前账号、权限和 Profile 访问校验仍由领取入口负责。

## 领取入口与授权

领取使用 Worker 独立文件监听入口，部署时通过明确的 HTTPS 反向代理路由提供访问，不复用
健康检查、CDP 或 Extension loopback 的公网暴露。Backend 和信令 Gateway 均不代理文件字节。

Portal 向 Backend 请求短期、单次领取凭据，再以原生浏览器表单 POST 到文件入口，让浏览器
直接流式保存。凭据放在请求正文，不能放入 URL 或日志。签发和消费时均检查账户状态、当前
业务权限、Session 归属及 Profile 可见性；维护 Session 使用维护权限。管理员没有用户文件
所有权旁路。Backend 不可达时消费失败关闭，文件继续等待后续合法领取。

Backend 提供 `GET /api/v1/sessions/:id/downloads`（UUID cursor，limit 1–100）与
`POST /api/v1/sessions/:id/downloads/:downloadId/claim`。CLOSED Session 仍可访问，列表返回
`workerOnline` 和 `serverTime`。签发返回 claimId、32 字节随机 base64url token、endpoint 和
expiresAt。0016 migration 的 download_claims 仅保存 SHA-256 摘要；凭据有效期最多 60 秒，
且不超过文件截止时间。重新签发替换同一文件未消费凭据，保留正在传输的已消费凭据。

凭据绑定签发时的 Portal 登录 Session；退出登录、重置密码、撤销该登录均令凭据失效。
Worker 在现有 mTLS HTTPS 监听上调用 `/internal/downloads/consume`（instanceId、token）和
`/internal/downloads/check`（instanceId、claimId），返回文件/Session/claim ID 和文件截止时间。
每次请求重新核对证书、当前 WSS 实例、账号、原 Portal 登录与业务授权。消费为原子单次操作；
后续复查不再受签发的 60 秒时限限制，但仍受文件期限和当前授权约束。终态对账清除该文件凭据。

Worker 配置 `BROWSHARE_WORKER_DOWNLOAD_ENDPOINT`（完整 HTTPS 文件 URL）、
`BROWSHARE_WORKER_DOWNLOAD_PORTAL_ORIGIN`（精确 HTTPS Portal origin）；私有监听地址由
`BROWSHARE_WORKER_DOWNLOAD_HOST` / `BROWSHARE_WORKER_DOWNLOAD_PORT` 指定，默认
127.0.0.1:3411。开启此入口要求启用 Remote Tab runtime。监听成功后才在 Control 1.17 Hello
公布 downloadEndpoint；Backend 仅对完成能力与状态对账的在线实例签发文件入口。
反向代理必须保持路径，关闭响应缓冲，并仅暴露该文件路由；健康、CDP、Extension 端口保持私有。

浏览器表单字段为 token、claimId，Content-Type 为 application/x-www-form-urlencoded。
Worker 要求 Origin 与配置的 Portal origin 一致，正文最多 1024 字节、5 秒内收完。
文件以 attachment 和 UTF-8 filename* 输出，固定 application/octet-stream、no-store，不支持 Range 续传。
错误响应为不含凭据或文件名的页面，通过 postMessage 向精确 Portal origin 返回
`{ type: 'browshare.download.error', claimId, code }`。Portal 必须核对消息来源窗口、origin 和 claimId。

WorkerRetainedDownloads 统一管理独占领取租约。传输期间每次复查完成后 1 秒再检查，
每次 mTLS 请求最长 2 秒；失败或撤销终止在途响应。文件到期另有精确定时器，Session 结束
收紧期限时重设；到期先中止流，再删除文件。响应 finish 同步记录完成时间，再串行提交清单，
阻止已排队过期任务覆盖成功状态。中断释放独占租约，AVAILABLE 文件允许用新凭据重新领取。

文件响应保留准确的 Content-Length；非空文件按已提交元数据的长度限定读取终点，避免发送
最后一块后再等待一次磁盘 EOF 读取。反向代理可能在收齐 Content-Length 后关闭上游，这次
额外等待会使字节已完整送达的响应只有 close 而没有 finish。完成判定仍只使用响应 finish，
不把客户端断开或凭据消费当作文件已领取；零字节文件沿正常空流完成。

仅签发凭据不算已领取。认证后的响应完成才进入 CLAIMED；中断保持可重试，失效或重放凭据
不能开启第二次传输。到期和撤销与在途响应的处置必须由同一领取状态机协调。

Portal 在 Session 下载列表中展示名称、大小、剩余保留时间、领取状态和错误。入口在 Session
结束后仍可从“我的 Sessions”访问；Worker 离线时明确说明当前不可领取，不把离线当作文件丢失。
账号或授权撤销、Profile 删除、Worker 重启和元数据对账都要覆盖已结束 Session 的文件。

Portal 收件箱复用现有分页刷新机制，每 5 秒刷新已加载页面；隐藏页面暂停刷新，重新聚焦后更新。
倒计时以 Backend serverTime 校正，加载失败保留可见记录但禁用领取。首次加载前 Worker 状态
为未知；取得离线状态后，自动刷新期间仍保留离线提示，避免提示随轮询闪烁。原生表单在隐藏 iframe 中
提交，凭据输入随后移除；错误通过精确 origin、来源窗口和 claimId 三重匹配显示到对应文件。
原生下载没有可靠的页面完成事件，因此页面仅提示查看浏览器下载记录，最终状态来自 Worker 对账。
8 秒后允许用户主动重试，重新领取会取消前一未完成 iframe；关闭弹窗清理监听、请求、定时器和 iframe。
弹窗支持长列表滚动、窄屏、键盘焦点约束及浅深色主题，使用明确的 dialog 与标题关联。

## 验收边界

需验证真实 Chrome 无 Viewer/断开后完成下载、存储失败、交接中关闭、上传与下载共用配额、
进程重启、30 分钟和结束后 10 分钟截止规则、领取字节、响应中断重试、凭据过期与重放、
当前授权撤销、物理清理以及桌面和移动页面。存储方法调用成功不代表业务领取链路已交付。
