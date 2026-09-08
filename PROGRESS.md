# BrowShare 实现与验收进度

## 产品设计与工程基础

- [x] 产品范围、非目标和共享 Profile 数据边界
- [x] Portal、Control Backend、Worker 与 Remote Tab 职责划分
- [x] 领域模型、状态机、权限、策略优先级和数据关系
- [x] REST、SSE、Worker WSS + MessagePack 与 Viewer 协议边界
- [x] All-in-one、Distributed、Proxy 和运维设计
- [x] Portal 页面设计规范、独立品牌图标和中英文术语
- [x] MIT 许可证、README、Agent 指南、贡献指南和安全策略
- [x] 首版验收标准、实施阶段和明确延后路线
- [x] pnpm workspace、Node.js 版本、统一脚本和严格 TypeScript
- [x] Portal、Backend、Worker、共享 contracts 和配置包目录
- [x] ESLint、格式化、类型检查和构建约定
- [x] 环境变量 schema、Secret 文件读取和 fail-fast 启动
- [x] UUIDv7、UTC 时间、分页、错误包络和日志公共工具
- [x] OpenAPI 生成、Portal 类型化 Client 和版本兼容约定
- [x] 开发环境 Compose、PostgreSQL 和本地 HTTPS/WSS 入口

## 数据库与迁移

- [x] 显式 migration runner、迁移历史和从空库初始化
- [x] User、AuthSession、Role、Permission、UserRole、RolePermission
- [x] Worker、WorkerCredential、WorkerEnrollment 和 Worker 状态
- [x] Profile、ProfileGroup 及三张多对多授权关联表
- [x] Proxy 及 Profile 引用约束
- [x] TabSession、Reservation 和 SessionEvent
- [x] SessionPolicy 及 User+Profile、User+Group、全局作用域
- [x] PageScriptVersion、NavigationPolicyVersion 和发布指针
- [x] UserProfileContext 管理员变量
- [x] AuditEvent 与 SystemSetting
- [x] 软删除、最后管理员、引用删除和唯一性数据库约束
- [x] 备份、恢复和 migration 升级路径实测

## Control Backend 公共服务

- [x] Fastify 启动、插件边界、依赖注入和优雅关闭
- [x] `/health/live`、`/health/ready` 和版本信息
- [x] 统一认证、Permission 授权和资源级可见性过滤
- [x] 统一分页、过滤、排序、错误响应和请求 ID
- [x] SSE 建链、重连读取快照和用户级权限过滤
- [x] 结构化日志、敏感字段清除、审计写入和指标

## 身份、权限与账户

- [x] 环境变量管理员、首次启动向导与一次性 bootstrap 初始化
- [x] 邮箱与密码注册开关
- [x] Argon2id 密码登录和统一失败响应
- [x] 14 天滑动 AuthSession、Cookie 安全属性和主动登出
- [x] 密码修改、管理员重置和所有会话撤销
- [x] 用户列表、搜索、详情、创建、编辑和软删除 API
- [x] 用户启用、禁用和最后管理员保护
- [x] 用户最大活动 Session 与开放注册默认限制
- [x] 预置角色、Permission 查询和 UserRole 分配
- [x] 为未来 RBAC 保留的数据模型，不把角色写死进业务判断
- [x] Portal 登录、注册和公开注册开关体验
- [x] Portal 主动退出、路由守卫和会话失效体验
- [x] Portal 改密、登录设备列表与单个/全部撤销体验

## Worker 控制与 Chrome 运行时

- [x] 一次性 Enrollment Token 创建、展示、过期和撤销
- [x] Worker 首次注册、mTLS 证书签发和稳定身份
- [x] WSS + mTLS + MessagePack 建链和 TypeBox 校验
- [x] Hello、版本、Capability Probe 和 Runtime 能力上报
- [x] 心跳、CPU、内存、磁盘、Chrome、Tab 和网络指标
- [x] 命令 messageId 幂等、超时、重试和结果关联
- [x] 快照对账、Backend 重启和 Worker 重连
- [x] ONLINE、DRAINING、OFFLINE、DISABLED 状态转换
- [x] Worker 并发上限和管理员手动调度信息
- [x] Worker 禁用、凭据轮换和安全退役
- [x] Worker 配置、daemon 生命周期和优雅关闭
- [x] 官方无桌面 Google Chrome Stable 固定版本镜像
- [x] 固定版本签名 Extension 与 Managed Policy
- [x] loopback Core、Extension 和 Chrome 网络隔离
- [x] 启动时 Chrome、Extension、CDP、tabCapture 与 WebRTC Probe
- [x] Profile 持久卷、目录所有权、运行锁和跨容器持久化
- [x] Profile 磁盘配额、阈值保护和写入限制
- [x] Remote Tab Core 协调打包、嵌入与受管节点冷启动
- [x] 共享 Core 管理器与独立 Session 句柄、授权及业务生命周期管理
- [x] Worker 普通/维护 Session 类型、Profile 独占与后代窗口清理实测
- [x] Session 上传/下载临时目录和剪贴板数据生命周期
- [x] Worker SIGKILL 的 Chrome 进程组清理、持锁保护与原目录重启
- [x] 孤儿 Tab、孤儿 Chrome、临时文件和租约重启对账
- [x] Docker 健康检查、资源限制和宿主依赖诊断

