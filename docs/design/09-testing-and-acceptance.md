# Testing and acceptance

## 按变更选择验证

先确定本次修改可能破坏的行为，再选择能够发现该失败的检查。以下是任务级验证范围，后文的产品验收与发布要求仍然有效。

| 变更 | 本次需要的证据 |
| --- | --- |
| 文档、注释 | 受影响链接、术语、命令入口及代码块；修改图或 DESIGN.md 时执行对应校验，见 [贡献指南](../CONTRIBUTING.md) |
| Portal 或局部业务逻辑 | 相关类型检查与行为测试；交互变化验证对应页面及必要的键盘/权限路径 |
| 公共协议、授权、租约、重连 | 涉及的 schema、实际调用方及相应非法输入、撤销、幂等和对账测试 |
| 数据库 schema/migration | 可审查 SQL、空库迁移和支持版本的升级路径，在测试数据库中执行 |
| Chrome、媒体、Proxy 或容器运行时 | 拥有该行为的真实链路；涉及兼容性集合或发布时执行对应完整 Gate |

命令以根目录和相关包的 `package.json` 为准。本仓库没有统一的 `pnpm test`；不要假定兄弟仓库的脚本可直接复用。`pnpm check` 是综合静态与构建检查，不代表真实浏览器或数据库验收。

检查通过且没有新增修改、失败或未解决问题时结束验证。环境缺失时明确未验证范围；可继续完成独立检查，但不把 Mock、历史记录或构建成功写成真实链路通过。

## 验证层次

| 层次       | 目的                                       | 典型执行环境             |
| ---------- | ------------------------------------------ | ------------------------ |
| 单元测试   | 状态机、策略、权限、Schema和坐标计算       | CI                       |
| 组件测试   | REST、数据库、Worker命令和Viewer UI        | CI容器                   |
| 集成测试   | Backend、Worker、Chrome、Gateway和TURN链路 | Linux amd64              |
| 浏览器测试 | Viewer输入、剪贴板、文件和兼容性           | Playwright及真实浏览器   |
| Gate 0     | 证明同Profile多Tab架构成立                 | 真实Google Chrome Stable |
| 发布验收   | 从空机部署、升级、恢复和安全边界           | 临时服务器               |

测试必须说明证明边界。Mock Chrome通过不代表真实`tabCapture`可用；构建通过不代表浏览器链路通过；直连通过不代表TURN可用。

## Gate 0：多Tab架构

正式冻结Remote Tab公共接口前必须完成：

1. 同一Google Chrome Stable、同一Profile并行创建至少4个主Tab。
2. 每个Tab独立建立`tabCapture + WebRTC + CDP`控制。
3. 验证`session_id ↔ tabId ↔ targetId`不会串线。
4. 四个Viewer分别完成鼠标、拖拽、滚轮、键盘、快捷键、中文IME和Emoji。
5. 四路分别导航、前进、后退、刷新和更新标题。
6. 四路分别上传、下载、文本粘贴和图片粘贴。
7. 验证单路暂停、接管、关闭和崩溃不影响其他三路。
8. 验证新窗口、本机打开、Navigation Policy和Page Script正确归属Session。
9. 分别验证WebRTC直连、TURN/UDP和TURN/TCP或TLS。
10. 验证Backend短暂断线时连接在租约内继续，恢复后对账。
11. 验证Worker/Core和Chrome故障后的Session失败边界。
12. 记录CPU、内存、码率、FPS、RTT、丢包和发送端质量限制原因。

Gate 0不要求2C2G测试机四路同时达到1080p/60，但必须能区分资源不足和架构串线。

## 领域与授权测试

- User、Profile和Group三条可见路径分别生效，取并集。
- 禁用Group只移除该路径，其他路径仍保留。
- 通过列表、直接ID、旧缓存和SSE事件访问的授权结果一致。
- 最后一名`system.manage`用户不能被禁用或删除。
- 用户禁用、密码重置和授权撤销会终止所有相关凭据和Tab。
- 普通用户不能创建维护Session或控制他人Session。
- 接管流程只有确认后的新Viewer能够发送输入。
- Profile维护与普通Session互斥。
- 只有`profile.read`的账户可以查看管理清单但看不到写操作；`profile.manage`才能创建、编辑、启禁和请求删除。
- Profile创建后不能通过编辑请求更换Worker；离线或已禁用Worker允许预配置，已退役Worker必须拒绝。
- `max_normal_sessions=null`和码率`null`必须保持`null`，未知JSON字段必须明确返回400而不是被静默删除。
- Profile删除要求精确名称，重复请求幂等；请求后不能编辑或重新启用，最终软删除必须等待Worker资源回收确认。
- Portal网络失败保留表单并允许恢复后重试；创建、删除弹窗和桌面/移动主题通过WCAG A/AA自动审计与键盘实测。

## 并发和状态测试

- 同时创建请求只能占用可用额度，不超出User、Profile和Worker限制。
- Worker拒绝、命令超时和重复投递会释放或复用同一Reservation。
- 重放同一`messageId`不创建重复Chrome、Tab或备份。
- 迟到事件不能逆转`CLOSED`和`FAILED`。
- Worker重连快照能发现数据库孤儿Session和本地孤儿Tab。
- Viewer失焦进入`SUSPENDED`，恢复不创建新Session。
- 续租不重建PeerConnection；超过租约和宽限后才关闭。
- 同一Enrollment Token并发注册只有一个成功，成功后重放、过期和撤销Token均失败。
- 非P-256公钥和重复Worker名称不消费Token；修正输入后原Token仍可完成注册。
- Worker身份文件只在节点保存私钥且权限为`0600`；数据库、审计和Backend日志中没有Token或私钥。
- 保留身份卷重启不创建新Worker；丢失身份卷必须使用新Token，证书或身份元数据被篡改时fail-fast。
- 签发证书由配置CA验证，只有`clientAuth`、`digitalSignature`和匹配Worker ID的URI SAN。
- Worker控制listener没有客户端证书、使用错误CA或数据库已撤销Credential时拒绝连接。
- Worker Hello必须为二进制MessagePack并与证书身份一致；文本、畸形、超限和错误major消息失败。
- 同一Worker的新控制连接替换旧连接；Backend重启后Worker退避重连且不重新Enrollment。

## Proxy测试

- Direct、HTTP、HTTPS和SOCKS5分别验证。
- 无认证和有认证上游分别验证。
- DNS解析位置符合所选Proxy协议预期。
- 上游故障时Chrome请求失败且出口不回落Direct。
- Proxy恢复后现有Tab能够继续请求。
- Remote Tab信令、Worker控制和ICE不进入Profile Proxy。
- Proxy凭据可由授权管理员查看，但不出现在日志和审计详情。

### Proxy Runtime 集成验收（2026-09-06）

在测试服务器的 Google Chrome Stable 152.0.7977.75、Remote Tab 0.1.23 与 Worker 协议 1.18 上完成：

- Worker 显式探测 Direct、HTTP、HTTPS、SOCKS5 健康与出口 IP；不同真实上游的源地址证明请求归属。非法 IP、超过 4KiB 响应和重定向返回固定错误，不返回正文。
- 上游故障时实际 Chrome 页面请求失败，目标收到零条回落 Direct 的请求；已有 Viewer 的同一 PeerConnection 保持连接且视频帧继续增长。恢复后原页面通过原上游再次请求成功。
- 无 Session 的 ALWAYS_ON Profile 持续健康采样；故障禁止工作区新 Session 和维护入口，恢复后 SSE 更新页面。显式测试结果与实际 Runtime 状态独立展示。
- 配置更新与解除 Proxy 绑定产生待重启提示；Backend 重启不改变已应用路由，Runtime 显式重启后分别确认新 HTTPS 出口与 Direct 出口。改名不提升路由版本；过期配置探测不能覆盖新配置状态。
- REST 和 SSE 权限实际返回 401/403；仅 Proxy 读取权限的用户无写操作，有 Proxy 管理权但无 Worker 读取权的用户无法发起探测，凭据无权时为空且无显示按钮。
- Portal 实际测试待处理禁用、超时保留草稿、离线失败与恢复重试，756px/390px 表格操作命中、中英文弹窗、键盘 Worker 选择和单选切换、焦点围栏与关闭后归还。最终弹窗 axe 为零违规；自动工具无法判定的背景对比项目通过页面截图核对。
- 审计、Backend 和 Worker 日志中未出现测试代理密码或出口响应正文。结束后删除测试 Session/Profile/Proxy/账号与临时角色，停止网络夹具，移除额外测试 CA，正常 Worker 就绪；关闭本机测试 Chrome 及专属转发。

临时脚本与脱敏验收报告存于忽略的 `tmp/proxy-runtime-qa/`，该目录不作为公开发布制品。此验收仅完成 Proxy 业务与运行时条目，不代表整套部署和发布 Gate 已通过。

## 文件与剪贴板测试

- 大小、数量、类型和Session总量限制在Viewer与Server同时执行。
- 相同文件名、Unicode文件名和路径分隔符不会覆盖或逃逸目录。
- 下载只能交给来源Tab对应Session。
- 无法归属的下载被隔离并按TTL清理。
- Viewer断线、Session关闭和传输中断不会留下无限临时文件。
- 剪贴板只有用户动作触发；权限拒绝时提供手工路径。

### 存储准入真实链路验收（2026-09-06）

在 Google Chrome Stable 152.0.7977.75、Remote Tab 0.1.23 候选和 Control 1.19 上，使用测试服务器根盘内独立的 768 MiB ext4 镜像挂载 Profile 与临时目录。测试阈值显式设为 256/128 MiB；产品默认阈值不变，不操作宿主数据盘。

- 实际压低卷剩余容量后，LOW 拒绝新 Runtime 和 Session，仍允许新文件上传；CRITICAL 进一步拒绝新上传、下载。进入 CRITICAL 前获准的 16 MiB 慢速下载跨越压力期完成，保留文件逐字节正确。
- 动态应用 Profile 零配额、Worker 零配额与有限配额，分别验证 Runtime/Session、新上传、已知大小下载和未知大小下载增长拒绝。已有 Viewer 保持同一 PeerConnection 与视频流，采样期间持续产生视频帧。
- 控制连接中断时 Worker 沿用最后已应用配额；Backend 修改期望值显示待应用，重连自动应用并恢复文件准入，同一 Viewer 无需重建。ALWAYS_ON 在低空间时不反复启动，容量恢复后自动运行且 Chrome 失败计数仍为零。
- Worker 重启保留已应用的配额值与版本，4 个保留下载文件重启前后逐字节一致。实际文件适配器另验证并发预约、上传与下载共用 Session 额度、扫描不双计、文件移动、未知残留计账以及删除失败后不提前释放额度。
- 在隔离卷实际创建 47,298 个空文件耗尽 inode，剩余字节仍高于 LOW 阈值时报告 CRITICAL；清除后自动恢复。停止所有业务 Chrome 后使 Profile 根目录不可读，用量变为 UNKNOWN；恢复权限后自动恢复。两类故障期间控制连接持续 READY，未重启 Worker。
- REST 实际验证匿名 401、无管理权限 403；负数、小数、不安全整数、字符串和布尔值 400；null、零及安全整数边界可设置，同值不提升策略版本，清除配额不受旧 EXCEEDED 事实阻挡。
- 0021 已在测试业务库升级；另从独立 PostgreSQL `template0` 空库执行全部 22 条 migration，逐条历史 hash/时间戳一致。实际插入验证 Worker/Profile 存储字段默认值、安全整数边界与 CHECK/NOT NULL 约束，结束后删除该临时库。
- Viewer 上传拒绝后隐藏发送进度，说明重新选择步骤；弹窗打开时切换中英文，说明与关闭按钮同步。关闭弹窗、解除配额并在远端重新选择文件后，Chrome 收到与本地完全相同的 4 KiB 文件，原 PeerConnection 继续传送画面。
- 结束两次真实 Session 后，对应上传目录均已删除，Chrome 下载暂存目录为空；保留收件箱按独立期限管理，不随 Session 临时上传目录一并删除。剪贴板数据仍归 Core 内存生命周期，不新增磁盘副本。
- Worker 额度编辑原生操作验证空值校验、零额度、离线失败保留草稿及网络恢复后重试、不限额恢复；390px 英文浅色详情与弹窗的 axe 检查无违规。
- Profile 表单原生保存零与有限额度，管理清单、Workspace、维护入口分别更新限制提示并禁用新增动作，总览存储计数与读模型一致。390px 无页面横向溢出；真实页面定位并修复重复 landmark 与说明文字对比度，相关 axe 检查无违规。

