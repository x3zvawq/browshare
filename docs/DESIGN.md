---
version: 'alpha'
name: BrowShare control plane
description: Calm, trustworthy browser-workspace administration with clear operational state.
colors:
  primary: '#0F62D6'
  primary-dark: '#5AA9FF'
  brand-primary-hover: '#4096FF'
  brand-primary-pressed: '#0958D9'
  brand-cyan: '#13C2C2'
  accent-coral: '#FF6B6B'
  canvas-light: '#F5F7FB'
  surface-light: '#FFFFFF'
  surface-raised-light: '#FFFFFF'
  text-primary-light: '#172033'
  text-secondary-light: '#667085'
  border-light: '#E4E9F2'
  canvas-dark: '#0C111D'
  surface-dark: '#151C2C'
  surface-raised-dark: '#1D2638'
  text-primary-dark: '#F4F7FC'
  text-secondary-dark: '#AAB5C7'
  border-dark: '#2B3548'
  success: '#18A058'
  success-dark: '#55D98A'
  warning: '#F0A020'
  danger: '#D03050'
  danger-dark: '#FF7595'
  info: '#2080F0'
  info-dark: '#63A8FF'
typography:
  display:
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '2rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.02em'
  heading-lg:
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 650
    lineHeight: 1.35
  heading-md:
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 550
    lineHeight: 1.4
  mono:
    fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.55
rounded:
  xs: '4px'
  sm: '6px'
  md: '10px'
  lg: '14px'
  xl: '20px'
  pill: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
  2xl: '32px'
  3xl: '48px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '#FFFFFF'
    rounded: '{rounded.sm}'
    height: '36px'
    padding: '0 16px'
  button-primary-hover:
    backgroundColor: '{colors.brand-primary-hover}'
  button-primary-pressed:
    backgroundColor: '{colors.brand-primary-pressed}'
  card:
    backgroundColor: '{colors.surface-light}'
    textColor: '{colors.text-primary-light}'
    rounded: '{rounded.md}'
    padding: '20px'
  input:
    backgroundColor: '{colors.surface-light}'
    textColor: '{colors.text-primary-light}'
    rounded: '{rounded.sm}'
    height: '36px'
  status-pill:
    rounded: '{rounded.pill}'
    padding: '3px 9px'
  app-canvas-light:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.text-primary-light}'
  app-canvas-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.text-primary-dark}'
  modal-light:
    backgroundColor: '{colors.surface-raised-light}'
    textColor: '{colors.text-primary-light}'
    rounded: '{rounded.lg}'
  modal-dark:
    backgroundColor: '{colors.surface-raised-dark}'
    textColor: '{colors.text-primary-dark}'
    rounded: '{rounded.lg}'
  control-surface-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.text-secondary-dark}'
  helper-text-light:
    textColor: '{colors.text-secondary-light}'
  divider-light:
    backgroundColor: '{colors.border-light}'
  divider-dark:
    backgroundColor: '{colors.border-dark}'
  realtime-indicator:
    textColor: '{colors.brand-cyan}'
  viewer-entry:
    backgroundColor: '{colors.accent-coral}'
    textColor: '{colors.text-primary-light}'
    rounded: '{rounded.sm}'
  status-success:
    textColor: '{colors.success}'
  status-success-dark:
    textColor: '{colors.success-dark}'
  status-warning:
    textColor: '{colors.warning}'
  status-danger:
    textColor: '{colors.danger}'
  status-danger-dark:
    textColor: '{colors.danger-dark}'
  status-info:
    textColor: '{colors.info}'
  status-info-dark:
    textColor: '{colors.info-dark}'
  navigation-active-dark:
    textColor: '{colors.primary-dark}'
---

# BrowShare interface design

## Overview

BrowShare的界面应当像一套可信、克制的基础设施控制台，而不是传统拥挤的企业后台。视觉基础参考 Material Design 3对颜色层级、状态反馈和无障碍的成熟原则，再通过 Naive UI主题变量落地；不机械复刻 Material组件外观。

产品图标的蓝色是主要识别色。页面使用浅中性色提供稳定背景，品牌色只用于主动作、选中状态和关键连接信息。高风险操作使用明确的危险色和二次确认，不依靠低对比度装饰表达重要状态。