## Proxy 与网络出口

- [x] DIRECT、HTTP、HTTPS 和 SOCKS5 Proxy CRUD
- [x] 用户名与密码明文存储、列表显示和眼睛切换口径
- [x] Proxy 引用保护和完整凭据 Permission
- [x] Worker loopback Proxy Adapter
- [x] Chrome Profile 网站流量强制使用本地 Adapter
- [x] 健康探测、状态、最后成功时间和错误摘要
- [x] 强制 Proxy 故障 fail-closed，绝不回落 Direct
- [x] Proxy 更新后的 Profile Runtime 生效和重启提示

## Profile、分组与维护

- [x] Profile 列表、搜索、过滤、状态和容量摘要 API
- [x] Profile 创建、编辑、禁用、启用和受控删除
- [x] Worker 固定归属和 Proxy 绑定
- [x] `ALWAYS_ON`、`ON_DEMAND`、`MANUAL` 三种运行模式
- [x] Worker 受管 Chrome 启停、全新扩展就绪、进程退出和内存事实
- [x] Profile Runtime 命令传输、ACK/结果重放、generation 与 Worker 实例校验
- [x] Profile Runtime 错误恢复和 Backend 持久状态上报
- [x] Backend 维护预约、普通会话排空、独占释放与维护权限链路
- [x] 独占维护模式、维护者 Viewer 和 `MAINTAINING` 卡片状态
- [x] 维护附属窗口的 Viewer 切换、交互与多窗口登录实测
- [x] Profile 最大普通 Session、音频和画质策略
- [x] ProfileGroup CRUD、启用状态和显式优先级
- [x] Profile 与 Group 多对多成员关系
- [x] User 与 Profile 直接多对多授权
- [x] User 与 ProfileGroup 多对多授权
- [x] `ALL_ENABLED_USERS` 与 `RESTRICTED` 可见性
- [x] Profile 删除前结束 Session、停止 Runtime 和删除持久目录
- [x] Profile 维护后登录态持久化实测

## 回收策略、导航策略与 Page Script

- [x] 全局 SessionPolicy 编辑和发布
- [x] User + Profile 策略编辑和最高优先级命中
- [x] User + ProfileGroup 策略及 Group 冲突拒绝
- [x] Viewer 断线、无输入、无画面变化、最长时长和 Proxy 故障条件
- [x] 完全不主动回收模式
- [x] 创建时策略快照和 Server 时间倒计时
- [x] Navigation Policy 有序 URL 规则编辑、试算和发布
- [x] 可选受限 Navigation Policy Script
- [x] 强制 URL Policy 的 Tab 导航限制而非资源请求拦截
- [x] 单 Profile 单代码输入框的 Page Script 草稿编辑器
- [x] 固定 `browshare:*` 事件、MAIN world listener 和 event detail
- [x] Page Script 维护态测试、不可变版本、发布、禁用和回滚
- [x] 普通、维护等 Session 类型的脚本适用范围配置
- [x] UserProfileContext 管理员变量及敏感值拒绝
- [x] Session 创建时 Page Script 和 Navigation Policy 版本锁定
- [x] 结构化 Notice 从 Page Script 到 Viewer

## Session 预约、连接与生命周期

- [x] User、Profile、Worker 三级原子 Reservation
- [x] 明确的并发限制来源和不排队失败响应
- [x] Worker 幂等创建命令与超时释放 Reservation
- [x] ON_DEMAND Profile Runtime 启动和就绪等待
- [x] 单 Session 独占主 Tab 与 Remote Tab Core 绑定
- [x] Gateway 分配、单次 Viewer Ticket 和 Portal 启动参数
- [x] 10 分钟租约的无感刷新和 Worker 本地校验
- [x] READY、CONNECTED、SUSPENDED、DISCONNECTED 等状态同步
- [x] 5 分钟 Viewer 断线宽限和继续 Session
- [x] 接管确认、generation 提升和旧 Viewer 撤销
- [x] Session 重命名、远端标题和自定义名称优先级
- [x] 用户结束、管理员结束和策略回收
- [x] 禁用用户、Profile、授权或 Worker 后的撤销传播
- [x] Session 结束的 Tab、文件、额度和事件清理
- [x] 同一 Profile 多用户多 Tab 隔离实测