结束后通过业务 API 删除测试 Profile/Session、恢复 Worker 配额，移除对应测试账号、认证和审计夹具。更新后的 Worker 已恢复原 Profile/临时目录并保持 READY；隔离镜像卷、控制链路故障规则和目标服务均已清理，本机测试 Chrome 与专属转发已关闭。小容量 QA 宿主显式使用 512 MiB/3% 与 256 MiB/1% 阈值，产品默认值不变。

临时脚本与脱敏证据保存在忽略的 `tmp/storage-qa/`、`tmp/storage-local-qa/`，不作为公开发布制品。本节只记录已完成的存储验收，不代表孤儿资源对账或整套发布 Gate 已通过。

## 页面脚本与策略测试

- 每个生命周期事件在顶层导航和SPA location变化中按定义触发。
- 普通Session锁定发布版本，草稿只在维护测试中运行。
- Script异常只记录错误，不放宽服务端授权或URL策略。
- 结构化deny不能被Policy Script覆盖。
- Policy超时、异常和非法返回默认deny。
- Notice拒绝HTML、Markdown、脚本URL、超长内容和过高速率。
- 新窗口URL只允许HTTP/HTTPS进入本机打开流程。

### Page Script 上下文真实链路验收（2026-09-06）

在测试服务器 Google Chrome Stable 152.0.7977.75、Remote Tab 0.1.23 候选与 Control 1.19 上，使用实际 Backend、PostgreSQL、Worker、签名 Extension 和 Portal Viewer 完成：

- 上下文按用户与 Profile 分别持久化；匿名读取返回 401，缺少管理权限返回 403，敏感变量返回 400。错误与审计不包含变量值。
- 普通 Session 在创建时固定上下文快照。变量更新后，旧 Session 完整文档导航仍读取原值，新建 Session 读取新值；维护 Session 使用维护管理员自己的变量。
- 实际 Chrome MAIN world 在 document 与 window 分别收到五个初始化事件，detail 身份与上下文一致，事件不冒泡且不注入 iframe。pushState、replaceState、hash 与 popstate 按定义触发位置事件，没有重复分发。
- 四个普通或维护 Session 均通过实际 API 关闭；每个当前文档在 document/window 各收到一次 `on_session_detached`，普通文档导航不误触发 Session 卸载。
- 发布的测试脚本注册监听后主动抛错，后续 bootstrap 与生命周期事件继续运行；服务端 DENY 导航仍被阻止，拒绝目标收到零次请求。
- 四个 Viewer 都建立真实 WebRTC 并解码视频；公开 `page-script-event` 不携带业务 context。测试通过 CDP 操作自有目标页面验证事件，不替代签名 Extension 或媒体链路。
- 管理页由仅有 `profile.read` 与 `profile.manage`、没有 `user.read` 的账号完成用户搜索及实际保存；只有 `profile.read` 时无编辑控件，也不发送上下文请求。
- 原生页面操作验证非法 JSON/非对象/超量对象在前端拒绝，敏感值与超深嵌套被实际 API 拒绝；失败保留草稿，断网恢复重试和空对象清空均成功。切换用户、重新读取、离页的放弃确认、旧请求取消及保存期间锁定输入通过。
- 390px 英文浅色页面无横向溢出，长 JSON 仅在编辑器内滚动，稳定主题后的 axe 检查零违规。另将 Page Script 作用范围选择器的标签移至实际输入元素；该标签修正已通过类型检查与构建，并随 Control 1.20 配套 Portal 部署交付。

结束后删除自有测试 Profile、Session、用户、临时角色、认证与审计记录，目标服务停止，独立浏览器上下文和本机测试 Chrome 已关闭，专属 HTTPS/信令转发已取消。

临时脚本与证据位于忽略的 `tmp/page-context-qa/`。本节不宣称已验证 BFCache 恢复，也不代表整套发布 Gate 已通过。

### Portal 公共恢复与 API 输入验收（2026-09-06）

- 实际部署 Backend/PostgreSQL 验证 15 类列表的非法 cursor 为 400，合法用户翻页无重复；额外非法编码、版本、limit、401/403/404 以及成功响应和 SSE 建链均有服务端 UUIDv7 请求 ID，错误包络与响应头一致，客户端指定 ID 不被采用。共 27 项 HTTP 检查通过。
- 匿名未知 URL 显示 404；普通用户直达无权 Worker 页面显示 403。权限不变时重新检查仍明确拒绝，增加实际 Worker 读取权限后重新检查恢复原 query/hash 路径。
- 真实停止 Backend 后，已打开工作区保留 Profile 卡片和身份，显示通知断开与局部请求失败；整页重载进入可重试服务异常页。恢复 Backend/Worker 就绪后重试，原 Cookie 有效并返回原 query/hash，无需重新登录。
- 通过真实 API 撤销临时用户全部登录会话，工作区通过认证失效进入登录页；使用真实密码并以键盘提交后恢复原目标路径。
- 版本分支使用浏览器 CDP 仅替换公开版本接口响应：产品版本不同但 API v1 仍接受，合法 API v2 明确不兼容，404/HTML/503/错误服务结构属于可重试服务异常。其余页面和身份接口仍访问真实部署；此项不宣称曾部署真实 API v2 服务。撤掉响应夹具后，从不兼容页可恢复实际服务。
- 404、403、服务异常和390px英文不兼容页 axe 均零违规；长错误码自动换行，无文档横向溢出，原生键盘重试可用。临时脚本和报告位于忽略的 `tmp/public-recovery-qa/`。

### 管理总览与状态通知验收（2026-09-06）

- 已部署 `/admin/overview` 与 migration 0020（第 21 项迁移，增加失效通知触发器，无数据列变化）。实际 PostgreSQL 全量统计与接口逐项比对；匿名 401、无相关权限 403、Worker-only/Profile-only/两者均有的独立临时账号均通过。12 组 API 检查及自身资源清理成功。
- Portal 实际显示一只 Worker 的两个活动 Tab、一个普通及一个维护 Session、一个运行与一个维护 Profile；普通 Profile 容量只计普通 Session。真实线路故障/恢复、保存配置待重启以及 Viewer 连接/断开均通过 SSE 更新对应汇总。
- 未连接 Viewer 的普通 Session 五分钟后按既有策略以 `POLICY_VIEWER_DISCONNECTED` 关闭，总览同步减少普通及 Worker 活动占用。随后在仍有维护占用的情况下验证有限剩余、精确满额、上限降低至零的超额状态、无限容量和 Drain；原有 Session 未被配置变更自动结束。
- Backend 真实停机时，总览保留旧采样并显示过期/重试提示；维护 Viewer 保留同一个媒体流对象并持续解码，业务通知断开提示不覆盖媒体。Backend/Worker 恢复后总览重新读取快照，Viewer 原媒体流继续工作。
- 硬刷新后的 Worker-only 页面不渲染 Profile/Session 数值或管理链接；Profile-only 页面不渲染 Worker 数值或链接；撤销所有相关权限后刷新清除旧统计，直接访问进入 403。
- 关闭测试 Session 并删除 Profile 后，实际占用归零；停止 Worker 后页面显示离线/未连接/不可调度，但保留配置剩余，重新启动就绪后恢复可调度剩余。
- 桌面暗色、390px 英文浅色总览与修复后的账户安全页面 axe 均零违规；窄屏三个分区及所有指标无横向溢出，中英文菜单、账户安全入口、语言和主题切换均经实际浏览器操作。
- API 脚本账号/角色、普通与维护 Session、Profile、专属网络目标和自身审计记录已清理；Worker 恢复原上限 4、ONLINE/READY，未增加测试 CA，无剩余 Chrome 进程。本机 Chrome 和专属 HTTPS/信令转发已关闭。证据位于忽略的 `tmp/overview-qa/`，并完成 `tmp/public-recovery-qa/` 账号与停止 Profile 的后续清理。

## 客户端兼容性

正式支持最新版桌面Chrome、Edge、Firefox和Safari。移动端提供基础触摸、滚动和软键盘体验，但首版不纳入完整兼容承诺。

每次Release至少验证：

- Viewer加载、Ticket消费和WebRTC协商。
- Pointer Events和键盘映射。
- 自动播放受限时的音频恢复。
- 文件选择与本地保存。
- 页面隐藏、窗口失焦和恢复。

## 部署与恢复测试

- All-in-one Compose能在空白Linux amd64主机启动。
- 首次Bootstrap只能执行一次。
- 数据库migration能从空库执行，并从上一支持版本升级。
- 替换Worker容器后identity和Profile不丢失。
- 数据库恢复后Worker对账不会复活旧Tab。
- 缺少Profile卷时明确报错，不创建空目录覆盖事实。
- TURN端口、防火墙和relay范围由诊断工具验证。
- 公开端口扫描看不到CDP、Core loopback和PostgreSQL。

### Worker 冷启动文件恢复验收（2026-09-06）

在 Control 1.19 与 Remote Tab 0.1.23 候选上，对已部署 Worker 执行一次 stop/start。容器 ID、配置、
挂载目标及来源、身份文件字节均保持一致，Worker instanceId 更新并恢复控制连接与 readiness 200。

- 确定归属的旧 `.capability`/Profile 布局、Session 上传目录、Chrome 下载 spool 与未完成 retained staging
  已删除；未知名称和未知内容布局保留。
- 保留下载 manifest 的 `expiresAt` 与 `sessionEndedAt` 不变，按原期限自然过期，经 Backend 终态确认后删除目录。
- 明确种入的旧代数据库 Session/lease 记录变为 `FAILED / WORKER_STATE_MISSING_AFTER_RECONNECT`，Reservation
  释放且旧租约不续签。此项证明历史数据库状态的恢复行为，不宣称该种子曾对应实际运行的 Session。
- 独立真实 Chrome supervisor 另验证进程组已退出后才能提供 `browserClosed` 证明；无证明时仍保留失败清理的
  Session/文件，不以 CDP 连接失败当作 Chrome 已退出。

自有 Profile、Session、下载记录、历史状态种子与未知布局夹具均已清理。证据位于忽略的
`tmp/lifecycle-qa/results/cold/`。持续清理失败下的 Backend 自动重试与管理恢复留待 Control 1.20 集中验收。

### SIGSTOP 后心跳、对账与管理员停止真实验收（2026-09-07）

在已部署的 Worker 心跳修复版本上，使用专用 HTTP/HTTPS 目标和实际 Google Chrome Stable 152.0.7977.75 完成真实故障注入：冻结 Profile 所属 Chrome 进程组后，独立 CDP `Browser.getVersion` 在冻结前响应，`Target.getTargets` 在冻结后 1500ms 超时。Session 关闭保持 `CLOSING` 且 Reservation 未释放，Backend readiness 返回 503、reconciliation 为 pending；期间同一 Worker instanceId、控制 TCP 四元组、sequence 和心跳持续更新，未出现 ACK mismatch 或错误断链。管理员执行 `STOP` 并带 `closeSessions:true` 后，在不发送 `SIGCONT` 的情况下实际清理冻结 Chrome 进程组，Session/Reservation 收敛，Worker readiness 恢复 200，Profile 停止。证据位于 `tmp/control-cdp-stop-qa/result.json`；目标、Profile、Session、权限故障和临时认证均已清理。

### Control 1.20 清理恢复真实验收（2026-09-06）

协调部署 Backend、Worker、Contracts 与 Portal 后，在实际 PostgreSQL、mTLS/WSS、Google Chrome Stable
152.0.7977.75 与 Remote Tab 0.1.23 候选上完成三组恢复测试：

- 两个 Profile 的实际 Session 临时目录分别制造精确权限故障，各只请求一次关闭。Core 关闭 Tab 后，文件删除
  失败保留 CLOSING、Reservation 与错误事实；Worker readiness 为 503，但认证控制连接仍连接。连续三个快照
  周期内 TCP 四元组与 Worker instanceId 不变，sequence 和心跳时间递增。