## Brand assets

品牌图标使用透明背景 SVG，标准源文件为 [`assets/browshare-icon.svg`](assets/browshare-icon.svg)，Portal 的 `public/browshare-icon.svg` 保持相同内容。README、登录页、导航、介绍页和 favicon 使用同一图形。

BrowShare 与 Remote Tab 共用蓝色窗口、圆角和三色窗口按钮：BrowShare 以叠放窗口与共享节点表示工作区；Remote Tab 以指针与珊瑚色信号表示远程交互。图标不含位图、字体或外部资源，保持画布透明，在浅色与深色表面上都清晰可辨。

## Colors

- 品牌蓝用于主按钮、活动导航、链接和连接正常的重点信息，不铺满大面积管理页面。
- 青色只用于数据链路、实时状态和次级图表，避免与成功状态混淆。
- 珊瑚色继承 Remote Tab图标中的交互信号，只用于 Viewer入口、接管提示等少量强调。
- 成功、警告、危险和信息颜色必须同时配合图标或文字，不能只靠颜色传达。
- 深色主题不是简单反色。画布、普通表面和浮层使用三个独立层级，边框保持可见但不过亮。
- 深色主题中的链接、选中导航和状态文字使用独立的高亮色，不直接复用浅色背景上的品牌蓝和状态色。
- 正文与背景、控件文字与控件背景至少满足 WCAG 2.1 AA。

## Typography

界面以系统无衬线字体为主，中文优先使用 PingFang SC或 Noto Sans SC。数字、ID、版本、IP、端口和协议字段使用等宽字体。

- 页面标题使用 `heading-lg`，不要在后台页面使用超大营销标题。
- 卡片和表格区块标题使用 `heading-md`。
- 正文默认14px，通过字重和色阶建立层次，而不是堆叠更多字号。
- 状态、按钮和表头使用 `label`，避免全大写英文。
- 长 ID默认截断，但必须提供复制和查看完整值的方式。

## Layout

桌面端使用固定侧边栏、顶部上下文区和可滚动内容区。常规页面内容宽度不强制居中窄栏；数据表和详情页应充分利用可用空间。

- 侧边栏展开宽度240px，折叠宽度64px。
- 页面水平留白在常规桌面为24px，大屏为32px，小屏为16px。
- 表单正文推荐最大宽度720px，说明文字与字段保持紧密关联。
- 列表筛选器放在结果上方，常用动作靠近资源标题，不把所有操作塞入页面右上角。
- Profile页面优先使用响应式卡片；用户、审计、Worker和 Session管理优先使用表格。
- 审计页位于`/admin/audit`，导航及直接访问均要求`audit.read`。筛选表单支持操作者、动作、目标、
  结果、请求ID和本机时区时间范围，明确文本精确匹配；提交和重置筛选后从第一页加载。
  详情显示事件身份、来源IP摘要、非敏感变更及关联信息，结构化值按文本渲染。列表和详情
  提供加载、空结果、错误及重试状态；移动端表格横向滚动，详情弹窗管理键盘焦点并支持Escape关闭。
- 移动端保留浏览和基础操作，但复杂策略编辑允许提示用户使用桌面端。

## Elevation & Depth

层级主要依靠表面色、细边框和间距建立，阴影只用于浮层、下拉菜单、对话框和拖拽对象。

- 普通卡片不使用厚重阴影。
- Hover可以提升边框和背景，不让卡片明显跳动。
- Modal必须遮罩背景并保持焦点陷阱。
- Viewer作为独立沉浸区域时，可使用更深背景与悬浮控制条，但不把这种样式扩散到后台页面。

## Shapes

整体使用适度圆角：输入和按钮6px，卡片10px，对话框14px。状态标签使用胶囊形。不要把所有容器都做成悬浮大圆角卡片，也不要使用不表达含义的渐变边框。

图标优先使用同一套线性图标。资源类型图标可以填充，操作图标保持线性。删除、断开、接管、维护和外部打开必须拥有不同图形，不只更换颜色。

## Components