## Portal 页面与管理体验

- [x] Vue 3、Vite、Naive UI、Pinia 和 Vue I18n 工程
- [x] DESIGN.md token、主题、暗色模式和响应式布局
- [x] 左侧分组导航、顶栏、面包屑和权限驱动菜单
- [x] 全局 API 错误、加载骨架、空状态和确认对话框
- [x] Profile 管理页 SSE 实时刷新、鉴权失效、分页保留与离页清理
- [x] SSE 状态总线、断线提示和增量刷新
- [x] 个人菜单、会话安全信息和语言切换
- [x] 404、403、后端离线和版本不兼容页面
- [x] 工作区首页与获授权 Profile 卡片
- [x] Profile 分组、搜索、运行状态和剩余额度
- [x] 创建 Session、失败原因和启动进度
- [x] 我的 Sessions 列表、继续、重命名和结束
- [x] Viewer 页面与 Remote Tab Web Component 嵌入
- [x] Viewer 接管确认和现有连接信息
- [x] 回收倒计时与“继续使用”交互
- [x] Viewer 返回 Portal 后的 Session 状态同步
- [x] 管理仪表盘、Worker 健康、Session 和容量总览
- [x] 用户列表、创建、编辑、启禁、删除和权限配置
- [x] Profile 列表、创建、编辑、状态和运行控制
- [x] Profile 维护入口和维护中独占状态
- [x] ProfileGroup、成员和用户授权矩阵
- [x] Worker 列表、注册向导、详情、指标和运行控制
- [x] Proxy 列表、创建、编辑、删除、独立凭据权限与中英文响应式页面
- [x] Proxy 健康探测操作、出口测试与运行时健康状态刷新
- [x] SessionPolicy 分层编辑、命中预览和冲突反馈
- [x] Navigation Policy 规则与 Script 编辑、测试和发布
- [x] Page Script 代码编辑、版本、测试、发布和回滚
- [x] 活动 Session 查看、诊断和强制结束
- [x] 审计日志筛选、详情和敏感字段边界
- [x] 系统设置、开放注册、邮箱验证预留和默认限制

## 文件、剪贴板与 Viewer 媒体配置

- [x] 上传数量、大小、类型和临时总量的策略下发
- [x] 下载领取、保留期、超时和 Session 归属
- [x] Session 结束后的未领取文件清理
- [x] 文本与图片剪贴板 Capability 和策略
- [x] 新窗口 URL 的 Viewer 本机打开流程
- [x] Viewer 失焦暂停默认值和全局/Profile 配置
- [x] 画质、FPS、码率和音频的全局/Profile 上限
- [x] Viewer 与 Portal 业务 UI 的职责隔离

## 审计、可观测性与数据运维

- [x] 用户、权限、Profile、Worker、Proxy、策略和 Session 审计事件
- [x] 页面正文、Cookie、密码、剪贴板、文件和敏感 URL 日志清除
- [x] Backend 请求、Session 审计与 Worker 命令的精确 ID 关联
- [x] Gateway、Chrome 和 Remote Tab 跨组件诊断关联
- [x] Backend、Worker、Gateway 基础 Prometheus 指标、健康检查和结构化日志
- [x] 命令、Session、WebRTC 和 Proxy 业务指标与跨组件聚合
- [x] Worker 磁盘软阈值、硬阈值和新建拒绝
- [x] Profile 冷备份、恢复和一致性检查
- [x] PostgreSQL 备份、恢复与保留策略
- [x] 管理员诊断包和隐私安全边界

## 部署、升级与发布

- [x] All-in-one Compose（含 Worker 与 TURN）
- [x] Distributed Backend、Portal、Gateway、TURN 和多 Worker 部署
- [x] 同域 Viewer 路由、Gateway 公网 URL 和 TLS 配置
- [x] 自签 CA、Worker mTLS 和 Extension 强制安装辅助脚本
- [x] 环境变量、Secret、反向代理和防火墙文档
- [x] 控制面、Worker 和 Chrome 数据卷升级流程
- [x] CI 工作流定义与本地候选构建工具
- [x] 五类 OCI 候选镜像、SBOM、校验和及 BuildKit 来源记录
- [x] 实际仓库身份、固定提交与托管 CI 验收
- [x] 公开源码从空项目部署、候选替换、成套备份和新卷恢复演练
- [x] MIT 候选源码、Release notes、兼容性表和安全公告流程

## 使用体验优化

- [ ] Profile 必填启动地址、紧凑操作菜单与维护网址预填的真实页面验证
- [ ] Portal 沉浸模式联动与真实 Session 媒体输入验证
- [ ] Worker Maple Mono CN 默认字体与中文渲染的正式镜像验证
