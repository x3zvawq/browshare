# BrowShare

BrowShare 是一个开源、自托管、单租户的共享浏览器工作区平台。管理员维护持久 Google Chrome Profile，获授权的用户通过网页使用各自独占的远端 Tab。

源码仓库：[x3zvawq/browshare](https://github.com/x3zvawq/browshare)；配套引擎：[x3zvawq/browshare-remote-tab](https://github.com/x3zvawq/browshare-remote-tab)。当前版本为未发布候选；源码提交不等于正式发行，托管验证结果以对应提交的 CI 记录为准。

> [!IMPORTANT]
> 当前为 `0.1.0` 未发布候选，Portal、Control Backend、Worker 与主要业务链路已实现并在测试环境部署验收，正在完成发行准备与独立部署演练。尚无公开发行或托管 CI 通过的声明。交付状态以 [`PROGRESS.md`](PROGRESS.md) 为准；
> `tmp/`只保存未被 Git 追踪的研究材料、测试脚本和 POC，不代表产品接口。

![BrowShare icon](docs/assets/browshare-icon.png)

## 产品边界

- 一个 Profile 是一份持久 Chrome `user-data-dir`，固定归属一台 Worker。
- 一个 Profile 同时最多运行一只 Chrome，并可承载多个用户 Tab Session。
- 同一 Profile中的 Tab共享站点登录态和浏览器侧数据；Tab Session不是安全隔离容器。
- BrowShare不承诺规避目标网站风控、模拟单人使用或绕过第三方服务条款。
- 产品只提供 Web Portal；网页画面和输入由独立的 `browshare-tab-remote` 项目承载。

## 系统轮廓

```mermaid
flowchart LR
    user[用户浏览器] --> portal[Portal]
    portal --> backend[Control Backend]
    backend --> db[(PostgreSQL)]
    worker[Worker] -->|WSS + mTLS + MessagePack| backend
    worker --> chrome[Google Chrome Stable]
    chrome --> extension[Remote Tab Extension]
    extension -->|loopback| core[Remote Tab Core]
    core --> signal[Signaling Gateway]
    user --> signal
    extension == WebRTC / TURN ==> user
```

## 阅读文档

- [持续实现进度](PROGRESS.md)
- [部署入口](deploy/docker/README.md)、[发行准备](docs/RELEASING.md)
- [版本说明](CHANGELOG.md)、[固定兼容性](deploy/compatibility.json)、[安全报告与公告](docs/SECURITY.md)
- [Agent背景与工程约束](AGENTS.md)
- [页面设计规范](docs/DESIGN.md)
- [产品需求](docs/design/01-product.md)
- [系统架构](docs/design/02-architecture.md)
- [领域模型](docs/design/03-domain-model.md)
- [身份、授权与策略](docs/design/04-auth-and-policy.md)
- [Session与Viewer](docs/design/05-session-and-viewer.md)
- [Worker与Chrome Runtime](docs/design/06-worker-runtime.md)
- [接口与协议](docs/design/07-protocols.md)
- [部署与运维](docs/design/08-deployment-and-operations.md)
- [测试与验收](docs/design/09-testing-and-acceptance.md)
- [下载保留与领取](docs/design/11-download-retention.md)
- [实施计划](docs/design/10-implementation-plan.md)

## 相关项目

`browshare-tab-remote` 是独立开源的网页远程控制引擎。BrowShare通过 Worker嵌入其 Core，并复用它的扩展、Viewer、信令服务和协议。

## 开发 Backend 身份链路

先创建PostgreSQL数据库、执行显式migration，并生成只用于 Worker客户端证书的自签 CA：

```bash
pnpm install
DATABASE_URL=postgresql://browshare:password@127.0.0.1:5432/browshare \
  pnpm database:migrate
pnpm worker-ca:generate --output ./tmp/dev-worker-ca
pnpm worker-control-tls:generate --output ./tmp/dev-control-tls
```

CA工具要求本机提供OpenSSL，且在目标文件已存在时拒绝覆盖。生产环境应把 CA私钥放入只读
Secret，只授予 Backend读取权限；它不是 HTTPS服务器证书。

首次启动可以通过环境变量幂等创建首位管理员：

```bash
DATABASE_URL=postgresql://browshare:password@127.0.0.1:5432/browshare \
BROWSHARE_SESSION_SECRET=replace-with-at-least-32-random-characters \
BROWSHARE_COOKIE_SECURE=false \
BROWSHARE_WORKER_CONTROL_URL=wss://localhost:3443/api/v1/worker-control \
BROWSHARE_WORKER_CONTROL_TLS_CERTIFICATE_FILE=./tmp/dev-control-tls/control-tls-certificate.pem \
BROWSHARE_WORKER_CONTROL_TLS_PRIVATE_KEY_FILE=./tmp/dev-control-tls/control-tls-private-key.pem \
BROWSHARE_WORKER_CA_CERTIFICATE_FILE=./tmp/dev-worker-ca/worker-ca-certificate.pem \
BROWSHARE_WORKER_CA_PRIVATE_KEY_FILE=./tmp/dev-worker-ca/worker-ca-private-key.pem \
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD=replace-with-at-least-10-characters \
  pnpm dev:backend
```

`BROWSHARE_COOKIE_SECURE=false`只适用于本机HTTP开发；生产HTTPS必须保持默认值`true`。初始化
完成后，后续启动中的`BOOTSTRAP_ADMIN_*`不会覆盖数据库用户。Backend会拒绝在migration缺失、
落后或与当前发行不一致时启动。

本机开发时另开一个终端启动Portal；Vite会把`/api`、`/health`和`/documentation`代理到
`http://127.0.0.1:3400`：

```bash
pnpm dev:portal
```

访问`http://127.0.0.1:5173/login`。登录后可在“账户与安全”页面修改密码、查看登录设备和撤销
Portal Session。拥有`worker.read`权限的账户可以查看 Worker Enrollment；拥有`worker.manage`权限的
账户可以创建短期一次性 Token并撤销尚未使用的 Token。拥有`profile.read`权限的账户可以使用
Profile管理清单，按名称、备注、业务状态、Runtime、Worker和分组筛选，并查看与筛选范围同步的
普通Session容量摘要。拥有`profile.manage`权限的账户还可以创建和编辑Profile、启用或禁用Profile，
以及在精确输入名称后请求两阶段删除；Profile归属Worker在创建后不可修改，删除请求不会在Backend
中伪造Worker目录已清理。控制面JSON请求使用严格Schema，未知字段会返回400；Portal API请求默认
15秒超时，网络恢复后保留表单即可直接重试。公开注册默认关闭，管理员可以在系统设置中配置注册策略。

将管理员刚创建的 Token保存到权限为`0600`的临时Secret文件后，可以首次注册 Worker：

```bash
BROWSHARE_WORKER_NAME=local-worker \
BROWSHARE_BACKEND_URL=http://127.0.0.1:3400 \
BROWSHARE_WORKER_IDENTITY_DIRECTORY=./tmp/dev-worker-identity \
BROWSHARE_WORKER_ENROLLMENT_TOKEN_FILE=/absolute/path/to/enrollment-token \
BROWSHARE_WORKER_CONTROL_SERVER_CA_CERTIFICATE_FILE=./tmp/dev-control-tls/control-tls-ca-certificate.pem \
  pnpm dev:worker
```

本机HTTP只允许loopback开发地址；远端Backend必须使用HTTPS。注册成功后，Worker在身份目录中以
`0600`保存本地私钥、稳定 Worker ID、客户端证书和 CA证书，之后启动不再读取 Enrollment Token。
应立即删除 Token Secret并持续挂载身份目录；丢失身份目录必须重新注册，不能用相同名称接管旧节点。

Worker注册后会直接用节点证书连接独立的`wss://localhost:3443/api/v1/worker-control`监听器。
该监听器与Portal/API HTTP监听器分离，强制双向TLS和二进制MessagePack；开发证书工具生成的TLS
CA只用于本机信任，生产应改用与公开控制域名匹配的正式服务器证书。

拥有`worker.manage`权限的管理员可调用`POST /api/v1/workers/{workerId}/diagnostics/probe`重新运行
完整节点Probe。Backend对命令使用稳定`messageId`、ACK重试和最终结果超时；控制连接中断后会在
Worker重新完成握手时继续同一命令，Worker用有界幂等缓存避免重复执行。诊断成功会同时更新数据库
报告和当前控制连接的可调度状态，因此启动时依赖尚未就绪的节点可以在依赖恢复后无重启转为
`ONLINE`。

管理员通过`PUT /api/v1/workers/{workerId}/state`提交`ACTIVE`、`DRAINING`或`DISABLED`意图，
`GET /api/v1/workers/{workerId}/state`读取实际五态以及控制连接是否在线、是否完全就绪。
`DRAINING`保留控制连接和诊断能力但不允许后续调度新Session；`DISABLED`立即断开控制连接并拒绝
节点认证。运行中的Worker会继续退避重连，重新设为`ACTIVE`后可无重启完成Probe、Snapshot并恢复
`ONLINE`。默认连续30秒没有有效心跳时，Backend关闭失活socket并将`ONLINE`转为`OFFLINE`；可用
`BROWSHARE_WORKER_OFFLINE_AFTER_MS`调整，但必须至少为心跳间隔的两倍。

`GET /api/v1/workers`和`GET /api/v1/workers/{workerId}`向管理员同时展示节点身份、版本、Capability
Probe、最新心跳指标、数据库活动Tab占用和实时控制连接。`PATCH /api/v1/workers/{workerId}`配置
`maxActiveTabs`；默认4，设为`null`表示不限制，设为0表示停止接纳新Tab但不结束现有Session。响应
将容量明确区分为`AVAILABLE`、`FULL`、`OVER_LIMIT`或`UNLIMITED`，并给出节点级不可调度原因。
CPU、内存、磁盘和Worker自报Session数只帮助管理员决策，不会自动修改并发上限；数据库非终态
Tab Session数量才是容量占用的权威值。

节点证书不需要通过重新Enrollment轮换。管理员为在线Worker创建短期一次性Rotation Token，把明文
保存到权限为`0600`的临时Secret文件，并只在下一次Worker启动时设置：

```bash
BROWSHARE_WORKER_CREDENTIAL_ROTATION_TOKEN_FILE=/run/secrets/worker_credential_rotation_token \
  pnpm dev:worker
```

Worker使用已有身份绑定本次轮换，在节点本地生成新的P-256私钥，原子替换身份文件，并用新证书完成
控制通道Hello。Backend只在观察到新Credential实际连接后撤销旧Credential；安装或落盘失败时旧证书
仍可恢复。成功后删除Rotation Token Secret，同一Token摘要已写入身份文件，即使环境变量误留也不会
重复消费。管理员还可以查看、撤销冗余Credential或未消费Token；未禁用Worker的最后一个有效
Credential不能手动撤销。

`DISABLED`是可恢复的管理状态，只会立即断开并拒绝节点连接，不自动销毁Credential。永久退役要求
Worker已禁用、没有Profile归属和非终态Tab Session，并提交精确节点名称确认；退役会在同一事务中
撤销剩余Credential和未消费Rotation Token并软删除节点。

## Proxy配置管理

具有`proxy.read`权限的用户可在`/admin/proxies`查看和筛选DIRECT、HTTP、HTTPS和SOCKS5配置；
`proxy.manage`允许创建、编辑和删除，`proxy.credential.read`独立控制完整凭据读取。列表默认
遮盖凭据，使用眼睛按钮显式显示。无读取权限的管理者可保留、替换或明确清除已有凭据。
Profile表单可以选择Proxy或Direct，尚被Profile引用的Proxy无法删除。配置保存后健康状态
为未知，真实出口探测和Chrome运行时接入仍在实现中。

Worker的loopback Proxy Adapter模块已通过Linux真实Chrome四种出口与IPv6链路测试，
健康检查经相同Adapter访问HTTPS目标。配置校验要求HTTP用户名不含冒号；SOCKS5凭据
同时填写或清空，每项最多255个UTF-8字节；健康地址仅接受不带认证信息的HTTPS URL。
连接取消和IPv6的上游依赖补丁固定于[`patches/`](patches/README.md)。Runtime控制命令、
周期健康上报与Proxy更新生效仍需继续接入，详见[`PROGRESS.md`](PROGRESS.md)。

## 构建Worker镜像

当前Worker镜像内置协调的Remote Tab Core/Protocol，固定`linux/amd64`、Node.js和Google Chrome Stable版本，并附带不需要
`SYS_ADMIN`的Chrome专用seccomp profile。部署者使用`browshare-tab-remote`的签名工具生成固定版本
CRX，再以只读目录挂载给Worker；签名私钥不进入镜像或运行容器。Worker在Chrome启动前校验CRX3与
SHA-256、只在loopback提供更新服务，并原子生成本次Runtime的Managed Policy。

```bash
pnpm compatibility:check
pnpm worker:image:build
pnpm worker:image:verify
```

构建需要Docker Buildx和相邻的`browshare-tab-remote`源码；可用`BROWSHARE_REMOTE_TAB_SOURCE`指定其他位置。
Worker冷启动自行运行并清理能力探测Chrome，不依赖外部CDP进程。

真实验证必须在Linux Docker宿主上执行，它会用专用seccomp profile启动一只不带`--no-sandbox`的
headless Chrome并读取CDP。Google Chrome不是MIT软件；当前只提供本地构建Dockerfile，不发布包含
Chrome的公共镜像。版本固定方式、宿主要求和profile来源见
[`deploy/docker/README.md`](deploy/docker/README.md)。

协议`1.1`在每个Worker进程启动时生成新的`instanceId`。首次连接或控制通道重连均按
`Hello → Capability → Runtime Snapshot`完成握手；Snapshot携带递增sequence以及实际Profile
Runtime和Tab Session映射。在Backend确认快照并要求的孤儿清理全部收敛前，Worker不会进入
`ONLINE`、启动心跳或接收普通命令。Backend重启不会要求Worker进程或Chrome随之重启。

Worker镜像安装协调版本的`@browshare/remote-tab-core`和`@browshare/remote-tab-protocol`后，设置
`BROWSHARE_REMOTE_TAB_ENABLED=true`并提供CDP endpoint、固定Extension ID、CRX SHA-256、Runtime
Secret和Runtime Generation。Worker先启动Extension loopback和本机更新服务，再写入Managed
Policy，之后才允许同一容器启动受管Chrome；启动Probe会
创建一个临时Tab，验证CDP、固定Extension、无人值守`tabCapture`和WebRTC publisher，随后停止媒体
并关闭该Tab。只有Probe与Backend控制通道都就绪时`/health/ready`才返回`200`。完整变量见
[`apps/worker/.env.example`](apps/worker/.env.example)。

## 许可证

[MIT](LICENSE)
