# Implementation plan

## 如何使用本计划

阶段描述依赖关系和完成条件，当前交付状态以 [PROGRESS.md](../../PROGRESS.md) 及其实现证据为准。已完成阶段不重新作为每项任务的前置工作。接续开发时定位当前未完成的纵向切片，复用已有代码，并只补齐与需求有关的缺口。

BrowShare 的控制面与 Worker 集成验收由本仓库负责；Remote Tab 的媒体引擎和公共 API Gate 由其拥有仓库负责。Remote Tab 的既有 Gate 证据不能替代 BrowShare 的授权、租约和断线对账验证，也无需为纯文档修改重跑引擎 Gate。

## 实施原则

先证明高风险架构，再建立业务面。每个阶段都必须产出可验证的纵向切片，不以目录、接口空壳或Mock演示冒充完成。

现有POC和部署实验保存在未追踪的`tmp/reference/`，只作为事实参考。正式代码不从POC目录原地改造。

## Phase 0：设计基线

交付：

- 两个仓库的README、MIT License、Agent约束、页面设计、安全和贡献文档。
- 按层排序的完整设计文档。
- BrowShare与Remote Tab独立图标。
- 可校验的DESIGN.md。

完成条件：文档链接有效、无真实凭据、架构术语一致，关键决策与当前需求一致。只有尚未明确且会改变实现的产品或架构决策需要用户确认；已确认的基线不重复审批。

## Phase 1：Remote Tab工程骨架

在`browshare-tab-remote`建立pnpm workspace和tsdown构建：

```text
packages/core
packages/protocol
packages/headless-client
packages/viewer
packages/extension
apps/signaling
apps/standalone
tools/extension-signing
examples/embed
```

先定义Session绑定、Viewer状态机、DataChannel消息、错误码和Capabilities。实现只覆盖POC已证明的单Tab链路，不提前添加BrowShare业务模型。

完成条件：本地单Tab、Viewer Web Component和Standalone示例可运行，协议单元测试通过。

## Phase 2：Gate 0

扩展Core和Extension以支持同一Chrome/Profile至少4个并Tab，并完成[测试与验收](09-testing-and-acceptance.md)中的Gate 0。

重点不是追求2C2G机器上的最高画质，而是证明Tab映射、输入、文件、生命周期和错误隔离成立。

完成条件：Gate 0证据归档，公共Remote Tab接口可以冻结并发布首个预览版本。

## Phase 3：BrowShare基础控制面

建立主仓库pnpm workspace：

- PostgreSQL schema和显式migration。
- Fastify Backend、统一配置和Bootstrap。
- Permission授权、用户和Portal Session。
- Vue Portal骨架、主题、i18n和OpenAPI Client。
- Worker Enrollment与WSS + MessagePack控制链路。

完成条件：管理员能初始化、登录、注册一个空Worker，并在Portal看到Probe和心跳状态。

## Phase 4：Profile纵向切片

实现：

- Worker容器和固定Google Chrome Stable。
- 签名Extension、Managed Policy和Capability Probe。
- Profile CRUD、持久卷、三种运行模式和维护模式。
- loopback Proxy Adapter和健康检查。
- Profile/User/Group多对多授权。

完成条件：管理员能从Portal创建Profile、进入维护、完成登录、停止并重新启动后保持登录态。

## Phase 5：用户Session纵向切片

实现：

- User、Profile、Worker三级原子Reservation。
- Backend调度和Worker幂等创建命令。
- Viewer Ticket、Gateway分配和Remote Tab嵌入。
- 我的Session、继续、重命名、接管和结束。
- 租约、SSE状态和断线对账。

完成条件：两个用户能在同一Profile中使用多个独立Tab，授权撤销和故障按设计收敛。

## Phase 6：策略与数据交互

实现：

- Navigation Policy、受限Script和本机打开。
- Page Script草稿、测试、发布、版本和事件。
- Notice。
- 文件上传、下载、剪贴板和清理。
- 回收策略和Viewer倒计时。

完成条件：策略优先级、脚本版本锁定、文件归属和清理通过集成测试。

## Phase 7：运维与发布

实现：

- Worker指标、磁盘保护、审计和诊断。
- Profile冷备份与恢复。
- All-in-one和Distributed Compose。
- Prometheus端点、健康检查和结构化日志。
- CI、镜像、SBOM、签名CRX和Release流程。

完成条件：从空机部署、升级、备份恢复和公开端口检查通过，发布文档可由第三方独立执行。

## 延后路线

以下需求不进入首个完整版本：

- Profile跨Worker复制、迁移和同步。
- ProfileVersion、Golden Profile和在线快照。
- 控制面多副本高可用。
- 对象存储和增量备份。
- 自定义角色UI。
- 邮箱验证、密码找回和MFA。
- Personal Access Token、Service Account和计费。
- 移动端完整兼容承诺。
- 本机麦克风到远端网页。

这些项目只有在出现真实需求时才重新设计，不提前放置无行为的开关或适配器。
