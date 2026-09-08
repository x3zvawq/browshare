# BrowShare agent guide

为当前需求交付最小完整修改：先理解真实调用链和现有约定，再完成实现、必要文档和有目的的验证。

## 项目与职责

BrowShare 是单租户、自托管的共享浏览器工作区。Profile 是固定归属一台 Worker 的持久 Chrome `user-data-dir`；一个 Profile 同时最多运行一只 Chrome，用户独占其中的主 Tab Session。同 Profile 的 Tab 共享登录态和浏览器数据，不构成账号或隐私隔离，也不承诺规避第三方风控。

- 本仓库拥有 Portal、Control Backend、Worker、PostgreSQL 模型、授权、策略和 Chrome/Profile 生命周期。
- `browshare-tab-remote` 拥有 Tab 捕获、WebRTC、CDP 输入、Viewer、信令和嵌入接口。Worker 复用 Remote Tab Core，不复制其源码或另建媒体协议。
- `tmp/` 是未追踪的研究、POC 和本地验证材料；可供调查，不能充当正式接口或可公开获取的发布证据。

## 按任务读取

- [README](README.md) 提供运行入口，[PROGRESS.md](PROGRESS.md) 记录交付状态；只读与当前任务有关的条目及证据。
- [系统架构](docs/design/02-architecture.md)、[领域模型](docs/design/03-domain-model.md) 解释职责和状态；[设计文档索引](docs/README.md) 指向各专题。
- UI 任务读取 [页面设计](docs/DESIGN.md)；协议任务读取 [接口与协议](docs/design/07-protocols.md) 并核对实际 schema 和调用方。
- 设计描述目标契约，代码和测试说明当前行为，进度记录已完成的交付；发现差异时明确指出，并在当前任务范围内同步。不要把阶段计划当作当前停工指令，或把历史测试记录当作本次验证。
- 只在变更跨越公共边界时读取、修改相邻仓库；仓库位置以实际工作区为准，不假定所有 checkout 都有同级副本。

## 工程约束

- TypeScript、pnpm workspace；Portal 使用 Vue 3 Composition API、`<script setup>`、Vite、Naive UI、Pinia 和 Vue I18n；Backend 使用 Fastify、Drizzle 和 PostgreSQL。
- Portal 业务接口使用版本化 REST JSON，状态推送使用 SSE；Worker 控制链路使用 WSS、mTLS、标准 MessagePack 和 TypeBox，不使用 gRPC 或 Protobuf。
- 网络消息经过运行时校验；TypeScript 类型不是信任边界。数据库 migration 生成可审查 SQL，不在生产执行 ORM 自动同步。外部可见 ID 使用 UUIDv7，数据库时间使用 UTC。
- Worker 和 Backend 断线重连后通过真实状态快照对账。Profile Proxy 故障 fail-closed，不回落 Direct。Page Script 是体验层，不承担授权或安全边界。
- 日志不记录密码、Cookie、代理密码、页面正文、剪贴板、文件内容或敏感完整 URL。
- 正式运行时称为“Google Chrome Stable”或“Chrome”；仅讨论上游内核时使用“Chromium”。不重新引入 Xpra、KasmVNC、临时 Profile 克隆、Golden Profile 或 ProfileVersion。

## 协作与完成条件

- 用户提出修改或修复即推进任务，不停在计划或能力说明。沿用已有授权；低风险歧义说明合理假设后继续，关键约束缺失且会改变实现时才询问，并先完成不依赖答案的工作。
- 用户补充要求时保留原目标和已完成工作，按新约束继续。只有明确取消或替换任务才放弃原目标。
- 当前用户要求优先于本文件及 Skill 中的一般建议，同时遵守更高优先级规则。若某条指令确实导致暂停，引用具体文件和原文，说明阻塞动作与缺失信息，不把自己的谨慎判断说成强制审批。
- 保留用户已有修改；不删除或覆盖未提交文件，不提交 `tmp/` 或凭据。发布、部署、破坏性操作按当前授权范围执行；需要批准时，先准备可审查的结果。
- 复用现有实现，只处理真实可达问题。公共协议、领域状态、数据库格式和扩展 ID 的变化，在同一修改中同步相关设计、调用方和必要测试；保留现有兼容与迁移要求，不额外搭建假设性的双轨、fallback 或扩展点。
- 按 [测试与验收](docs/design/09-testing-and-acceptance.md) 选择能发现本次失败的最小验证。相关检查通过且无未解决问题后完成交付；发布 Gate 不因局部验证通过而豁免。
- 简短说明改了什么、为什么、影响范围、实际执行的验证和真实限制。未运行或受阻的检查如实标明，不虚构成功，不重复无新依据的 review/validate 循环。