- **Profile card:** 展示名称、运行状态、Worker、代理健康和 Session数量。主要动作只有“打开”或“继续”，维护和停止放入清晰的次级区域。
- **Status pill:** 文案使用完整状态名称；运行状态、业务状态和健康状态不得混成一个标签。
- **Data table:** 固定表头、可见空状态、明确加载状态。密码等敏感列默认遮挡，可用眼睛图标切换。
- **Policy editor:** 左侧展示优先级和规则列表，右侧编辑当前规则；保存前显示冲突和最终命中结果。
- **Code editor:** Page Script与Policy Script使用等宽字体、行号、草稿状态和独立测试/发布动作。
- **Viewer entry:** 从 Profile或 Session上下文打开，不把远端浏览器交互按钮散落到 Portal导航中。
- **Destructive dialog:** 明确写出将结束的 Session、删除的 Profile数据或受影响的授权路径，不使用只有“确定”的模糊确认。

Viewer 新窗口在本机打开由 Remote Tab Viewer 的原生模态确认框承担，Portal 不实现平行的弹窗或输入协议。
确认说明远端登录态、POST 表单内容及原窗口关联不会传递；取消、Escape、过期及策略拒绝均不打开本机页面。
Worker 仅在导航策略返回 `OPEN_LOCAL_PROMPT` 时授权本机打开。Remote Core 在 Chrome 新 Target 发出首请求前暂停并关闭它，
确认后由本机以 `noopener,noreferrer` 打开 HTTP(S) URL；维护会话按其保留子窗口策略处理。

系统设置中的 Viewer 失焦暂停卡片编辑全局暂停条件和宽限时间，明确提示下一次打开或重连时生效。
Profile 编辑提供“继承全局设置”开关；关闭继承后显示同一组条件和宽限时间字段。
禁用自动暂停时隐藏宽限输入，保存失败保留草稿并可重试，成功后显示当前已保存状态。
暂停遮罩、恢复按钮及焦点计时属于 Remote Tab Viewer；Portal 只管理业务配置和连接凭据。

全局媒体设置与 Profile 编辑复用媒体字段组件，编辑最大宽度、高度、FPS、码率和音频允许状态。
说明两层取更严格限制且仅影响新 Session；“不额外限制码率”不表示可绕过另一层限制。
数值支持清空后校验、键盘操作和有名称的增减按钮，网络错误保留草稿，保存期间禁用输入。

## 管理总览

`/admin/overview` 使用 Backend 的全量聚合读模型，不在 Portal 累加管理列表当前页。入口需要
`worker.read` 或 `profile.read`；Worker 区域与 Profile/Session 区域分别按 REST 返回的权限结果显示，
无权分区明确说明所需查看权限，不显示数字或管理链接。管理入口分别跳转现有 Worker、Profile 和 Session 页面。

Worker 区域区分节点状态、控制连接、控制就绪和可调度状态；容量分开显示配置剩余与当前可调度剩余，
有限容量与不限容量节点分别计数，不拼接成虚假的全局百分比。节点空槽不承诺用户一定可以创建 Session。
Profile 区域展示运行状态、删除中、配置待重启、运行线路故障与未知，并说明普通 Session 容量不含维护占用。
Session 区域分列普通与维护占用，状态分布合并两者，仅包含非终态记录。

页面显示服务端采样时间、最近成功读取时间与状态通知连接状态；采样不代表跨组件原子快照或历史趋势。
SSE 失效通知触发整份有权 REST 聚合刷新。网络失败保留上一次采样并标明可能过期，明确 401/403 时清除已显示汇总；
页面隐藏、离页和卸载时沿用现有连接与请求清理。移动端分区纵向排列，长英文标签和提醒可换行。

## 首次初始化向导

Portal 首次恢复先校验 Backend 版本，再读取公开初始化状态。尚未初始化时进入 `/setup`，保留原目标
相对路径的 query/hash；不会显示一个无法登录的普通登录表单。使用现有 AuthShell、表单和语言/主题控件，
包含加载、服务错误、等待部署者配置 Token、可提交表单、成功与另一操作先完成五种状态。