- 先恢复 B 的目录权限，B 自动终止并释放 Reservation，A 仍 pending；再恢复 A 后自动恢复就绪。两次恢复都
  没有再次发送 close API，也没有重启服务。
- 对另一个 pending Session，仅用 `ss -K` 断开已核验的 Worker 控制 TCP 四元组。同一 Worker instanceId
  从首份重连快照起保持认证、pending 与心跳，新连接跨三个快照周期稳定；恢复文件权限后自动收敛。
- Session 文件仍无法删除时，通过实际 API 提交 `STOP + closeSessions:true`，确认 A 原 Chrome PID 和所属
  完整进程组均不存在；其 Profile 上报 `chromeProcessId:null` 并保留清理失败事实。B Chrome 仍存在，B Session
  保持 READY。解除 A 的文件故障后，A 才完成 Profile/Session 清理并释放容量。

全部自有 Profile、Session、用户、认证、目录故障及目标服务已清理，Worker 恢复 readiness 200。证据位于
忽略的 `tmp/control-recovery-qa/result.json`。实际临时文件由夹具写入 Session 存储目录，本批不宣称执行了
Viewer 上传或媒体协商；这三组主用例也不覆盖 SIGSTOP、ALWAYS_ON 及权限页面。

另以独立新 Enrollment 的 mTLS 协议夹具访问真实部署 Backend/PostgreSQL，完成未知事实与授权边界：

- 初次上报未知 Runtime/Session 返回准确的 stopProfiles/closeSessions，节点保持 PENDING、已连接但未就绪且
  不可调度，两条清理失败均标记未登记。数据库没有新增对应 Profile、Session 或 Reservation；实际 Session
  创建、START 和没有权威 Runtime 的恢复 STOP 被拒绝。
- 同一未就绪连接连续完成三次快照、两次心跳和管理员诊断，诊断不使节点误变 READY。只有 worker.read 的用户
  在 list/get 看到业务 ID 全部为 null，仍可读通用失败事实；诊断管理和 Profile STOP 返回 403。
- 错误 instance、Session/Profile generation 映射冲突与非法 schema 均返回协议错误并关闭 4002；在线最后凭据
  的撤销被拒绝，禁用后撤销成功，重新启用也不能用旧凭据重新认证。
- 六次夹具尝试涉及的 Worker、凭据、Enrollment、业务资源、预约、认证、用户、角色和审计记录已逐项清零；
  状态文件也移除了 Token、Cookie、私钥和证书正文。既有 Backend 和实际 Worker 未重启。

证据位于 `tmp/control-recovery-boundary-qa/result.json`。此项为真实 Backend/数据库与独立协议夹具的验证，
不把夹具上报的未知对象描述为实际 Chrome；真实 Chrome 关闭证明来自上面的业务链路。

### PostgreSQL 归档脚本验收（2026-09-06）

在测试服务器 PostgreSQL 工具环境运行正式 `database-backup.sh` 与 `database-restore.sh`，源和目标均为
独立的 `template0` 临时数据库，业务数据库不作为恢复目标。

- 源库执行全部 22 条 migration 后插入合成用户，备份生成权限为 `0600` 的 custom archive；同路径重复备份
  返回 73，未覆盖原归档。
- 向空目标库单事务恢复成功；用户字段、Unicode 显示名、合成密码 hash 和时间戳逐项一致，所有业务 schema
  列定义与 migration 历史一致。恢复后的数据库 CHECK 约束实际拒绝非法负数。
- 再次向已有表的目标库恢复返回 65，已恢复数据不变。结束后删除两只临时数据库、容器内归档和 URL Secret。

本次另实际复现并修正文档中 pnpm 备份/恢复命令多余 `--` 导致的参数错误。证据位于忽略的
`tmp/database-archive-qa/`；此验收尚不涵盖备份保留策略或整套灾难恢复演练。

### Profile 冷归档真实 Chrome 验收（2026-09-07）

`tools/profile-archive.sh` 在当前 Worker 容器的 Linux/非 root 用户、Google Chrome Stable
152.0.7977.75 和实际 `ProfileChromeRuntime` 上验证。使用独立 UUIDv7 Profile 与本地 HTTP 目标：
运行中备份被共享 flock 拒绝且页面仍可用；停止 Chrome 后归档成功，manifest 记录原 Worker/Profile
和 UTC 时间，归档权限 0600。已有归档、非空恢复目录、错误 Worker 和错误 Profile ID 均拒绝。
截断 gzip 在临时目录解压失败，目标目录保持空白。清除自有测试 Profile 内容后，从完整归档恢复并
重新启动真实 Chrome，持久 Cookie 和中文 localStorage 均恢复。测试 Chrome PID、HTTP 目标、
自有 Profile、原始数据、归档及临时身份夹具已清理。

证据：忽略的 `tmp/profile-archive-qa/result.json`。本次验证离线存储工具与真实 Chrome 数据，
没有新建 Backend 业务 Session，没有使用 Viewer，也没有执行完整 Compose 灾难恢复演练或重建
包含该工具的新 Worker 镜像；这些部署验证仍按对应进度项完成。

### 共享 Core 与 Session 句柄验收范围

Worker 的单一 `RemoteTabCore` 由 `WorkerTabSessions` 复用，各 Session 保留独立 Core handle、
授权、Capabilities、租约、文件和关闭状态。真实双 Viewer 的视频、输入、文件、剪贴板、暂停与接管
证据位于 `tmp/tab-session-qa/browser-more-final.log`（Remote 0.1.15）；公共 Viewer owner 授权和
租约证据分别位于 `tmp/session-viewer-qa/`、`tmp/session-lease-qa/`。Remote 0.1.23/Control 1.20 的
关闭失败保留及恢复由 `tmp/control-recovery-qa/`、`tmp/control-cdp-stop-qa/` 补充。上述为多个版本的
组合边界验收，不表述为本次同一版本全量回归，也不替代同 Profile 多业务用户集中隔离验收。


### 同 Profile 多用户与真实活跃 Session 重启验收（2026-09-07）

在当前 Control 1.20、Remote/Extension 0.1.23、服务器 Google Chrome Stable 152.0.7977.75
和本机 Chrome Stable 152.0.7977.76 上，两个经公共 API 创建的 member 各创建两个普通 Session，
共用同一 MANUAL Profile、Chrome 与 Runtime，四个 tabId/targetId 各自独立。两位用户使用不同
本机浏览器上下文，四个 Portal Viewer 均建立真实 WebRTC 并解码视频。

- 四路原生 Viewer 键盘输入到达各自远端 Tab。A1 文本和 PNG 图片剪贴板只到达自身 Tab；
  A2、B1 分别通过 Viewer 文件选择上传中文文件名和精确内容，其他 Tab 的文件选择保持不变。
- 两个用户互访对方 Session 的读取、重命名、结束、Viewer Ticket、接管、继续和下载列表均返回
  404。真实 A2 保留下载的跨用户 claim 同样返回 404，共计 29 项拒绝；目标 Session 的名称和
  Viewer generation 不被拒绝请求改变。
- A1 暂停/恢复、原生“确认接管”和公共结束均保留其他用户的原 PeerConnection、媒体流和增长的
  解码帧。接管后的旧 Viewer Peer 已实际关闭。Cookie/localStorage 在 A2 与 B2 之间共享，符合
  Profile 数据边界，不把站点账号数据共享描述为用户隐私隔离。
- 在已有真实 B1 Session 和上传文件上，通过一笔自有数据库故障注入模拟“Backend 已终态而
  Worker 原 Tab 仍存在”：更新 CLOSED、释放 Reservation、撤销未消费 Ticket，不伪造新 Session、
  close outbox 或生命周期事件。实际周期快照报告 `BACKEND_SESSION_TERMINAL` 并删除 B1 原
  CDP Target 与上传目录。Worker instance、Chrome WebSocket/PID 和 B2 原 Target 保持，B2
  原 Peer/媒体流继续解码。此项是实际业务对象的数据库故障注入，不是正常 close API 的替代证明。
- 保留 A2/B2 两路实际活跃 Session、A2 真实上传和未领取下载后，精确 SIGKILL Worker CLI 的
  宿主 PID。沿用现有 `unless-stopped`，Docker 自动重启计数从 0 增至 1；旧 Chrome 整组退出。
  同容器 Config、HostConfig、按挂载目标比较的全部挂载和身份文件字节保持一致，Worker instance
  更新。旧实际 Session 终态、Reservation 释放、旧 Tab/Runtime 不复活，随后三个快照周期内旧
  租约不再续签；原上传目录和 Chrome 下载暂存区清理，真实 retained 文件字节保持、期限未延长。
- 通过公共 START 和创建接口在原 Profile 新建 C1，得到新 Runtime/Target 和解码视频的新 Viewer；
  原 Cookie 与中文 localStorage 仍在。A2 崩溃前下载在重启后通过原生表单领取，312 字节逐字节
  相符。最后通过公共生命周期删除自有 Session/Profile，再清理对应测试行、认证和文件。

证据位于忽略的 `tmp/multiuser-lifecycle-qa/result.json` 及同目录分项报告。全部本机测试 Chrome、
目标14968/14969、转发15443/15444/34983已关闭；最终 Worker readiness 200 且无业务 Chrome。
初始失败包括到期的测试 localhost TLS 证书，以及夹具对编码帧/ACK viewport、下载交付方式、
Docker 重启中间态和挂载数组顺序的错误假设，均有记录并修正。证书使用原私钥和相同 SAN 续期，
真实 TLS 校验保持启用；重启观察修正继续使用同一次 SIGKILL 的故障前证据，没有重新注入故障。
本组不重跑 Remote 的完整 TURN/跨浏览器发布矩阵，也不替代整套部署与升级演练。

## 发布证据

Release记录应保存：

- Git commit和版本。
- 固定Chrome、Extension和Remote Tab版本。
- Gate 0结果与环境。
- 镜像digest、SBOM和校验值。
- migration测试结果。
- 已知限制和浏览器兼容变化。

### 本地候选与 OCI 产物验收（2026-09-08）

本组构建时两仓库均无 commit/remote，准备工具据实输出 `working-tree-snapshot`、`commit:null` 和
dirty 状态，并保存两个源码归档的摘要；没有将工作区内容标为 Git 提交或公开发行。BrowShare
完整 `pnpm check` 通过，发布工具的 ESLint、格式、Bash 语法、Actionlint 1.7.7 及相关文档链接
校验通过；DESIGN linter 无 error/warning。全量 Gate 首次报告的 29 个格式问题和 3 个 unused
变量/import 问题已按具体失败清单修正，未改变业务行为。

Syft 1.51.1 对候选的两个隔离源码快照生成 CycloneDX/SPDX 清单：BrowShare 为 555/554 个条目，
Remote Tab 为 155/153 个条目；两个 pnpm 许可证清单分别含 410/88 个依赖。源码候选共 12 个
最终平面文件并通过 SHA256SUMS 验证。临时复制件的增加、改动、遗漏文件与重复覆盖候选被拒绝。
源码归档检查未包含 `.git`、`tmp`、`node_modules`、`dist` 或非示例 `.env`。源依赖清单包括开发
依赖，不声称是每个运行时镜像的实际安装集合。

测试服务器使用 Docker Buildx 0.30.1 / BuildKit 0.26.2 和 containerd image store，从配套快照
实际构建 backend、migrator、gateway、portal、worker-chrome 五个 Linux amd64 OCI 候选。
五个镜像 SPDX 清单分别含 436、436、324、69、262 个条目；每份 SLSA v0.2 provenance 与 SBOM
均通过对应 runtime manifest 的 subject 及 attestation manifest 引用验证。工具分别记录并核对
OCI index、runtime manifest 和 config digest，完整归档复制本机后再次校验。

五个 OCI 均实际导入 Docker。Backend/migrator 的应用与数据库/契约包导出、Gateway 的公共
Signaling/Protocol、Worker 的公共 Core/Protocol 在容器中成功加载；Worker 的实际 Chrome
版本为 152.0.7977.75。Portal 按正式部署的配置挂载与 UID 1000 完成 `nginx -t`。这组是产物和
运行依赖验收，不单独证明新业务 Session 或灾难恢复；那些链路仍使用对应真实验收证据。