表单收集初始化 Token、管理员显示名称、邮箱、密码与确认密码。字段具名且可键盘操作；提交期间阻止
重复请求，输入禁用。失败显示固定本地化错误、code 和 request ID，保留草稿以便纠正或显式重试。
Token 与密码只在当前页面内存中存在，完成、已初始化或离页时清除；不放入 URL 或 Local Storage。
Token 未配置时只显示部署者配置说明与重新检查入口，不提供无凭据创建管理员的路径。

成功后明确提示使用刚创建的账户登录，不自动登录；另一初始化先完成时提示现有账户未被覆盖。
完成初始化的部署访问 `/setup` 会回到普通登录入口。状态读取网络失败使用现有可重试恢复页，
不能把 Backend 不可用解释成“未初始化”。

## Portal 异常恢复与状态通知

未知路由显示 404；权限不足显示 403 并保留原目标路径，可重新检查权限或返回入口。Backend 无法访问时
显示独立恢复页，重试成功后继续原路径（含筛选 query 和 hash）。恢复页面随 Portal 主包加载，避免断网后
还需下载错误页面；首次版本与会话检查期间提供加载提示。

会话恢复请求失败不清除已知身份快照，但未确认的状态不能放行受保护路由。明确的会话 401 清除登录态，
引导重新登录并保留目标路径。普通业务请求失败保持当前页面及已有数据，通过局部错误和刷新操作恢复；
不会因 Portal 请求断网自动销毁仍连接的 Viewer。

首次恢复会话和手动重新检查时读取公开 `/api/v1/version`。只有合法的 BrowShare Backend 版本响应明确返回
不受支持的 API major 时显示版本不兼容页；网络、5xx、404、HTML及响应结构异常都归入可重试服务异常。
不以产品补丁版本差异阻断使用。错误页面显示固定错误码与请求 ID，不显示服务端原始错误正文或完整目标 URL。

Profile 管理、Proxy、Workspace 和维护目录显示状态通知连接状态、最近一次成功 REST 读取时间和手动刷新入口；通知断开时
保留既有数据，明确提醒状态可能滞后。Viewer 仅在通知中断时显示轻量业务提示，不覆盖媒体、不触发媒体重连。
SSE 仍只传递失效通知；页面隐藏时关闭、重新可见时建链读取快照，离页清理连接与待处理通知。
HTTP 失败使原生 EventSource 进入 CLOSED 时，客户端间隔三秒重新建链；仍处于 CONNECTING 时沿用
浏览器原生重连，避免重复连接。权限事件会触发 REST 复核，明确 401/403 后清除不可读的列表、摘要、
筛选项与读取时间；临时网络错误保留上一次完整快照。已加载多页的数据及其摘要在全部页面读取成功后
一起替换，避免后续页失败时出现新摘要与旧列表混合。

路由资源下载失败进入随主包加载的恢复页面，保留目标 query/hash，包括登录页的 redirect。仅由用户
手动完整重载原页面，不自动丢弃当前文档。表格加载失败不同时显示默认空态，尚未读取的统计显示未知。
请求错误使用本地化固定提示、错误码和请求 ID，不直接展示原始服务端正文。退出请求失败时完成本地
退出并返回登录入口，明确提示服务端退出未确认。

表单弹窗复用具名对话框、原生标题和现有焦点管理；一次性凭据展示保留明确确认后关闭的限制。
操作确认复用 Naive UI DialogProvider，在异步请求期间锁定重复提交、取消、关闭、Escape 和遮罩关闭，
失败保留确认框并给出错误反馈。不同操作的影响文案和原有空闲关闭行为保持各自业务定义。

## Profile 停止与清理恢复

Profile 管理清单保留普通“停止”操作，另提供明确的“停止并结束全部会话”恢复动作；两者均要求
`profile.manage`。恢复入口依据 Backend 的 `runtimeRecovery` 资格与拒绝原因展示状态，不以 Worker 的历史
ONLINE 状态推断当前控制连接可用，也不因对账尚未完成而一律屏蔽恢复入口。

恢复确认框明确受影响的 Profile 名称，说明将结束其全部普通与维护 Session、断开现有 Viewer、丢失未保存的
页面操作并停止 Chrome，持久登录态保留。只有确认恢复操作才提交 `closeSessions: true`；普通停止继续保留
活动 Session 保护。对常驻 Profile，恢复确认框另明确说明同时切换到手动模式，防止 Chrome 自动重新启动。
提交期间锁定按钮及关闭操作，失败保留确认框并展示固定错误码、请求 ID，允许重试。
请求接受后继续展示真实运行状态，等待 Worker 清理确认，不提前显示为已停止或释放容量。

Worker 详情区分已认证连接与对账就绪状态。待清理事实显示对象范围、Backend 判定的登记状态、运行实例、固定错误码及时间；断线时
标明为最后上报事实。无失败记录不等于已完成对账。Profile/Session 业务 ID 与管理入口按 `profile.read`
控制显示，页面不提供按任意上报 ID 直接清除对象的操作。

## Page Script 用户页面变量

Page Script 管理页提供独立的“用户页面变量”区域，通过现有用户选择器搜索目标用户，读取并编辑
该用户在当前 Profile 下的 JSON 变量。页面路由与用户选择列表需要 `profile.read`，上下文 GET/PUT
均需要 `profile.manage`；仅有 read 权限时显示权限说明，不请求上下文或显示编辑控件。

变量通过 `event.detail.context.variables` 公开给目标页面，不承担授权或身份隔离，不能填写密码、Cookie、
Token、Proxy 凭据或其他秘密；敏感变量由 API 拒绝。设置变量不会授予 Profile 访问权限。
保存只对该用户以后创建的新 Session 生效，已有 Session 使用创建时的不可变快照。
JSON 必须为对象，序列化后最多 32 KiB、最多 8 层；空对象 `{}` 用于清空变量。
编辑器保留 JSON 排版，大小校验以序列化后的 UTF-8 字节数为准，不以展示字符数截断有效变量。

尚未选用户时显示空态；读取失败提供重试，保存失败保留用户选择和完整草稿，并展示固定错误码与请求 ID。
快速切换用户会中止旧请求，并核对响应所属目标，避免旧数据覆盖新用户。
保存期间禁止换用户和重复提交；草稿未保存时，切换用户、重新读取或离页提示放弃修改。
清空按钮只将草稿改为 `{}`，需要显式保存。保存成功显示更新时间和新 Session 生效说明。

## 存储额度与磁盘保护

Worker 列表和详情、Profile 管理列表和编辑展示当前用量、期望额度、已应用额度与版本、待应用状态。
Worker 详情同时展示 Profile 与临时文件所在卷的可用/总空间、实际 LOW/CRITICAL 阈值和 Worker 环境配置；
环境阈值只读，页面不提供虚假的在线修改入口。未就绪 Worker 的采样明确标为最后上报事实。
额度以整数字节提交，`null` 表示不限额，`0` 拒绝相关新增写入；空输入必须通过校验后才能保存。
Worker 额度编辑需要 `worker.manage`，Profile 额度随现有 Profile 编辑权限控制，读取沿用对应 read 权限。
保存失败保留草稿，请求中禁止重复提交；保存成功仍展示待应用与旧采样，等待 Worker 确认新版本。

Profile 软额度只统计持久 Chrome 用户目录；Worker 软额度覆盖业务 Profile、临时上传、下载 spool 与保留文件，
不包含身份、发布目录和日志；重叠根目录由 Worker 去重，Portal 不自行计算磁盘用量。
软额度只影响相关新增操作，不截断 Chrome 文件，不主动中断现有 Session。
LOW 停止新 Runtime、Session 和导入，CRITICAL 额外停止新上传和下载。
工作区、维护入口和 Viewer 展示 Backend 返回的存储拒绝原因、待应用状态和恢复指引；
新增入口依据服务端状态禁用，已有 Session 的继续、关闭、媒体控制不因配额通知而改变。
管理总览直接展示 Backend 全量聚合的 LOW、CRITICAL、额度受限与未知数量，不累加列表当前页。

## Do's and Don'ts

**Do**

- 在操作前展示资源当前状态和真实影响。
- 使用空状态解释下一步，而不是只显示“暂无数据”。
- 对实时状态显示最后更新时间，区分离线与未知。
- 将高级配置折叠，但保留可发现入口。
- 用骨架屏保持布局稳定，用局部加载避免整页闪烁。