第一次匿名 OCI 导出的 attestation subject 为空，校验明确失败；构建工具补上固定候选镜像名后
重新生成并通过。Portal 夹具第一次遗漏必需 ingress 挂载、第二次遗漏 Compose 运行 UID，分别
被真实 Nginx 拒绝；按正式运行配置补齐后通过，没有放宽证书权限或改动产品入口配置。

证据保存在忽略的 `tmp/release-prep-qa/`（`candidate-v2/`、`images/`、`images-result.json` 与各
构建/失败日志）。本组的来源记录是未签名 BuildKit 记录，不是受信发布者证明或某个 SLSA 等级。
Hosted CI、实际仓库/固定提交、公开 registry/source/npm/CRX 发布及外部安装仍未据此宣称通过。
含 Chrome 的 Worker OCI 仅在本机/测试服务器使用；无 Git commit、registry push 或公开资产上传。

### 独立安装发现的下载完成竞争（2026-09-08）

新的空白 Compose 项目完成 23 项迁移、管理员初始化、Worker 注册、Profile 授权与真实 Session。
Google Chrome Stable 经正式 Extension、Gateway 和本组 TURN 建立 WebRTC；默认 ICE policy 为
`all`，实际选中 Viewer UDP relay 到 Worker host，解码帧从 21 增至 49。输入和非敏感测试
Cookie/localStorage 通过。业务页使用隔离 HTTP 目标；HTTPS 目标只用于 Node 健康检查，
不将开发 CA 的健康探测信任当作远端 Chrome 的业务站点信任。

Portal 原生跨源 HTTPS POST 已完整保存 56 字节，但超过 120 秒后 Worker 留存清单和 Backend
仍为 AVAILABLE、claimedAt 为空。数据库确认只存在该文件和对应已消费凭据，排除了重复附件
或列表读取错位。原 Session 随后按既定 Viewer 断开策略结束，文件在收紧后的原截止时间自然
EXPIRED；没有延长期限，该自然过期不算领取成功或修复验收。下载项因此重新标为未完成。

实际 Linux 候选 Nginx 的隔离 HTTP 对照在额外 EOF 读取上延迟 20ms：旧实现 20/20 返回完整
200 响应，却只有 close、没有 finish，文件保持 AVAILABLE。非空文件限定到已知读取终点后，
相同条件 20/20 CLAIMED，0、1、56、65536、65537 字节均通过。正式 Worker 类另验证途中
中断与撤权仍保留 AVAILABLE，可用新凭据重试；实际留存到期仍中断响应并删除文件。这组授权
提供者是明确夹具，不代替 Backend/mTLS 验证。Worker 类型检查、构建和定向 lint 通过。

原失败、隔离对照和执行归属说明保存在 `tmp/independent-install-qa/`。新版 source-v3 的配套
源码归档及 SBOM 已完成并通过校验；完整 Worker OCI 构建期间，测试服务器最后可读资源样本
接近耗尽 1.9 GiB 内存和 2 GiB swap，随后 SSH 握手及本组 HTTPS 入口超时。尚未取得修复镜像
构建完成、部署、原生领取或成套恢复成功的证据；资源样本不单独证明服务器失去响应的最终根因。
本组 Profile 已提前通过 API 停止、旧 Session 全终态，本机测试 Chrome 已关闭，原身份和数据卷
保留。后续必须先恢复服务器可用性，再按实际镜像身份继续；当前不声称第三方空机演练完成。

### 重置后的受限构建与镜像恢复（2026-09-08）

用户重置测试服务器后，只读盘点为 Ubuntu 24.04 amd64、约 2 GiB 内存、系统盘约 36 GiB
可用；5 GiB 的 `/dev/vdb` 未写入或格式化。Docker 29.8.0、Compose 5.5.1、Node 24.12.0
和 pnpm 10.28.2 安装在系统盘；新增 2 GiB 临时 swap，不写入 fstab。本阶段没有业务容器。

专用 BuildKit 0.26.2 容器使用单步骤并发、1200 MiB 内存和 1600 MiB 内存加 swap 总上限。
实际构建进程位于受限父 cgroup 下；构建期间记录的 oom、oom_kill 均为 0。Worker 从配套
source-v3 完整构建成功，OCI manifest、SBOM、来源记录和六个产物的校验通过；这是未签名的
BuildKit 记录。四类控制面镜像从本机已校验的 v2 OCI 导入，镜像身份与原记录一致。

修复 Worker 的 index digest 为
`sha256:1b31678c94e7f6cc18c8ad4d579ff7bc0505c30aeba3d6281d79fdd91e13b273`，
本地标签为 `browshare/worker:0.1.0-candidate-download-finish`。应用和公共 Core/Protocol 导出
在实际镜像中加载成功，Chrome 为 152.0.7977.75；构建器随后停止。新部署使用另一份已签名的
QA Extension 0.1.23，尚未作为正式身份公开发布。证据在 `tmp/server-reset-qa/`；镜像构建
和导入成功不替代修复后的原生领取、全新安装和原身份备份恢复验收。

### 重置后完整镜像的原生领取验收（2026-09-08）

上述修复 Worker 与四类控制面候选在全新 Compose 项目中完成 23 项迁移、管理员初始化和
新 Worker 注册，删除一次性注册令牌后仍可重新连接并就绪。真实 Google Chrome Stable
使用默认 ICE policy `all` 建立 WebRTC，选中 Viewer srflx 到自有 TURN relay，远端 relay
端口位于本组配置范围内；解码帧从 22 增至 49，实际输入及测试 Cookie/localStorage 通过。

Portal 原生跨源 HTTPS POST 经正式文件入口保存 57 字节，SHA256 为
`fa1b72bb1d9bc500fca985a9f2ef49dde8a6c547b8920a8cf2b8c8fdae943fea`。
Backend 状态实际进入 CLAIMED，Worker 对应留存目录、文件和 manifest 均已不存在。
这是完整修复镜像的真实领取证据，下载项据此重新勾选；不代替随后进行的备份恢复验收。

首次夹具错误地限定 Viewer 必须使用本地 relay，后按产品默认 `all` 和实际自有 TURN
候选关系验证；输入夹具另有新旧期望文本不一致，修正临时目标页期望后在同一 Session
重新输入通过。原失败结果保留，没有修改产品网络策略或将夹具失败记为产品修复。
证据位于 `tmp/server-reset-qa/independent-install/`；测试浏览器在本组验证后关闭。

### 新命名卷恢复原身份与站点数据（2026-09-08）

上述测试 Session 通过公共生命周期结束、Profile 停止且 Worker 进入 DRAINING 后，冻结
Worker/Backend 写入，使用正式数据库与 Profile 归档工具备份，并成套保留部署配置、CA、
Secret、Worker identity 和精确 CRX。私有归档共 90,723,083 字节；下载本机后核对 SHA256
和实际 0600 权限，才开始原项目停机与恢复，避免仅在同一台测试服务器保存唯一副本。

恢复项目使用另一组 PostgreSQL 与四个 Worker 命名卷。先向空库执行正式 restore，再运行
migrator，仍为 23 项迁移；原 Worker ID、credential ID 和 identity 文件摘要一致，未重新
注册。恢复原 Profile 后创建新的真实 Session，目标 `/verify` 仅读取持久状态，没有重新
写入 Cookie/localStorage；两者及请求 Cookie、实际键鼠回显全部通过。默认 `all` 选中
Viewer srflx 到自有 TURN relay，画面解码连续增长至 633 帧，57 字节原生领取再次 CLAIMED，
对应 Worker 留存目录、文件与 manifest 均已删除。

对初始截图中“Viewer 已连通、Portal 仍显示先前 Session 状态”的观察，另采集四个不同的
Worker 快照时间并持续查看真实 REST 和页面。下一轮快照后 Backend 与顶部状态均为
CONNECTED，并跨后续周期保持一致；稳定样本有 615 个解码帧。这是周期快照与 Portal
轮询的传播延迟，未发现持续状态错误，也未用客户端状态覆盖业务状态。

本组证明受控候选的全新安装和新卷恢复原身份，使用本机提供的源码快照、候选 OCI 与 QA
Extension；不是外部人员仅从公开发行物完成的安装，也不是上一已发布版本升级。对应第三方
公开安装复合项继续保持未完成。完整证据及私有归档只保存在忽略的 `tmp/server-reset-qa/`。

收尾通过公共 API 停止并删除测试 Profile，确认两个测试 Session 已终态且对应 Profile/Session
目录消失；原安装项目及其五个卷已移除。仅保留恢复项目的六个服务、五个数据卷、原 Worker
身份、管理员和合法终态审计历史；Worker ONLINE、controlReady 且 activeTabs 为 0。定义了
健康探针的五个服务均 healthy，TURN 正常运行。本机测试 Chrome 与独立构建器均已停止。

### 已确认仓库身份与本地发布元数据（2026-09-08）

用户确认 BrowShare 为 `x3zvawq/browshare`，Remote Tab 为
`x3zvawq/browshare-remote-tab`。两仓库本地 origin、发布文档和包元数据已对应这些地址，
BrowShare Actions 的 `BROWSHARE_REMOTE_TAB_REPOSITORY` 变量也已设置并读回验证。
Remote Tab 的 `v0.1.23` 本地发布检查通过，六份实际 npm 压缩包均含正确的 repository URL
与子目录。此时两个远程仓库仍无提交和 refs，未设置虚构的固定 revision；没有创建 commit、
push、托管 CI 运行或任何公开包/镜像/Extension 发布。固定提交与托管 CI 项保持未勾选。

### 首次公开提交与托管 CI（2026-09-08）

用户授权后，两仓库分别以 `init` 创建首次提交并推送公开 main：BrowShare 为
`26f1bff785f4c7adeb201d0b06af580c2fd84293`，Remote Tab 为
`c4457f08580812349e68c31c741d010fdd5f0c82`。BrowShare 的配套 revision 变量已设置并读回
后一个完整 SHA；提交前核对正式文件范围与候选，未纳入 `tmp/`、运行数据或凭据。