**Don't**

- 不用玻璃拟态覆盖大面积正文或数据表。
- 不用纯装饰动画干扰 Viewer和运维页面。
- 不把成功 Toast当作唯一反馈；资源状态必须实际更新。
- 不让隐藏菜单承担关键生命周期操作。
- 不显示未经脱敏的页面 URL、Cookie、剪贴板或文件内容。

## 管理员诊断包

系统设置中提供独立诊断区域，只有同时具备 `system.manage`、`worker.read`、`profile.read`、
`audit.read` 的用户可生成；其余系统管理员看到所缺读取权限的说明。可留空生成系统快照，或输入
完整 Session UUID。页面说明包含的内部 ID、版本、时间和审计关联，以及不收集页面/凭据/原始日志
的边界。生成不触发 Chrome 探测或业务操作。

请求期间锁定重复提交；失败显示固定错误及请求 ID，可重试。成功显示实际采样完成时间、各类条数、
截断提示及可展开的 JSON 预览，另有明确下载按钮。修改范围或重新生成时清除旧结果；页面离开时取消
在途请求。中文/英文、窄屏和键盘操作沿用全局样式与交互约定。

## Profile 启动与维护入口

Profile 创建和编辑表单将 HTTPS 启动检查地址作为必填字段，提交前就地说明缺项。
地址可使用业务首页，不暗示必须提供 `/health` 端点；既有 API 仍允许保存未完成配置，
启动前仍由 Backend 检查，清单的禁用启动按钮提示先编辑配置。
管理清单的操作列只显示随状态切换的“启动/停止”和“更多”；编辑、授权、启用/禁用、
停止并结束全部会话以及删除放入下拉菜单，保留原权限、忙碌锁和破坏性确认。
维护弹窗首次读取 Profile 后预填启动检查地址，允许改为其他合法起始网址；
用户已输入或清空的地址不被状态刷新或延迟响应覆盖。

Viewer 的沉浸模式由 Remote Tab 提供，Portal 跟随 `immersive-change` 收起顶部导航、
普通状态栏和页脚，保留必须处理的错误、存储限制与会话到期提示。
切换只改变布局，不重新创建 Viewer 或媒体连接；Remote Tab 提供持续可达的退出按钮。


## Profile 详情与管理清单

管理清单默认显示名称、状态、Worker、Session 容量和操作。名称链接打开
`/admin/profiles/:profileId/maintenance` 的详情页；名称下方只保留简短备注。操作列固定在右侧，
继续使用启动或停止及更多菜单。列选择提供运行线路、分组、运行与可见性、存储和更新时间等
可选字段；名称和操作不可隐藏，选择作为浏览器本地展示偏好保存，可恢复默认。筛选下方只保留
一个状态通知与刷新区域，不再增加独立的重复刷新行。

Profile 详情页顶部集中名称、备注、状态、Worker、容量和与清单相同的管理操作；更多信息可展开
启动地址、分组、可见性、运行线路及存储。维护、Page Script 和导航策略使用带地址的标签导航，
支持浏览器前进后退、直接链接与键盘访问。原有 Page Script 和导航策略地址保留，作为同一详情页
的标签。脚本和导航编辑复用原编辑器，切换标签或离页时继续保护未保存草稿。维护内容要求
`profile.maintain`；无权限时解释所需权限。管理操作沿用 `profile.manage` 和服务端校验。
从详情维护打开的 Viewer 返回同一个 Profile 的维护标签，不丢失资源上下文。

## Proxy URL 快速填写

创建 Proxy 时可粘贴 `protocol://user:password@host:port`，支持 HTTP、HTTPS、SOCKS5 和方括号
IPv6，要求显式端口；用户名与密码按 URL 百分号编码解码一次。点击填入后更新既有分项表单，
由用户检查后保存，保留原认证及端点校验。地址输入默认遮蔽，解析只在浏览器内存完成，填入成功
或关闭后清空，不写入 URL、浏览器存储或日志。非法地址显示固定提示，不能覆盖已填写字段。