[BrowShare CI](https://github.com/x3zvawq/browshare/actions/runs/34207833258) 完成完整检查、
设计校验和源码候选生成。实际下载的 12 文件附件通过正式校验工具，两个 source record 均为
对应的 clean `git-commit`，没有将脏工作区标为提交构建。本次 push 未请求可选五镜像 job，
该 job 如实为 skipped。

[Remote Tab CI](https://github.com/x3zvawq/browshare-remote-tab/actions/runs/34207712780)
的源码/测试/包/文档/Compose、三类容器构建、GitHub provenance 和汇总 Gate 全部成功。
下载后的 19 项 checksum 与来源 subjects 验证通过；六个 npm 候选包分别通过 `gh attestation
verify`，限定实际仓库、CI workflow、完整 source SHA、main ref 且拒绝自托管签名 runner。
这是托管 CI 附件及其签名验证，不代表 npm/GHCR 或正式 CRX 已发行。

固定提交与托管 CI 项据此完成。公开安装入口另记录可匿名获取的提交配对和 Remote Tab 本地
目录别名，使部署者无需访问维护者的 Repository Variables。证据在忽略的 `tmp/hosted-ci-qa/`
与 Remote Tab 的同名目录；后续提交须核对自己的 CI 结果，不能继承首次提交的成功状态。

### 当前媒体客户端的配对源码 CI（2026-09-08）

后续 [配对源码 CI](https://github.com/x3zvawq/browshare/actions/runs/34225880615) 对 BrowShare
`b528a9eae8e2e84315d9bf7af8d7555924acc976` 与修正共享媒体流播放的 Remote Tab
`968a66092edff2de72f36055ec97a08c4b473f47` 完成完整检查、设计校验和源码候选生成。
实际下载附件通过正式校验器，两个 source record 均为上述 clean `git-commit`。
本次只请求源码检查，五镜像 job 为 skipped；下述五镜像结果仍对应其原始提交配对。
证据位于忽略的 `tmp/hosted-ci-qa/paired-968a660*`。

### 五镜像托管构建与收到的制品验证（2026-09-08）

[手动 OCI CI](https://github.com/x3zvawq/browshare/actions/runs/34209361177) 对 BrowShare
`6899c317c7c3d1db5a104e853b648a9f8ef8480b` 与 Remote Tab
`c4457f08580812349e68c31c741d010fdd5f0c82` 完成检查及五个 Linux amd64 镜像 job，六个
job 均成功。下载后重新打开 backend、migrator、gateway、portal 四个实际 OCI 归档，通过
正式镜像验证器重新计算 index、runtime manifest、config digest、SBOM 与来源记录，并与
收到的 image record 比较一致。四份完整附件分别通过 release-artifacts 校验；配套源码
附件的 12 个文件也通过校验，所有 source inputs 都指向上述 clean Git 提交。

Worker job 成功构建实际 OCI，但工作流只上传其五份 JSON/checksum 事实文件；收到的这些
文件通过校验，本轮没有下载、重新打开或导入该托管 Worker OCI。四份控制面 SBOM 的包数
依次为 436、436、324、69，Worker 事实文件记录 262。镜像来源是未签名的 BuildKit
SLSA provenance v1，不将它称为发布者身份认证。Remote Tab 同一托管运行的 chrome-node、
signaling、standalone 三份容器 SBOM 及 checksum 也实际下载校验，分别包含 226、96、97
个包；六个 npm 候选的 GitHub 签名验证结果另按上一节记录。

证据在忽略的 `tmp/hosted-ci-qa/oci-6899c31-verification/` 与两仓库的同名 QA 目录。
此项证明公开提交对应的托管构建和收到的候选内容，不代表 registry 发布，也不代替安装、
媒体或备份恢复验收。

### 独立构建器的本地镜像导入（2026-09-08）

公开安装准备发现三个本地构建入口使用未指定输出的 `docker build`，与文档的独立受限
`docker-container` builder 组合时，构建可成功但镜像仅留在构建缓存，后续 Compose 找不到
本地标签。Linux Docker 29.8.0 / BuildKit 0.26.2 用极小 scratch/COPY 上下文复现：原命令
退出成功，`docker image inspect` 仍找不到标签；相同构建器使用 `docker buildx build --load`
后镜像实际存在。控制面、Worker 和独立 Gateway 入口统一显式加载本地结果，保留相邻源码
context、平台、target 与 tag 参数。

这是实际构建器与 Docker 本地镜像库的输出边界验证，不代替五类应用镜像构建或新安装业务
验收。原失败与修复日志保存在忽略的 `tmp/public-source-install-qa/`；已有候选数据卷保留。

### 严格 umask 下的非 root 镜像文件权限（2026-09-08）

Portal 客户端更新使用 `umask 077` 检出公开源码，经正式快照与 OCI 构建后，实际部署的
非 root nginx 无法读取 root 所有的 `0600` 配置文件，Portal 健康检查失败。Dockerfile 的
配置文件及三处 Node 健康检查脚本复制统一指定 `--chmod=0644`，不依赖源码检出者的 umask，
也不更改服务用户或放宽私密配置权限。修复提交为
`5fa3c388d7e779a236cb70253b623c2b1175a300`。

实际容器对照保留输入文件 `0600`：nginx UID 101 使用原 COPY 时读取失败，新 COPY 时成功；
Node UID 1000 在与正式镜像相同的 `WORKDIR /app` 下，原 COPY 报 `EACCES`，新 COPY 读取
完整 1,133 字节，摘要与原健康脚本相同。三个 Node 镜像使用同一条复制指令，此处是共用
文件读取边界的验证，不称三个完整业务镜像都已重建。最初 Node probe 漏写 `WORKDIR /app`
导致隐式目录权限不同，该 probe 已纠正，原记录保留，不作为另一项产品缺陷。
证据位于忽略的 `tmp/portal-client-fix-qa/`，临时验证容器和构建器均已停止。
修复提交的 [托管 CI](https://github.com/x3zvawq/browshare/actions/runs/34226779275) 完成
配套 Remote Tab `968a66092edff2de72f36055ec97a08c4b473f47` 的完整检查及源码候选生成；
本次 push 的可选五镜像 job 为 skipped，完整 Portal 镜像部署结果单独记录。

### Portal 采用修正后的公共媒体客户端（2026-09-08）

从 clean 公开提交 BrowShare `5fa3c388d7e779a236cb70253b623c2b1175a300` 与 Remote Tab
`968a66092edff2de72f36055ec97a08c4b473f47`，仍以 `umask 077` 检出并通过正式
`release:prepare`、`build-release-image.sh portal` 生成同一配对快照的 OCI。SBOM、六文件
checksum 和未签名 BuildKit provenance 通过验证，实际导入并部署的新 Portal image ID 为
`sha256:3f61bd217b3ae910b7f27ce5d5e0a1ba9c79896a48f99ac2b5c796f7803d3a43`。
仅 `BROWSHARE_PORTAL_IMAGE` 发生配置变更；其他应用镜像仍为原 `6899c31` 候选，所有卷、
Worker/Credential 及持久身份摘要保持一致。受限 builder 在恢复六服务前停止，五个健康
检查 healthy，TURN 运行但没有定义容器健康检查。

实际 Portal 的新 Profile/Session 在 Google Chrome Stable 中完成嵌入式 Viewer 连接。
观测同一 MediaStream 的 audio/video 两次 track 回调只触发一次非空 `srcObject` 设置、
一次 `play()` 及成功 resolve，没有 `AbortError`。1280×720 视频的 decoded frames 从
25 增至 72，currentTime 从 1.197 增至 3.264 秒；Backend Session 为 `CONNECTED`，独立
业务目标实际收到鼠标聚焦后的键盘输入。这证明部署的 Portal 已采用修正后的播放逻辑。
实际 HTTP 返回的 SessionViewer chunk 及 sourcemap 也包含与本轮实测、托管下载均相同的
Client 完整入口，SHA-256 为
`8010f65c712e28e3931eccfcaf96572fde9aa128d77372064e092be007ac0c6f`。

浏览器只对本组既有开发 CA leaf 使用临时 SPKI 例外，不把此项称为公网 CA 或强制 TURN/TLS
验收；Remote Tab 的完整桌面及四种传输矩阵另有自己的证据。构建、原失败、权限对照和真实
Viewer 结果保存在忽略的 `tmp/portal-client-fix-qa/`。

收尾通过公共接口关闭 Session 并删除 Profile：Session 为 `CLOSED`，Profile 返回 404，
Worker `ONLINE/controlReady`、activeTabs 0；对应 Profile、Session、spool 和 retained
download 路径均无残留，Worker 无 Chrome/display 进程。自有本机 Chrome、测试目标服务及
20443 转发已关闭，用户既有浏览器保留。六服务继续运行，受限 builder 停止。
最新配置、CA 与 Secret 另归档并复制本机，权限 `0600`，35 个成员及新 Portal 引用已核对。
该归档为 96,734 字节，SHA-256
`d47d83ca5c63eb0f59908c819a0f51db8dc7dddec4e81f51719d634dce0ccf17`；这是配置归档，
不冒充新一轮数据库/Profile 完整备份，原有同点冷备份与旧 Portal 回滚配置仍保留。

### 公开源码隔离安装、候选替换和原身份恢复（2026-09-08）

从公开 HTTPS 匿名获取 BrowShare `ce48677cfbf7d9a31ec25ceb551fa8fbcf523619` 与 Remote Tab
`c4457f08580812349e68c31c741d010fdd5f0c82`，在新工作目录、新受限 builder、新配置和五个新卷
中按正式入口完成五镜像构建及 `--load`。安装输入未使用维护者旧 QA helper、预构建应用
镜像、CA、Worker 身份或 CRX；Extension 0.1.23 从公开源码以本组新密钥签名，并独立验证
CRX 签名、ID 和摘要。新管理员、Enrollment、Worker、Profile 和导航规则通过公共接口创建，
一次性 Enrollment 在首次上线后移除，Worker 以持久身份重新启动并完成对账。

首次安装、候选替换和新卷恢复三个阶段都通过实际 Google Chrome Stable 的 Portal/Viewer、
视频持续解码、鼠标/键盘输入，以及 64 字节浏览器原生下载领取。每次都独立核对 Backend
`CLAIMED` 和对应 Worker directory/data/manifest 全部删除。合成业务站点仅在首次安装
初始化普通测试 Cookie/localStorage；替换与恢复阶段只读原值，同时核对服务端实际收到
Cookie。媒体实际使用本组 TURN/UDP relay；ICE policy 为 `all`，不称强制 TURN 或 TLS 验收。

替换候选为匿名获取的公开文档提交 `6899c317c7c3d1db5a104e853b648a9f8ef8480b`，五镜像
实际重建导入并重建容器。Portal image ID 相同，其余四个不同；Worker 身份、Credential、
identity 文件摘要及 schema 23 保持一致。这是同 schema 的候选替换与数据保留，未据此
声称跨 schema 或已有正式发行版本的升级。Session 关闭、Profile STOP、Worker DRAINING 后，
Worker 与 Backend 在整个 Profile/identity/PostgreSQL 归档期间停止；同点部署配置、CA、
Secret 和 CRX 一并归档。任何镜像切换、恢复或删除原项目/卷前，完整归档已复制本机，权限
`0600`，整体摘要及各成员均验证通过。归档为 90,732,538 字节，SHA-256
`185e3834777ce1de8a12cb4035145baaf9299ea3849a1d84db7575028a9172bf`。

另一 Compose 项目以全新五卷通过正式恢复脚本恢复原 Worker/Credential/identity 摘要，
没有重新 Enrollment；旧实例保持停止。恢复后的真实 Viewer 再次通过上述持久数据、媒体、
输入和原生领取。最终通过公共生命周期删除测试 Profile，接口返回 404，Session 全部终态，
Session 路径、Chrome spool 与 retained downloads 为空，Worker 无 Chrome/display 进程。
本组旧安装项目和卷已移除；保留恢复后的候选和最新私密配置归档，交接时六服务运行、五个
健康检查 healthy、Worker ONLINE/controlReady、activeTabs 0。本机浏览器、目标服务、
受限 builder 和自有端口转发均已关闭。

本组在既有 Ubuntu 测试主机上由项目 Agent 执行，证明公开输入足以完成隔离空项目安装和
恢复；不声称重新安装操作系统或由独立外部真人操作。Portal 浏览器仅对本组指定 leaf
使用 SPKI 例外，业务站点为 HTTP，TURN 证书为开发 CA；不声称公网 HTTPS 业务站点或
浏览器 TURN/TLS 已由本组证明。进度项改为上述实际范围后勾选。全部证据、原始失败与 helper
修正、归档及资源交接保存在忽略的 `tmp/public-source-install-qa/`；私密材料不得公开。

## 可观测性端点与启动日志实测（2026-09-07）

本轮修复Backend请求开始时减去 `Date.now()` 导致累计耗时为负数的问题，改为响应结束时累加Fastify单调耗时，并补齐HTTP状态码和Worker存储指标的Prometheus类型声明。Worker输出最近已完成运行时采样的真实开始时间，HTTP抓取继续复用后台采样，不阻塞控制心跳。

- 本机实际HTTP连接对照：原实现第一次 `/metrics` 抓取为负数，同时保留慢请求和SSE时持续恶化；修复后五次观测均非负递增，12个并发200/404响应、一个500、慢请求与SSE结束分别计入完成数与耗时。这部分服务依赖隔离，不代替数据库鉴权验收。
- Linux测试服务器部署新Backend/Worker/Gateway运行包后，连续27次抓取三类指标均返回有效、无重复series、非负有限数值且各family有TYPE。Backend耗时不回退，Worker真实采样时间至少更新两次，三个组件readiness均通过。Gateway无凭据与错误Bearer均401。
- 可选采集示例经实际Docker Compose配置验证及Prometheus 3.5.0 `promtool check config`通过。临时Prometheus使用固定镜像digest抓取三类真实服务，PromQL `up`全部为1、每个target至少四个样本，耗时与Worker采样年龄查询可用；采集器使用临时内存数据目录，退出后移除容器与凭据副本。此项是实际Prometheus采集，不只是文本格式校验。
- 使用真实PostgreSQL管理员鉴权Session打开profiles/proxies/workspace三个公共SSE，每路收到初始失效通知和15秒心跳，期间持续抓取指标；请求UUIDv7可反查实际Backend结构化日志。对404 query/header和失败登录body注入合成敏感值，日志与指标均未出现这些值或实际Cookie。结束后断开所有流并删除专属auth Session。
- 配置URL、数据库URL、损坏Worker identity共五种失败输入使用实际重建CLI及identity loader验证：均失败退出并保留结构化fatal/type/code，未输出合成敏感值。基线因构建并行而使用独立重建的旧顶层CLI入口和原Pino配置，明确不是旧二进制完整回放。子进程禁止网络，零连接或listener，临时identity已清理。

证据位于忽略的 `tmp/observability-qa/`：`baseline-result.json`、`fixed-result.json`、`live-result.json`、`log-baseline-result.json`、`log-fixed-result.json` 和 `prometheus-result.json`。本轮更新现有测试容器/运行目录，并未构建发布新OCI镜像；Gateway候选保存在现有测试容器可写层。未据此宣称完整业务/WebRTC指标、诊断包、保留策略或正式镜像发布完成。


### 业务和WebRTC聚合指标实测（2026-09-08）

Backend/Worker正式镜像从当前源码构建，更新测试Compose与独立Worker节点，保留原数据卷、身份、
Chrome Stable 152.0.7977.75和Remote Tab 0.1.23。数据库仍为23条迁移，无本轮schema变化。

- 真实Profile START、Session create/Viewer prepare/close、Profile deletion和Proxy probe产生有限命令
  标签，started等于completed加pending。自有TCP端点保持代理连接不响应时，实际RPC pending为1，
  探测返回后为0。健康结果PROXY_CHECK_TIMEOUT计为成功返回的命令与UNHEALTHY代理，不混为传输RPC超时。
- 真实PostgreSQL Session种类/状态与Proxy健康分组同指标逐项匹配，共21条series，包括空状态零值。
  两个实际Worker就绪。存量终态Session只按保留行数统计，不声称为进程累计counter。
- 本机真实Google Chrome Viewer经独立TURN双向relay连接，解码37帧；Worker收到相隔约5秒的两轮
  真实诊断。临时Prometheus三个组件up均为1，视频发送码率、CONNECTED Session和命令累计PromQL
  查询成功。Worker默认回环端口通过同容器网络空间的临时只读采集通道抓取，未公开正式健康端口。
- 指标中无本轮Session/Profile ID、合成代理账号/密码或代理名称。实际Worker HTTP端点的定向检查
  覆盖双样本求和、缺失RTT不作零值、15秒过期排除及移除；这部分输入为公开诊断形状的测试数据，
  不伪称真实网络劣化。真实Session关闭后fresh/stale均为0且媒体数值series消失。
- 本机Chrome、临时目标、采集通道、Prometheus和SSH转发均清理；Profile正式删除404且目录消失，
  Session CLOSED，Proxy删除404，两个Worker activeTabs为0、存储OK。临时凭据副本已移除。

首次Viewer尝试因构建缓存触发LOW_DISK而被409拒绝，单独保留为失败尝试；清理可重建Docker缓存后
重新运行并取得以上媒体证据，没有降低磁盘保护阈值。证据在忽略的`tmp/business-metrics-qa/`，
包括`media-result.json`、`pending-result.json`、`database-compare-result.json`、`prometheus-result.json`
和`cleanup-result.json`。未据此覆盖诊断包、全部日志隐私场景或外部镜像发布。

### 请求、审计与实际Worker命令关联（2026-09-07）

在同一测试服务器部署Session审计commandId补齐和Worker Viewer prepare/continue完成日志后，独立成员用户通过公共API创建MANUAL Profile和真实Chrome Session。Profile START、Session create、Viewer prepare、已连接Viewer continue、Session close五条操作均由实际HTTP请求触发。

本机专属Google Chrome Stable Viewer通过Portal确认接管后建立真实WebRTC连接并解码视频，再执行continue成功。五条链路逐项匹配：响应UUIDv7请求ID → 唯一审计记录及实际commandId → Backend dispatched日志 → Worker SUCCEEDED完成日志；create另与持久Reservation.messageId相同。未生成命令的内部预约或RESERVED直接终态不写伪commandId，协议和业务状态未改动。

`tmp/observability-qa/command-result.json`记录五条完整链路，`viewer-result.json`记录真实连接和已解码帧。清理先走Session关闭、Profile删除、实际目录消失，再删除专属用户、auth、策略与数据库夹具；关闭本机Chrome、专属CDP/转发和目标14978/14979。此项证明请求到业务Worker命令的精确关联，不代表Gateway、Chrome及Remote诊断的完整跨组件追踪。

## Portal 全局状态与确认交互实测（2026-09-07）

本轮在实际测试 Backend/PostgreSQL、Control 1.20、Remote/Extension 0.1.23 上部署 Portal，
本机使用专属 Google Chrome Stable 152.0.7977.76。HTTP 故障只在浏览器内定点替换指定请求，
其余读取、身份恢复、对象和 SSE 来自真实服务；不把被拦截的写请求描述为后端成功操作。

- 原生 EventSource 对初始 HTTP 503 进入 CLOSED：旧版只有一次请求，候选版约三秒重建，
  7.4 秒内三次尝试；撤除故障后自动收到实际事件并恢复“已连接”和最近读取时间。
- 通过正式 API 创建 35 个停止的 Profile，实际加载 30+5 两页。对第二页最旧对象正式改名后，
  原生 SSE 通知触发已加载两页刷新。创建第 36 个对象并让第二页响应 500 时，界面保留完整
  35 条记录及 35 的摘要；撤掉故障手动刷新后同时变为 36，固定代码和请求 ID 可见。
- 独立只读角色通过精确 SQL 故障注入撤销 `profile.read`、`proxy.read`、`worker.read`。
  真实 Backend 三路读取均 403；Profile/Proxy 的实际 SSE 权限事件和 Worker 实际轮询清除
  旧记录，权限恢复后可重新读取。这不是产品角色编辑 API 的证明。
- Workspace、我的 Session、维护、管理员 Session/Profile/Proxy/Worker/注册记录/用户/
  分组/Session 策略/审计共 12 个列表，实际请求保持等待时显示加载反馈；指定请求失败后
  显示固定错误和请求 ID，不同时显示“空列表”。四个设置模块同样验证骨架、首次失败不
  展示未读默认表单、明确重试恢复。
- 真实浏览器分别中断初始管理员深链接、站内 RouterLink、初始登录页的实际 hashed chunk。
  同步恢复页保留 query/hash 和登录 redirect，不自动重载；手动重载恢复原目标。另以定点
  版本响应故障验证服务异常和 API 不兼容恢复，真实只读角色验证 403，未知地址验证 404。
- 9 个管理员页的退出请求定点返回 500 后均显示本地退出提示并到达可操作登录页，不停留
  空白页，也不展示原始错误正文。此项没有撤销实际测试管理员的服务端认证。
- Profile 状态、Proxy 删除、用户状态、分组状态、管理员 Session 结束和 Worker rotation
  生成六类确认在实际页面上通过 axe 4.12.1 零违规；异步等待时正/负按钮、关闭、Escape 和
  遮罩均不能重复提交或关闭。两次定点失败后仍保留确认、显示固定错误和请求 ID，取消可用。
  原确认框缺少可读名称已由实际 axe 基线复现，修复复用原 Naive UI DialogProvider。

证据保存在忽略的 `tmp/portal-global-ui-qa/`。分页和权限使用真实业务变更；其他 HTTP 故障、
资源请求中断和 mutation 错误使用浏览器故障注入。`confirmations-result.json` 前三项成功后
因夹具误用未展示的 Group ID 定位中断，后两项由 `confirmations-group-session-result.json`
补齐；不隐去这一夹具中断，也不把它记为产品失败。SSE 基线保留 `passed:false` 表示已复现
旧版缺陷。测试 HTTPS 入口原持有过期的内存证书，续期文件加载后恢复真实证书校验；首次候选
部署因校验失败自动回滚，回滚页面上的一次 SSE 检查不作为候选版结果。

确认期间认证失效另有实际页面用例：选定 Proxy 删除响应注入 401 后，旧实现到达登录页但仍残留
原确认框；按调用组件作用域销毁其自有确认框后，登录页无遗留对话框并可输入。证据是
`confirmation-auth-baseline-result.json` 和 `confirmation-auth-fixed-result.json`。确认名称
改在标题挂载时设置，避免等待动画结束期间对话框暂时无名称；Worker 确认的最后一次 axe 与
忙碌/失败/重试结果位于 `confirmation-fixed-result.json`。

### 表单与诊断模态

`modal-combined-result.json` 汇总中文浅色桌面的 14 个状态和 390px 英文深色的 13 个状态。
桌面 12 个表单分支覆盖创建/编辑用户、角色、重置密码、分组、分组授权、Session 策略、Profile
授权、Worker 容量、Session 重命名/创建及维护启动；均验证实际等待请求时禁止关闭、503 后
保留草稿、固定错误与请求 ID、显式重试和恢复空闲关闭。另使用实际 READY Session 验证只读
诊断详情。窄屏分支只读取实际页面并检查布局、名称和键盘，不重复进行写入故障测试。

Worker 一次性 Token 在确认没有既有 ACTIVE rotation 后经正式界面生成自有 rotation，
Escape/遮罩不能关闭，明确保存确认后关闭，最后正式撤销接口返回 200。它不是成功换发新证书
的证明，也没有替换实际 Worker 正在使用的凭据。27 个状态的 axe-core 4.12.1 均零 violations，
部分有一项 incomplete；原生 Tab/Shift+Tab 焦点均保持在对话框，截图补充布局检查，不宣称完整
WCAG 认证。重复 banner 的实际基线由 FormModal 布局容器修复。各分项原始报告及因加载时机、
Group/Session 定位方式和大小写导致的夹具中断均保留，汇总逐项指明最终通过来源。

本组 Session 由独立普通成员通过公共 API 在真实 Chrome 中创建并达到 READY，仅用于页面
验收；没有为此额外建立 Viewer/WebRTC。媒体证据继续以已有真实多用户生命周期与公共 Viewer
验收为准。临时只读角色的权限修改和浏览器定点错误响应不替代真实权限管理或业务保存验收。

清理先通过正式接口关闭真实 Session、删除其 Profile并确认实际目录消失，再结束14968/14969
目标服务；另外36个列表夹具Profile均由正式删除接口接受并最终完成生命周期删除，未用SQL绕过
清理状态。随后只删除本批自有数据库夹具、已撤销且未换发证书的rotation及对应测试审计记录，
私密状态中的测试Cookie已移除。本机专属Chrome、19893 CDP、15443转发及三个浏览器CLI会话均
关闭。最终Backend数据库/migration就绪、Worker控制/Chrome运行能力/对账就绪，Worker容器无
业务Chrome进程。汇总见 `acceptance-summary.json`，`fixtureCleaned:true`。

## 控制面源码镜像与首次初始化验收（2026-09-07）

本组从两个协调源码目录的冻结依赖构建正式 Dockerfile 的 Backend、migrator、Gateway、Portal
目标，使用 `compose.control.yml` 创建独立 PostgreSQL 卷和开发 TLS/Worker CA。migrator 在空库
应用 22 个 SQL migration，重复运行仍为 22 条；Backend、Gateway、Portal 都达到 healthy。
修正了实际 Docker 创建容器时暴露的 tmpfs YAML 条目拆分，以及 Nginx 连接数超过文件句柄上限。
生成器拒绝覆盖已有目录，失败前后的配置和秘密文件逐个保持相同；Secret 父目录 0700，私钥 0600。

本机 Google Chrome Stable 152.0.7977.76 通过专属转发访问开发 HTTPS 入口。独立 HTTPS 请求使用
生成 CA 完整校验证书链及域名；浏览器仅信任本次开发证书的 SPKI，不使用全局关闭证书检查。
本机测试 Chrome 显式直连转发，避免系统代理处理测试域名。页面与错误/完成状态共五次
axe-core 4.12.1 扫描均为零 violations、各有一项 incomplete，并检查截图、窄屏布局。
这不是完整 WCAG 合规声明，也不是公网受信证书或真实 Viewer/WebRTC 验收。

### 一次性初始化与界面

- 桌面中文浅色和 390px 英文深色都从受保护页面进入 `/setup`，保留原查询与锚点。
- 实际错误 Token 返回 403，页面保留管理员草稿并展示固定错误和对应请求 ID。
- 两个独立浏览器上下文同时提交实际表单，分别收到 201 和 409；页面分别显示完成或已由另一操作
  完成，并清除密码与 Token 输入。数据库仅有一位管理员、一条完成标记、一条 `system.bootstrap`
  审计；审计 `metadata.method=token`，`requestId` 精确对应 201 的 HTTP 请求。
- 实际页面登录成功并恢复原目标 URL。初始化状态变为 true/false，再访问 `/setup` 回到业务入口。
  保留的正确 Token 也不能重置管理员；重启 Backend、Gateway、Portal 后仍返回 409，原管理员仍能登录。
- 未配置 Token 的界面说明、重新检查实际完成状态、请求等待期间单次提交、503 后保留草稿与显式重试
  另用浏览器定点响应覆盖。503 正文哨兵未进入页面，长请求 ID 在窄屏正常换行；这部分属于界面故障注入。

两个辅助数据库使用同一正式 Backend/migrator 镜像完成独立实际 HTTP 验收：空库无 Token 时
GET 状态 false/false、POST 503、`/auth/config` 200，用户和完成标记均为零；环境管理员路径创建
一位管理员及一条 environment 审计。更换环境邮箱和密码后重启，原用户、密码指纹、设置及审计不变，
原密码登录 200，新密码/新邮箱 401，正确 Token 在重启前后都返回 409。这两个数据库、独立角色、
容器和秘密均已清理，独立 PostgreSQL 目录及 Docker label 查询确认没有残留。

### 入口与证明范围

开发 HTTPS 的 SPA 路由返回页面且不缓存，缺失哈希资源返回 404 且不长期缓存。生成较早的运行期
Nginx 配置曾对 404 保留 immutable 响应头，更新为正式模板后通过实测；保留失败基线，未用镜像
构建成功代替运行期配置检查。Gateway 探针读取真实 Secret 文件认证成功，匿名 health 返回 401；
公开 WSS 路径实际完成连接升级。独立 Worker 控制入口要求客户端证书，匿名连接收到
`ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED`。这组没有 Enrollment/真实 Worker Hello、文件领取、
TURN 或 Viewer 协商，不能勾选完整 All-in-one、Distributed 或完整同域 Viewer 发布验收。

临时证据在 `tmp/control-compose-qa/`（`ui-result.json`、`ui-failures-result.json`、
`deployment-result.json`、`generator-result.json`）和 `tmp/initialization-qa/aux/`。
Backend 日志未出现本批实际初始化 Token 或管理员密码。本机专属 Chrome、CDP 19894 和浏览器 CLI
会话已关闭；独立控制面候选保留在测试服务器，供下一步 Worker/TURN 集成使用，其配置和测试凭据仍只在
忽略的 tmp 中。原业务 QA 的 Backend、Worker、数据卷及身份不受这次独立部署影响。

## All-in-one Worker、TURN 与真实 Viewer 验收（2026-09-07）

本组在上述独立控制面候选上使用正式 `compose.all-in-one.yml` 和 TURN 配置生成器接入 Worker
与固定 digest 的 coturn 4.17.2。它是测试服务器上的实际 Compose 集成，不等同于从空白 Linux
主机完整重建、Distributed 部署、升级回滚或外部镜像发布验收。

### Worker 镜像约束与身份重启

实际容器启动暴露两处模板问题：只读根文件系统下 `/home/node` 不可写，Chrome crashpad 无法
初始化；`cap_drop: ALL` 又使现有 Chrome seccomp profile 的 chroot 规则无法生效。正式模板
分别增加有界的 `/home/node` tmpfs 和 `cap_add: [SYS_CHROOT]`，保留只读根文件系统、非 root、
`no-new-privileges` 及 Chrome seccomp sandbox。修复后在这些实际限制下运行镜像验证，
`browshare/worker:all-in-one-qa` 的 Node 24.12.0、Google Chrome Stable 152.0.7977.75 和
`chrome-seccomp` 检查通过；没有通过关闭 sandbox 绕过失败。

首次注册完成后移除一次性 Token 再重启 Worker，实际结果为 Worker ID、credential ID 保持不变，
runtime generation 更新且 readiness 恢复。此项证明同一持久身份可在无注册 Token 条件下重启，
不将其当作活跃 Session 无损恢复证明。服务器忽略目录 `tmp/control-compose-qa/` 的
`worker-image-restricted-verify.log`、`worker-restart-result.json` 保存对应结果。

### 短期凭据与 TURN transport

Gateway 使用正式配置加载器和 `createIceServerProvider` 签发带到期时间的临时凭据；凭据只在
验收进程内存流转，不输出或写入结果文件。针对实际候选的 TCP 16478、TLS 16479，服务器本地
及外部 macOS 客户端均完成 UDP relay 的 Allocate 600 → Refresh 600 → Refresh 0。返回 relay
地址为候选公网 IP，端口均在配置的 55000–55063 内。TLS 使用实际 CA 和证书 IP SAN 校验并
协商 TLS 1.3；使用相同可信 CA 但错误主机名时连接被拒绝。所有自有 allocation 已主动释放，
socket 已销毁；没有为此另启 TURN 服务或更改候选配置。

另在同一固定 coturn 4.17.2 镜像的隔离 UDP 实测中，正式 signer 使用 60 秒有效期：原 allocation
在凭据自然过期后仍可 Refresh，新 allocation 使用过期凭据返回 401，重新签发后成功分配。
这组结束后移除自有容器和临时秘密。它证明 coturn 的实际到期边界，不代表当前浏览器已经完成
长会话自动恢复；信令配对重新建立时调用 provider 的代码与独立配对验收也不替代该媒体实测。

证据位于忽略的 `tmp/gateway-turn-qa/`：`transport-wire-result.json`、
`transport-external-result.json`、`wire-image-result.json`。前两项是实际 TURN 控制交互，
不能单独证明 peer relay 数据传输或浏览器通过 TURN TLS 传输媒体。

### Portal Viewer 媒体与输入

真实 Session 的 Portal Viewer 达到 connected，并在 `iceTransportPolicy=relay` 下收到解码
视频。已选中的本地 candidate 是 relay，`relayProtocol=tcp`，URL 为候选的
`turn:…:16478?transport=tcp`；远端同样为 relay，candidate 的 `protocol=udp` 指分配的 UDP
relay，不应据此把客户端到 TURN 的 TCP 连接写成 UDP transport。`media-result.json` 记录
至少一帧已解码及实际接收字节；页面输入和 Echo 后的截图显示远端页面已收到
`All-in-one input verified`。这组证明实际 TCP TURN relay 媒体和输入，不宣称浏览器选择过
TLS candidate，也不据一次连接宣称长期稳定性或完整浏览器兼容矩阵。

本机证据位于忽略的 `tmp/all-in-one-qa/media-result.json` 和 `input.png`。

### 真实下载与文件入口

远端 Chrome 通过实际 Viewer 鼠标点击测试页附件，Worker 留存并上报 AVAILABLE。Portal 下载收件箱
经正式授权接口获取短期领取 Token，通过独立 `https://browshare.test:16446/claim` 提交给 Nginx 文件入口，
Worker 通过同一 mTLS 控制端口消费授权，再直接返回文件字节。本机 Chrome 原生下载完成事件已观测，
保存的 49 字节与测试源逐字节一致（包含中文与 Emoji），Backend 状态随后收敛为 CLAIMED。
忽略目录 `tmp/all-in-one-qa/download-result.json`、`downloads/` 和 `download-delivered.png` 保存结果。
第一次领取已到达 CLAIMED，但跨 Playwright CDP 客户端不能直接 saveAs；第二次改用本机原生下载事件
与明确的忽略目录保存，完成文件内容核对。此差异属于验收驱动，不是产品下载失败。

结束后通过正式 API 关闭 Session、删除 Profile，并确认 Worker Profile 目录消失、容量释放；
独立目标容器、本机 Chrome、浏览器自动化连接和文件转发均清理。候选控制面、TURN 和已注册 Worker
保留供后续部署验证，不删除其数据库与身份卷。

## 独立 Gateway、TURN 与多 Worker 部署验收（2026-09-07）

在同一测试服务器上运行三个独立 Compose 网络：控制面的原 Worker、独立 Worker 节点和独立
Gateway 节点。独立 TURN 使用自己的项目及 host network。节点之间经宿主发布的 HTTPS/WSS/mTLS
端口通信，没有把三个业务容器加入同一 Docker 网络；QA 的 `.test` 域名用明确 hosts 配置解析，
本机 Viewer 到 `gateway.test:17443` 的 WSS 与 TURN 均直接访问测试服务器公网地址。
这证明独立进程、网络、配置与文件卷的部署路径，不代表多台物理服务器故障域、跨地域延迟或容量演练。

### 配置与启动

正式 `compose.worker.yml` / `compose.gateway.yml` / `compose.turn.yml` 分别生成并启动；
Worker/TURN 的共同运行限制由各自 runtime Compose 文件复用，All-in-one 使用相同定义。
第二 Worker 实际 Enrollment、Chrome/Extension 探针与 mTLS 控制连接通过。Gateway 使用自己的
UUID、Secret 和 TLS 证书，在 Backend registry 中注册，Backend 按注册顺序选择该健康节点。
独立 TURN 在固定 coturn 4.17.2 镜像上启动，服务器和外部 macOS 均通过 TCP/TLS Allocate、
Refresh、释放及实际 CA/IP SAN 验证；临时验证 allocation/socket 已清理，正式候选节点保留。

配置生成验证覆盖公网文件 443 → 容器 8446、Gateway 443 → 8443、原 17443 端口行为、
显式 Portal origin、Worker 名称中的引号与字面 `$`，以及重复运行不覆盖已有 Secret。
Worker 名称以实际一次性容器环境为准；Compose `config` 会重新转义 `$`，不能把其展示值直接
当作进程最终环境。该容器及其独立临时卷已删除，没有为此注册另一台 Worker。

### 两台 Worker 的真实媒体与停止隔离

两条正式 Session 都由独立 Gateway 分配，Viewer 选择 TCP TURN relay，双方 candidate 均为 relay。
停止第二 Worker 前，两条连接分别解码 170、20 帧；停止它后，第一条 Session 仍为 CONNECTED，
解码帧增至 358。第二 Worker 移除 Enrollment Token 后重建并恢复 controlReady，第一条继续到 625 帧。
第二条丢失的 Session 以 `WORKER_STATE_MISSING_AFTER_RECONNECT` 收敛为 FAILED，原 Profile Runtime
为 ERROR；没有把容器重启写成 Session 无损恢复。之后经正式 START 启动新 Runtime 可再次创建 Session。

早期验收脚本复用了因 Viewer 断开超时而结束的测试 Session，并过早进入媒体断言，未作为通过证据。
最终脚本在创建后立即连接，以显式读取的连接状态和解码帧数判断成功。
`tmp/distributed-qa/media-isolation-result.json` 保留上述实际通过结果和独立网络名称。

### 独立 TURN 与独立文件入口的完整链路

独立 Gateway 切换到独立 TURN 的新共享 Secret 与 TCP 18478，新 Session 的 Viewer 实际选中该 URL，
双方为 relay，已解码 33 帧。通过 Viewer 点击真实测试页附件，独立 Worker 留存并上报 AVAILABLE；
Portal 通过 `https://browshare.test:17446/claim` 领取。第一次因文件模板依赖单机入口的 DNS resolver
而返回 502，文件仍保持 AVAILABLE。修复为文件 server 块自带 Docker resolver 后，重试同一文件，
观测到本机原生下载完成，49 字节（含中文和 Emoji）与源内容逐字节一致，Backend 收敛为 CLAIMED。
`tmp/distributed-qa/final-chain-result.json` 和下载文件记录该链路；独立 TCP/TLS wire 结果位于
`tmp/gateway-turn-qa/independent-transport-*-result.json`，未将它们当作浏览器 TLS 媒体验收。

收尾通过正式 API 结束本组全部 Session、删除两个 Profile，核对节点上的 Profile 目录消失及容量归零。
本机 Chrome、测试目标容器、注册 Token 临时文件和本轮端口转发清理；候选控制面、两个 Worker、
独立 Gateway 和 TURN 保留供升级/恢复工作，身份、数据库和文件卷没有删除。

## 控制面、Worker 与 Profile 数据升级验收（2026-09-08）

### 历史数据库与 Control 1.21 迁移

固定原 22 项迁移镜像，用正式 SQL/journal 构造 21 项历史 schema，并写入有效用户、Worker、
Profile、context、授权及初始化管理员关系。当前 Backend 拒绝该 schema，正式 migrator 升至 22
后原字段、关系和时间保留，新存储默认值与约束有效，重复迁移不改变数据。正式 backup/restore
恢复到另一空数据库后，得到同一历史 schema，再次升级并使用原密码登录成功。这是历史 schema
夹具，不冒充已发布旧版本；原地 down migration 不在证明范围。证据：`tmp/database-upgrade-qa/`。

实际第 23 项迁移 0022 在旧 START outbox 存在时以 P0001 拒绝，迁移记录仍为 22、新列不存在，
业务及 outbox 无变化。移除专属受控夹具后，正式迁移验证 generation 0 为 false、历史有启动
代数的 Profile 为 true、新建默认 false，重复迁移不改变结果。当前 1.21 codec 对缺字段和六种
非 boolean 输入在 encode/decode 两端均拒绝；true/false 原样传递。历史 1.20 START 仍可解码，
新版执行器在调用 Runtime 前拒绝。这组执行器使用隔离端口，不替代下面的真实 Chrome 验收。
证据：`tmp/profile-data-contract-qa/`；专属数据库、角色、容器及秘密已清理。

### 实际镜像升级、数据缺失与归档恢复

旧部署的专用 Profile 在实际 Chrome 写入持久测试 Cookie 后正常 STOP。移走其目录再 START，
旧实现错误地返回 RUNNING，Chrome 自动创建空目录且原 Cookie 不存在，确认了文档要求与实现
不一致。修复增加持久初始化标记及 Control 1.21 数据检查，没有以 Runtime generation 推断新
Profile 的正常首次初始化是否完成。

两个实际 Worker 进入 DRAINING、Session 全部终态、Profile 停止且旧 outbox 为空后，停止 Worker
与 Backend，使用正式脚本备份 PostgreSQL 和 Profile，并归档两个 Worker identity。随后部署
真实新构建的 Backend/Migrator/Portal/Worker 镜像，迁移至 23 项并复用原命名卷；镜像 ID 确实变化，
Worker ID 与卷映射保持不变。一个 Worker 首次 Probe 失败，经正式诊断 API 重探 READY 后才恢复
ACTIVE，没有将 Docker liveness 当作业务就绪。升级后原 Profile 正常启动，测试 Cookie 保留。

再次移走已初始化 Profile 目录，新版返回 `PROFILE_DATA_MISSING`；实际进程检查无该 Profile
Chrome，磁盘未创建目录。ALWAYS_ON 在超过 45 秒、四次观测和至少三轮新快照期间保持同一错误及
generation，不自动重试。空目录但没有 Local State 的情况也明确拒绝。Portal 实际中英文页面
显示恢复指引，390px 英文页面无视口横向溢出，未显示误导的自动恢复等待提示。

随后再次停止 Worker，从之前归档恢复其 identity，并使用正式 Profile restore 脚本恢复空目录。
Worker 以原 ID 重新认证并完成探测/对账，手动 START 后原测试 Cookie 仍存在。新建的另一 Profile
首次启动也通过，数据库标记实际从 false 变为 true。恢复后的 Session 经独立 Gateway、独立 TURN
TCP 18478 建立双方 relay，实际测试页面已加载并解码 35 帧。首轮因测试目标未启动而仅收到浏览器
错误页媒体的结果明确排除，保留在 `media-attempt-1.json`，没有用帧数掩盖目标页面缺失。

构建期间系统盘低于默认 5 GiB 阈值，START 正确返回 LOW_DISK。只清理闲置构建缓存后，实际存储
快照回到 OK，再继续启动；未降低阈值、删除回退镜像或改动数据盘。本次 Google Chrome Stable
仍为 152.0.7977.75，Remote/Extension 仍为 0.1.23；证明的是当前 Chrome 数据卷在应用升级和
归档恢复后可用，不是 Chrome 二进制跨版本兼容、第三方网站登录保证或整台空机灾难恢复。

证据位于 `tmp/profile-data-recovery-qa/`。本轮两个 Profile 均经正式 API 删除、两个 Session 为
CLOSED，实际目录消失；两个候选 Worker 保持 ONLINE/controlReady、活动 Tab 为 0。本机 Chrome、
测试目标、端口转发和本轮额外凭据/数据副本清理，候选运行环境保留。对应类型检查、构建和相关
lint 通过，未创建 Git commit。

## Chrome pipe 隔离与 Viewer/Portal 职责验收（2026-09-08）

真实旧 Chrome 网页可读取原生 CDP HTTP 的 `/json/list`，并通过 GET 关闭另一个受控目标；仅校验
WebSocket Origin 无法覆盖该入口。修复后 Profile Chrome 仅使用 `--remote-debugging-pipe`，
Worker bridge 的随机秘密 WS 路径拒绝任何 Origin，普通 HTTP 一律 404。Proxy Adapter 拒绝
loopback 与本网络目的地址；同网络上游仍能自行解析普通域名，所以没有将目标过滤当作完整隔离。

实际 Chrome 与正式 bridge 验证多客户端独立请求 ID、自动附加、子 Session、下载事件与连接关闭，
网页即使获知测试能力路径也因 Origin 被拒绝。正式 ProfileChrome/supervisor 验证持锁、正常关闭、
父进程 SIGKILL、已有数据重启以及 SIGSTOP 后不经 SIGCONT 排空。隔离 Extension 服务使用 Node
客户端验证 secret/generation/Origin，证明范围明确限于协议；证据为 `tmp/loopback-isolation-qa/`。

随后将两个真实 Worker 升级为 pipe 候选镜像，保留原身份和卷。通过实际签名 Extension、公共 Viewer、
独立 Gateway 与 TURN 建立同 Profile 两个 Session 的 relay 媒体，分别解码 18/21 帧，并完成原生输入、
真实保留下载及子窗口本机打开确认。Viewer 的结束按钮仅发事件，Portal 确认后发出实际 POST 202；
A 结束时 B 原 peer 和解码帧继续推进。Portal 负责授权、业务生命周期与下载领取，Viewer 负责媒体和
输入，沿用各自公开接口。

恢复存活 B Viewer 并解码 31 帧后，精确终止其 Worker Node 进程。旧 Chrome 随之消失，同一容器
使用同镜像、原卷和身份自动恢复，新 instance 就绪、旧 Session 终态。新 C Viewer 解码 30 帧，原
持久测试 Cookie、localStorage 和崩溃前保留下载均可用；下载经原生 HTTPS form 领取，中文 UTF-8
字节与原文件完全一致。没有重新暴露 CDP HTTP 作为测试入口。

证据 `tmp/cdp-pipe-runtime-qa/` 保留分阶段结果：初次本机打开策略拒绝与两次 kill 前进程定位
检查失败均未掩盖，后两次未执行 kill；双 Viewer 成功阶段与最终唯一一次 kill/恢复成功分别存档。
该验收不是一次无中断重跑，也不证明外部网站登录或不同 Chrome 版本的数据兼容性。
所有五个测试 Session 终态、Profile 经 API 删除且目录消失，两个 Worker 均 ready、活动 Tab 为 0、
磁盘 OK。本机 Chrome、目标容器、端口转发和本轮私有环境副本清理，候选部署保留。

## 业务审计、诊断包与跨组件日志验收（2026-09-08）

### Page Script 首次错误与 Gateway 关联

Control 1.22 复用活跃 Session 事实和结束 tombstone，携带首次 `PAGE_SCRIPT_FAILED`、不可变
发布版本及 Core 事件发生时间。Backend 在 Session 行锁内校验运行身份和数据库版本，同事务写入
Session 事件与审计，并以已有事件去重；无数据库迁移。真实本机 mTLS 1.21/1.22 协商、字段剥离与
MessagePack 校验通过，但这些隔离端口证据不替代后续真实 Chrome 验收。

六个候选组件切换后，两个 Worker 全部探测通过并以 Control 1.22 就绪，数据库仍为 23 项迁移，
原身份与卷映射保留。实际 Google Chrome Stable 152.0.7977.75、签名 Extension/Remote 0.1.23
分别运行立即抛错和仅在 detached 事件抛错的两个发布版本。两只公共 Viewer 经真实 Gateway/TURN
建立双方 relay，分别解码 24/22 帧。A 的首次审计在多个快照及关闭后仍保持同一 ID、时间和版本；
B 关闭前没有错误审计，关闭后从真实结束事实形成一条审计。数据库直接复核两者各只有一个
`page_script.failed` Session 事件。没有声称每次异常都持久归档，首次摘要送达前 Worker 硬退出
仍可能丢失易失观察；本批未另外制造控制重连，协商重连由隔离 mTLS 验证覆盖。

Gateway 接入已有公开 `onDiagnostic`，仅记录固定事件/机器码、Session、Viewer generation、
Gateway ID 和观察时间。正式镜像验证 signaling/protocol 包可解析并实际启动；真实配对和断开
日志逐一与 Backend Session 的 Gateway、代次、Worker、Runtime 对应。隔离实际信令引擎另覆盖
两代配对、offer/answer、ICE restart、错误、超时和非法票据，共 33 条日志、10 类事件；隔离授权
端口不冒充数据库或 WebRTC 媒体验收。Core 状态和媒体聚合沿原公开 hook，Chrome 退出关联复用前述
pipe/SIGKILL 验收，不新增逐帧日志或业务 ID 指标标签。

### 诊断导出、权限与日志隐私

新的固定字段诊断包在实际 Backend/PostgreSQL/Worker 部署上验证：匿名 401，分别撤销四项所需
权限均为 403，无效 UUID 400、不存在 Session 404；系统与指定 Session 范围正确，两个 Worker
的实际探测、版本、metrics 采样时间可读。201 条明确标识的审计夹具用于验证 200 条上限和截断，
不冒充真实业务动作。任意 metadata/changes 和非 UUID 关联字段哨兵未进入输出；每次成功生成
记录的审计请求 ID 与响应 `x-request-id`、包内 requestId 相同。

Portal 实际 Chrome 152.0.7977.76 在 en-US/light/390px、zh-CN/dark/390px、en-US/dark/1440px
下完成键盘提交与 JSON 展开、本机原生下载且内容与 API 逐字段相同、非法输入、404、断网重试与
撤权 403。失败清除旧包，没有视口横向溢出或页面异常。截图经人工视觉检查；本批没有声称运行 axe。
诊断包不主动探测 Gateway 或抓取页面，也不是故障数据库的离线备份工具。

实际 HTTP 请求携带路径、参数、查询、Host、Cookie、Authorization 和登录正文哨兵，收到对应
404/400/401；新请求日志只包含路由模板或 `[unmatched]`，请求 ID 仍能关联。收集本批 Backend、
两个 Worker、两个 Gateway 的 stdout/stderr，未出现上述哨兵、实际 Page Script 错误正文、页面
Cookie/正文、context 哨兵或私有 CDP 能力路径。Gateway 隔离 wire 另外验证票据、绑定凭据、SDP、
错误正文、地址和未知字段不会进入 sink。该结果与先前文件/剪贴板/代理/认证日志边界共同使用，
不将本批两个页面说成对任意第三方页面的穷举验证。

七个业务域的既有 writer 与真实 API/浏览器/节点证据已整理于
`tmp/observability-qa/audit-coverage.md`：包括实际用户与角色分配、授权、Profile 生命周期、
Worker 凭据/容量、Proxy、策略和 Session/Viewer/下载。各域沿用历史版本与证明范围；部分证据
证明实际操作经过同事务 writer，没有单独枚举每条审计 ID，不扩大为所有历史审计逐行重测。
本批补齐此前遗漏的 Page Script 运行错误审计，并完成诊断生成审计。

本批证据为 `tmp/diagnostics-qa/`、`tmp/page-script-error-qa/` 和
`tmp/gateway-diagnostics-qa/`。两个 Session 均 CLOSED，Profile 经 API 删除且精确目录消失；
临时诊断账户已软删除/撤销登录，临时角色及 201 条审计夹具删除，真实业务审计按保留策略保留。
两个 Worker 就绪、活动 Tab 为 0、磁盘 OK。本机 Chrome、目标容器、端口转发及额外环境副本清理；
候选六组件与原卷保留。相关类型检查、构建和定向 lint 通过，未创建 commit。
