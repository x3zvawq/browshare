# Deployment and operations

## 部署选择

### All-in-one

适合首次部署、个人团队和功能验证。一台服务器运行Portal、Backend、PostgreSQL、Signaling Gateway、coturn和一个Worker。所有组件仍通过正式接口通信，后续可以拆分。

### Distributed

控制面：Portal、Backend和PostgreSQL；连接面：一个或多个Gateway和TURN；浏览器节点：一个或多个Worker。Worker 的控制与媒体连接主动出站；启用下载领取时，还须提供浏览器可达的独立 HTTPS 文件入口。
文件反向代理可通过私有网络访问 Worker，Worker 本身不必分配公网 IP；该路径不经过 Backend 或 Gateway。

Profile固定归属Worker。拆分部署不能自动把现有Profile移动到新节点。

当前控制面源码镜像、独立 migrator 和开发 HTTPS Compose 的运行入口见
[`deploy/docker/README.md`](../../deploy/docker/README.md#控制面与本地-https)。
该配置已覆盖空库和首次启动向导；叠加 All-in-one 配置可启动 Worker、TURN 和独立文件入口。
实际单机 Compose、独立节点与多 Worker、身份重启、TURN 中继媒体及文件领取已验收；
空机升级演练与多物理主机故障域仍单独跟踪。部署带有初始化向导的新 Portal 前，应先部署提供 `/api/v1/bootstrap`
的协调 Backend，不用前端静默忽略缺失接口。

## 公网入口

推荐简化域名：

```text
https://browshare.example.com/         Portal
https://browshare.example.com/api/     Backend REST
https://browshare.example.com/api/v1/.../events  Backend SSE
wss://browshare.example.com/signal/    Signaling Gateway
https://files.example.com/<worker-id>/claim  Worker 下载文件入口
turn.example.com:3478                  STUN/TURN UDP和TCP
turn.example.com:5349                  TURN TLS
```

扩展部署允许Portal、API和每个Gateway使用独立域名。公开endpoint从配置读取，不把域名写死进镜像。Portal和API默认同源；Viewer作为Web Component直接运行，不使用iframe。

| 端口              | 协议     | 暴露范围   | 用途                  |
| ----------------- | -------- | ---------- | --------------------- |
| 443               | TCP      | 公网       | Portal、API、SSE和WSS |
| 3478              | UDP/TCP  | 公网       | STUN/TURN             |
| 5349              | TCP      | 公网       | TURN over TLS         |
| Relay范围         | UDP      | 公网       | coturn媒体分配        |
| Worker控制TLS端口 | TCP | Worker可达 | WSS控制与mTLS文件授权元数据；默认配置使用3443/8445，按实际部署发布 |
| Worker文件HTTPS端口 | TCP | Viewer可达 | 每节点文件领取入口，字节直接由Worker返回 |
| PostgreSQL        | TCP      | 私有网络   | 只允许Backend         |
| Chrome CDP pipe / Worker私有CDP桥 | pipe / loopback WS | Worker本机 | 禁止公网 |

严格网络可使用独立IP上的TURN TLS 443。若与HTTPS共用同一IP和443，必须使用经过验证的L4 TLS路由方案，不能让普通HTTP反向代理假装支持TURN。

## 配置分层

### 部署级配置

通过环境变量或只读Secret文件提供：

| 配置                           | 作用                                        |
| ------------------------------ | ------------------------------------------- |
| `DATABASE_URL`                 | PostgreSQL连接，支持对应的`_FILE`           |
| `BROWSHARE_BACKEND_ALLOWED_ORIGINS` | Portal/API允许的精确origin，逗号分隔；不含路径 |
| `BROWSHARE_WORKER_CONTROL_URL` | 返回给已注册Worker的 WSS控制地址            |
| `BROWSHARE_WORKER_CONTROL_HOST` | 独立mTLS listener绑定地址，默认loopback      |
| `BROWSHARE_WORKER_CONTROL_PORT` | 独立mTLS listener端口，默认3443              |
| `BROWSHARE_WORKER_CONTROL_TLS_CERTIFICATE_FILE` | 控制listener的Server TLS证书       |
| `BROWSHARE_WORKER_CONTROL_TLS_PRIVATE_KEY_FILE` | 控制listener的Server TLS私钥       |
| `BROWSHARE_WORKER_HEARTBEAT_INTERVAL_MS` | Worker心跳间隔，默认10秒                 |
| `BROWSHARE_WORKER_OFFLINE_AFTER_MS` | 无有效心跳转`OFFLINE`的期限，默认30秒       |
| `BROWSHARE_WORKER_COMMAND_ACK_TIMEOUT_MS` | 命令ACK重试间隔，默认3秒            |
| `BROWSHARE_WORKER_COMMAND_RESULT_TIMEOUT_MS` | 命令最终结果期限，默认60秒       |
| `BROWSHARE_WORKER_COMMAND_MAX_ATTEMPTS` | 未收到ACK时的最大发送次数，默认3次   |
| `BROWSHARE_WORKER_CA_CERTIFICATE_FILE` | Worker客户端证书 CA证书文件       |
| `BROWSHARE_WORKER_CA_PRIVATE_KEY_FILE` | Worker客户端证书 CA私钥Secret      |
| `BROWSHARE_WORKER_CERTIFICATE_VALIDITY_DAYS` | 节点证书有效天数，默认90天    |
| `BOOTSTRAP_TOKEN`              | 首次交互式初始化，支持 `_FILE`；初始化后永久关闭入口 |
| `BOOTSTRAP_ADMIN_EMAIL`        | 环境变量幂等创建首位管理员                  |
| `BOOTSTRAP_ADMIN_DISPLAY_NAME` | 首位管理员展示名，可选                      |
| `BOOTSTRAP_ADMIN_PASSWORD`     | 仅首次使用，支持对应的`_FILE`               |
| `BROWSHARE_SESSION_SECRET`     | Portal Cookie签名和隐私摘要，支持对应的`_FILE` |
| `BROWSHARE_COOKIE_SECURE`      | 生产保持`true`；只在本机HTTP开发显式关闭    |
| `TLS_*`                        | 直接终止TLS时的证书配置                     |
| `TURN_SHARED_SECRET`           | 生成短期TURN凭据                            |

Secret不得写入镜像、Compose源码或Git。环境初始化值只在数据库未初始化时生效，后续启动不覆盖数据库。
Backend启动时读取migration历史并逐条核对数量、时间戳与SQL哈希；缺失、落后、超前或分叉都拒绝
启动。运行过程中数据库不可达时，liveness继续响应，readiness返回`503 not-ready`；数据库恢复后
无需重启即可恢复ready。

Worker CA与对外HTTPS证书是两套职责。用仓库工具生成初始 Worker CA：

```bash
pnpm worker-ca:generate --output /secure/browshare-worker-ca
```

工具生成P-256自签 CA、把私钥设为`0600`、证书设为`0644`，并拒绝覆盖已有文件。生产部署把私钥
作为只读Secret挂载给Backend，不能挂载给Portal、Worker、反向代理或PostgreSQL。CA证书需要随
数据库备份一并保存；CA私钥丢失不会泄露既有Worker身份，但会阻止签发和轮换新证书。CA私钥泄露
则需要撤销所有Worker Credential、替换CA并逐台重新Enrollment。

生产控制listener使用与`BROWSHARE_WORKER_CONTROL_URL`域名匹配的正式Server TLS证书。仅在本机开发
时，可以生成独立开发TLS CA和`localhost`证书：

```bash
pnpm worker-control-tls:generate --output ./tmp/dev-control-tls
```

开发Worker通过`BROWSHARE_WORKER_CONTROL_SERVER_CA_CERTIFICATE_FILE`信任该开发CA。生产若使用
公开受信CA签发的Server证书则不设置此变量；不得关闭`rejectUnauthorized`或复用Worker客户端CA
来替代Server TLS信任。

Worker首次启动配置：

| 配置 | 作用 |
| ---- | ---- |
| `BROWSHARE_WORKER_NAME` | 首次注册使用的唯一节点名称 |
| `BROWSHARE_BACKEND_URL` | HTTPS Backend origin；仅loopback开发允许HTTP |
| `BROWSHARE_WORKER_IDENTITY_DIRECTORY` | 必须持久挂载的节点身份目录 |
| `BROWSHARE_WORKER_ENROLLMENT_TOKEN_FILE` | 仅首次注册读取的一次性Token Secret |
| `BROWSHARE_WORKER_ENROLLMENT_TIMEOUT_MS` | 首次注册HTTP超时，默认15秒 |
| `BROWSHARE_WORKER_CREDENTIAL_ROTATION_TOKEN_FILE` | 仅轮换启动读取的一次性Token Secret |
| `BROWSHARE_WORKER_CREDENTIAL_ROTATION_TIMEOUT_MS` | 轮换证书HTTP超时，默认15秒 |
| `BROWSHARE_WORKER_CONTROL_SERVER_CA_CERTIFICATE_FILE` | 可选的私有Server TLS CA证书 |
| `BROWSHARE_WORKER_CONTROL_HANDSHAKE_TIMEOUT_MS` | WSS与Hello握手超时，默认10秒 |
| `BROWSHARE_WORKER_CONTROL_RECONNECT_MIN_MS` | 断线重连退避下限，默认1秒 |
| `BROWSHARE_WORKER_CONTROL_RECONNECT_MAX_MS` | 断线重连退避上限，默认30秒 |
| `BROWSHARE_REMOTE_TAB_ENABLED` | 是否启用进程内Remote Tab Runtime；正式Worker设为`true` |
| `BROWSHARE_REMOTE_TAB_EXTENSION_HOST` | Extension loopback地址，只允许loopback |
| `BROWSHARE_REMOTE_TAB_EXTENSION_PORT` | Extension loopback端口，默认9224 |
| `BROWSHARE_REMOTE_TAB_EXTENSION_ID` | 协调发布中固定的32字符Extension ID |
| `BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256` | 只读挂载CRX的64字符小写SHA-256 |
| `BROWSHARE_REMOTE_TAB_EXTENSION_RELEASE_DIRECTORY` | 签名CRX只读挂载目录，默认`/opt/browshare/extension-release` |
| `BROWSHARE_REMOTE_TAB_EXTENSION_UPDATE_PORT` | Chrome本机更新服务端口，默认9225 |
| `BROWSHARE_REMOTE_TAB_MANAGED_POLICY_PATH` | Worker可写的原子策略文件路径 |
| `BROWSHARE_REMOTE_TAB_RUNTIME_SECRET_FILE` | Core与Extension共享的本次Runtime Secret |
| `BROWSHARE_REMOTE_TAB_RUNTIME_GENERATION` | 嵌入式配置调用者可显式传入；正式 Worker CLI 每次进程启动自动生成，覆盖持久环境值 |
| `BROWSHARE_REMOTE_TAB_EXTENSION_TIMEOUT_MS` | Extension角色和本地媒体Probe超时 |

注册成功后删除Enrollment Token Secret，后续容器只依赖身份卷。身份文件包含节点私钥，必须按
Secret备份和限制读取；保留身份卷重建容器仍是同一Worker，空身份卷不会按名称恢复节点。

### 轮换Credential与退役Worker

正常轮换不需要停止Profile或重新Enrollment：

1. 确认Worker控制连接在线，创建短期Rotation Token并立即保存一次性明文。
2. 在Worker本机备份身份文件，把Token写入权限为`0600`的临时Secret文件。
3. 以原身份卷启动协调版本Worker，并只为这次启动设置
   `BROWSHARE_WORKER_CREDENTIAL_ROTATION_TOKEN_FILE`。
4. 确认Worker日志出现`Worker credential rotation completed`，管理接口显示新Credential为当前连接、
   旧Credential为`REVOKED`且原因是`rotated`。
5. 删除Token Secret并用同一身份卷再重启一次，确认Worker只加载新身份且重新进入`ONLINE`。

如果步骤3在请求、证书验证或原子落盘前失败，旧Credential仍有效，可移除Rotation Token后恢复旧
Worker。Backend已经签发新Credential但Worker未能用它完成Hello时，管理员应先保存现场和身份备份，
不要撤销旧Credential；可以撤销未消费Token并重新签发。CA私钥丢失会阻止新证书签发，但不影响已
签发Credential继续认证。

`DISABLED`用于可恢复的紧急隔离，不是数据删除：它拒绝认证但保留Credential。永久下线节点时，先
禁用Worker，再确认所有Profile已处理且没有非终态Tab Session，最后使用精确Worker名称调用退役
接口。退役会撤销Backend中的剩余Credential和Token并软删除元数据；运维人员仍需在节点侧销毁身份
Secret与不再保留的Profile卷。

Worker镜像必须安装协调版本的Remote Tab Core和Protocol npm包。Worker进程先绑定Extension
loopback，再校验只读挂载的签名CRX、启动loopback更新服务，并写入同一Secret/Generation的
Managed Policy；完成后才允许启动Chrome。倒置顺序会依赖MV3 service worker的随机唤醒和重连，
不属于支持的启动流程。Chrome调试只使用Worker继承的pipe，不发布`DevToolsActivePort`或
Chrome HTTP管理入口。Worker给Remote Core提供每Runtime随机秘密路径的loopback WebSocket桥，
拒绝所有携带Origin的连接，普通HTTP始终404；不得将该私有地址配置到反向代理、Portal或日志中。
既有Profile升级时无需迁移用户数据，原TCP CDP端口文件在新Chrome取得锁后清理。

Worker镜像固定安装Maple Mono CN v7.9的Regular、Bold、Italic和Bold Italic，下载包校验SHA-256，
并保留上游OFL 1.1许可。每次启动Chrome前，在同一Profile的flock锁内原子合并
`Default/Preferences`的`webkit.webprefs.fonts`，把standard、serif、sansserif、fixed的
Zyyy、Hans、Hant默认族设为`Maple Mono CN`。其他偏好、Cookie及站点存储不变；运行中的Chrome
不修改，升级对该Profile下次启动生效。网站显式字体及`@font-face`保持优先，不注入页面CSS。
字体支持简体、繁体中文和日文，但不保证所有Unicode字符。镜像之外部署Worker时，先安装
fontconfig、curl和unzip，再以root运行`bash deploy/docker/install-maple-font.sh`，并将
`deploy/docker/50-maple-mono.conf`以0644安装到`/etc/fonts/conf.d/50-maple-mono.conf`。

Chrome sandbox需要随镜像发布的
最小seccomp profile；`seccomp=unconfined`只允许在隔离测试中定位宿主兼容性，不能进入生产Compose。

当前profile及其上游commit、内容摘要和额外放行syscall记录在`deploy/compatibility.json`；部署时通过
`security_opt: seccomp=./deploy/docker/chrome-seccomp.json`显式加载，并为`/dev/shm`至少预留1 GiB。
`pnpm worker:image:verify -- <image>`会使用该profile实际启动无`--no-sandbox`的headless Chrome并
检查CDP，而不是只根据镜像内文件判断兼容。详细构建与许可边界见`deploy/docker/README.md`。

Google Chrome的许可证独立于本仓库MIT源码。在确认Google分发条款前，项目只发布Dockerfile、
兼容清单和校验工具，由部署者本地构建；不得把包含Chrome二进制的镜像推送为公共GHCR产物。

### 独立节点模板

独立 Gateway 使用 [`compose.gateway.yml`](../../deploy/docker/compose.gateway.yml)，独立 Worker 使用
[`compose.worker.yml`](../../deploy/docker/compose.worker.yml)。配置生成、注册合并与端口映射见
[`容器部署说明`](../../deploy/docker/README.md)。Backend 与 Portal 可继续使用控制面项目，Gateway
和每个 Worker 使用各自项目、网络、数据卷和公网入口；它们不依赖共享 Docker DNS 别名。

Gateway registry 中的 `publicEndpoint` 必须同时可由 Worker 与 Viewer 到达，`healthUrl` 必须可由
Backend 到达。Backend 必须信任 Gateway ingress 的 CA；修改私密 registry 后重启 Backend 才会生效。
使用多个 Gateway 时，Backend 按注册顺序选择第一个健康节点，已创建 Session 保留原 Gateway 归属；
配置顺序不是媒体连接迁移机制。Worker 信任 bundle 需覆盖 Backend/control/Gateway 的服务端证书。

### 独立Gateway进程

Backend通过`BROWSHARE_GATEWAYS_JSON_FILE`读取部署注册表，内容为最多32项的JSON数组，每项含
`id`（稳定UUIDv7）、`publicEndpoint`、`healthUrl`和`secret`。ID与公开endpoint不能重复；Secret
至少32字符。未配置注册表时Backend仍可启动，但不能分配Gateway。公开endpoint必须WSS；health
必须HTTPS，仅同机loopback允许HTTP。URL不允许内嵌凭据、query或fragment。

Gateway镜像从同一协调版本Remote Tab signaling源码构建，不包含Chrome：

```bash
pnpm gateway:image:build -- browshare/gateway:local
```

默认源码位于相邻`browshare-tab-remote`，其他位置使用`BROWSHARE_REMOTE_TAB_SOURCE`。Docker
target为`gateway`，进程以node用户运行；配置示例见[Gateway环境变量](../../apps/gateway/.env.example)。

| Gateway配置 | 作用 |
| ----------- | ---- |
| `BROWSHARE_GATEWAY_ID` | 与Backend注册表一致的稳定ID |
| `BROWSHARE_GATEWAY_BACKEND_URL` | Backend HTTPS origin；同机loopback可HTTP |
| `BROWSHARE_GATEWAY_SECRET_FILE` | 只读Secret，内容与对应注册表一致 |
| `BROWSHARE_GATEWAY_PUBLIC_ENDPOINT` | Viewer/Core可达的WSS地址，与注册表一致 |
| `BROWSHARE_GATEWAY_HOST` / `PORT` | 原始WebSocket监听，默认127.0.0.1:3481 |
| `BROWSHARE_GATEWAY_HEALTH_HOST` / `HEALTH_PORT` | 鉴权health监听，默认127.0.0.1:3482 |
| `BROWSHARE_GATEWAY_ICE_SERVERS_JSON` | 标准iceServers数组，默认空数组 |
| `BROWSHARE_GATEWAY_TURN_URLS` | 动态 TURN 的逗号分隔 `turn:`/`turns:` URL，可指定端口及 `?transport=udp`/`tcp`，最多16条 |
| `TURN_SHARED_SECRET` / `TURN_SHARED_SECRET_FILE` | 与 coturn 的 REST authentication 共享Secret一致，至少32字符；直接值与文件不能同时配置 |
| `BROWSHARE_GATEWAY_TURN_CREDENTIAL_TTL_SECONDS` | 动态凭据有效期，默认3600秒，允许60–86400秒 |
| `BROWSHARE_GATEWAY_ICE_TRANSPORT_POLICY` | all或relay，默认all |
| `BROWSHARE_GATEWAY_MAX_CONNECTIONS` | 连接上限，默认2000 |
| `BROWSHARE_GATEWAY_MAX_CONNECTIONS_PER_IP` | 每来源地址连接上限，默认128 |
| `BROWSHARE_GATEWAY_MAX_PENDING_PAIRS` | 配对上限，默认1000 |

WS监听放在TLS反向代理后，代理须支持Upgrade并关闭缓冲；不公开原始WS和内部鉴权/health端口。
Core到Gateway使用独立的Server TLS信任；Worker控制通道的CA配置不会自动用于该连接。私有CA或
自签测试Gateway需要将CA证书只读挂载给Worker，并在进程启动前设置`NODE_EXTRA_CA_CERTS`指向
该文件；不挂载私钥，不关闭证书或主机名验证。公开受信CA无需这项附加配置，Viewer浏览器也须
信任其使用的Gateway证书。
跨节点访问Backend或health使用HTTPS入口。单层反向代理后的来源地址限制按Gateway实际看到的
连接地址计算，当前不信任客户端自报转发头。

Gateway 支持两种互斥的 ICE 配置。显式静态模式继续使用 `BROWSHARE_GATEWAY_ICE_SERVERS_JSON`，
保留部署者提供的 STUN/TURN 数组、username 和 credential。动态模式同时配置 `BROWSHARE_GATEWAY_TURN_URLS`
和 `TURN_SHARED_SECRET` 或 `_FILE`，不能再配置非空静态 ICE 数组；缺少动态参数的一半、孤立的 TTL、
不合法的 TURN URL/端口或超范围 TTL 均在启动时拒绝，不静默回退。

动态模式复用 Remote Tab `iceServerProvider`：每次通过授权的 Core/Viewer 配对完成时，分别为两端签发
独立凭据，username 为 `到期Unix秒:角色-随机标识`，credential 为标准 Base64 编码的
`HMAC-SHA1(sharedSecret, username)`。随机标识不包含用户或 Session 业务 ID。共享 Secret 仅留在
Gateway 与 coturn，不能下发给浏览器、写入日志或打进镜像。配置方式与
[coturn 官方 TURN REST API 说明](https://github.com/coturn/coturn/blob/master/README.turnserver#L792)
一致；coturn 使用 `use-auth-secret` 与匹配的 `static-auth-secret`，并正确配置 realm、网络入口及 relay 端口。
Gateway 与 coturn 的时钟须保持同步。

官方 coturn Debian 镜像给 `/usr/bin/turnserver` 设置了 `CAP_NET_BIND_SERVICE` 文件能力。采用
`nobody:nogroup`、`cap_drop: ALL`、`no-new-privileges` 时，须显式保留 `cap_add: [NET_BIND_SERVICE]`；
否则该官方二进制即使只监听高端口也可能因能力边界拒绝执行。该配置不需要 root 或 privileged 容器，
见[官方 Dockerfile](https://github.com/coturn/coturn/blob/master/docker/coturn/debian/Dockerfile)。

TTL 限制新 TURN allocation 使用该凭据的期限，不是媒体会话时限。coturn 已认证 allocation 保留会话密钥，
凭据到期后仍可正常 Refresh；不能把到期当成撤销现有媒体通道。Remote Tab 的同一配对 ICE restart
只重新协商，不重调 provider；若网络变化需要新 allocation 而旧凭据已过期，现有 Viewer 在有限次 ICE
恢复失败后通过 BrowShare `getConnection` 重新授权 Viewer generation、重建配对并获得新凭据。
这条恢复会重建 PeerConnection，进行中的文件或剪贴板传输可能中断；没有承诺无缝热更新凭据。
自定义 Viewer 嵌入也必须配置 Remote Tab 的 reconnect provider，不能只依赖同一配对的 ICE restart。

先备份数据库并执行0008迁移，再启动新Backend和Gateway。验证鉴权health、真实WSS绑定及单次
消费，不能只检查容器Up。测试节点的loopback TLS入口只用于链路验证，不能作为公网发布证明。

### 执行数据库migration

生产Backend不执行ORM自动同步。部署和升级都先运行独立migrator；它按顺序读取仓库中的可审查
SQL，并把历史写入`browshare_internal.schema_migrations`。连接可以直接使用`DATABASE_URL`，
也可以把完整连接串放入只读Secret文件并设置`DATABASE_URL_FILE`：

```bash
DATABASE_URL_FILE=/run/secrets/database_url pnpm database:migrate
```

重复运行不会再次执行已记录的migration。migration失败时事务回滚并以非零状态退出，Backend
不得在目标schema未升级完成时继续启动。自定义数据库约束、函数和Trigger使用独立custom
migration维护，不能只存在于Drizzle TypeScript schema中。

引入Worker Runtime Snapshot的升级会为`workers`增加`runtime_snapshot`和`last_snapshot_at`。
必须先运行独立migrator再启动新Backend；否则Backend按migration历史fail-fast，不能依赖ORM运行时
自动补列。首次收到新协议快照后，管理员可用这两个字段区分“尚未对账”和“已保存最新Worker事实”。

### 运行期设置

注册、默认并发、回收策略、文件限制、画质、日志保留和功能开关保存在PostgreSQL，由有`system.manage`权限的管理员修改。管理页标记配置来源；部署固定项不提供虚假的在线编辑按钮。

## 持久数据

| 数据                            | 位置                    | 备份要求                  |
| ------------------------------- | ----------------------- | ------------------------- |
| 用户、权限、Profile元数据、审计 | PostgreSQL              | `pg_dump`或等效一致性备份 |
| Profile登录态                   | Worker Profile volume   | Chrome停止后的冷备份      |
| Worker身份                      | Worker identity volume  | 原身份私密备份；重新Enrollment不能接回原Profile |
| Session临时文件                 | Worker temp volume      | 不备份，按TTL清理         |
| 部署配置、Worker CA、TLS及服务Secret | 私密部署目录及外部Secret管理 | 成套备份，保留权限与身份关系 |
| 发布镜像和CRX                   | Registry/GitHub Release或受保护本地归档 | 保存固定digest/CRX；未发布构建不能假定可重新下载 |

数据库备份和Profile备份必须成对记录时间，但首版不保证跨数据源原子快照。恢复Profile只能在原Worker、Profile停止且无Session时执行。导出文件由部署者复制到外部备份介质；首版不内置S3。

### Profile 冷备份与恢复

Worker 镜像内置 `/app/tools/profile-archive.sh`（源码为 `tools/profile-archive.sh`）。工具使用 GNU tar、
Node.js 和 Linux flock，以 Worker 存储目录所有者身份执行；复用 Chrome 的 `.browshare-runtime.lock`，
不复制或删除该锁文件。归档目录包含 `profile.tar.gz` 与 `manifest.json`，记录原 Worker ID、Profile ID
和 UTC 归档时间；不包含 Worker 私钥、Session 临时文件、Chrome 单实例锁、Socket 和 DevTools 端口文件。
归档含 Profile 的登录态和浏览器数据，目录权限为 0700、文件为 0600，按私密备份保管。

操作前将 Worker 设为 DRAINING，结束目标 Profile 的全部 Session，将 ALWAYS_ON 改为 MANUAL 并停止
Runtime，确认 Session 终态、Runtime STOPPED 后停止 Worker 容器。业务排空由 Portal/API 完成；离线
工具只检查目录、身份和运行锁，不连接 Backend，也不代替业务状态检查。备份期间保持 Worker 停止，
避免自动启动、删除或改变 Profile 元数据。记录同批 PostgreSQL 归档时间及文件名，跨数据源恢复点不保证原子性。

以下示例适配正式 All-in-one 命名卷，以具有 Docker 和备份目录管理权限的 Linux 管理员身份执行。
命令从 BrowShare 源码根目录运行；`deployment` 指向原生成目录，后续所有命令复用同一组 Compose 参数。
独立 Worker 使用其 `compose.worker.yml` 和对应 `.env`，服务名同样为 `worker`；旧
`compose.worker.example.yml` 则需完整提供其必填宿主目录变量，并将服务名换为 `browshare-worker`。

```bash
deployment="$PWD/tmp/development-deployment"
dc() {
  docker compose --env-file "$deployment/.env" \
    -f deploy/docker/compose.control.yml -f deploy/docker/compose.all-in-one.yml "$@"
}
backup_directory="/srv/browshare-backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup_directory"
chown 1000:1000 "$backup_directory"
profile_id=REPLACE_WITH_PROFILE_UUID
# 已通过 Portal 完成排空、停止 Runtime；同时暂停管理写入，停止 Backend。
dc stop worker backend
dc run --rm --no-deps -v "$backup_directory:/backup" \
  --entrypoint /app/tools/profile-archive.sh worker backup \
  /var/lib/browshare/identity "/var/lib/browshare/profiles/$profile_id" "/backup/$profile_id"
dc run --rm --no-deps -v "$backup_directory:/backup" --entrypoint /bin/sh worker -c '
  set -eu; umask 077
  test ! -e /backup/worker-identity.tar.gz
  test -f /var/lib/browshare/identity/worker-identity.json
  tar -czf /backup/worker-identity.tar.gz -C /var/lib/browshare/identity .
'
```

对需要保留的每个 Profile 分别归档。另将整个受保护部署目录（包含 Worker CA 私钥、证书、TLS、
Gateway/数据库/会话等 Secret 及配置）复制到同批私密备份（例如确认目标不存在后执行
`cp -a -- "$deployment" "$backup_directory/deployment"`），并保存所引用的 CRX、固定镜像身份与
兼容清单；CRX 可能位于部署目录之外。Extension 长期签名私钥独立保管。记录原 Worker ID、Profile ID、
Compose 项目名、卷映射和数据库归档时间；不要把 Secret 正文写入清单。继续执行下面的 PostgreSQL 归档。

恢复 Profile 限定原 Worker、原 Profile ID 和空目标目录。保持 Worker 停止；若是原卷内恢复，先把
原目录移到人工回滚位置，再以 UID 1000 创建同名 0700 空目录，不删除最后一份原数据。
一次性工具先在同一文件系统临时解压，成功后移入目标目录，截断归档不会写入目标 Profile：

```bash
dc run --rm --no-deps -v "$backup_directory:/backup:ro" \
  --entrypoint /app/tools/profile-archive.sh worker restore \
  /var/lib/browshare/identity "/var/lib/browshare/profiles/$profile_id" "/backup/$profile_id"
```

只恢复本部署生成并保管的归档。工具不迁移 Worker 身份、Profile 归属或 Chrome 版本；使用原兼容集，
确认 Worker 就绪后，在用户入口维护窗口内恢复节点 ACTIVE，再启动目标 Runtime，通过维护 Session
检查登录态和站点数据，最后开放用户流量及恢复运行模式。DRAINING 节点拒绝新的 START。
失败时保持排空，保留错误现场与原数据，停止 Worker 后人工还原原目录；不要把恢复失败的部分数据当作成功。

### PostgreSQL 归档

正式脚本使用 PostgreSQL custom archive，拒绝覆盖；恢复要求预先存在的空数据库并使用单事务。
需要 `pg_dump`、`pg_restore` 和 `psql`，Backend/migrator 镜像不包含这些客户端。All-in-one 的数据库
不公开宿主端口，生成的 `database_url` 内主机名 `postgres` 仅供 Compose 网络解析，不能直接把它交给
宿主 `pnpm database:backup`。使用上节的 `dc` 和 `backup_directory`，在正式 PostgreSQL 服务内通过
本地 Unix socket 执行仓库原脚本；此方式不需要打印或传递密码，也不改变数据库网络暴露：

```bash
archive_name=browshare.dump
dc exec -T --user postgres \
  -e 'DATABASE_URL=postgresql:///browshare?host=/var/run/postgresql&user=browshare' \
  postgres sh -s -- "/tmp/$archive_name" < tools/database-backup.sh
# noclobber 保留宿主已有归档，umask 保护新文件。
(umask 077; set -C; dc exec -T --user postgres postgres cat "/tmp/$archive_name" \
  > "$backup_directory/$archive_name")
dc exec -T --user postgres postgres rm -- "/tmp/$archive_name"
```

脚本会先验证归档可列举，之后再完成命名。若导出到宿主失败，保留容器中的归档并修复原因，不重跑
生成覆盖同名文件。完成后将整批备份复制到外部介质，再恢复服务或进行协调升级。

单独管理数据库时，宿主安装与服务器兼容的 PostgreSQL 客户端，使用其实际可达的连接配置运行：

```bash
DATABASE_URL_FILE=/run/secrets/database_url pnpm database:backup /backup/browshare.dump
DATABASE_URL_FILE=/run/secrets/restore_database_url pnpm database:restore /backup/browshare.dump
DATABASE_URL_FILE=/run/secrets/restore_database_url pnpm database:migrate
```

`database:backup-retain /backup 14` 只对单独数据库归档目录顶层的 `.dump` 按修改时间保留最近 N 份；
不会清理子目录中的成套备份。成套数据库/Profile/identity 备份必须一起管理，不能只删数据库而留下
无法配对的 Profile。保留数量由恢复点目标确定，至少留一套已验证的完整备份。

## Proxy部署

Worker为每个运行Profile启动loopback Proxy Adapter。上游Proxy配置和明文凭据由Backend通过mTLS控制链路下发，Worker不持久化凭据。

Adapter对HTTP和CONNECT目标统一拒绝`localhost`及其子域、IPv4 loopback与本网络地址
（`127.0.0.0/8`、`0.0.0.0/8`）、IPv6 `::`/`::1`及对应IPv4映射地址；整数、十六进制和
缩写IPv4先规范化再检查。DIRECT在实际socket的DNS lookup回调中检查返回地址，避免预检后
再次解析绕过。RFC1918业务内网仍可访问，管理员显式配置的上游Proxy endpoint不受目标过滤影响。
因此Profile健康检查也不能再使用Worker自身的`https://localhost/...`，应使用可达的业务健康端点。

HTTP/HTTPS/SOCKS上游仍自行解析目标域名。与Worker共用网络空间的上游能把普通域名解析到
Worker loopback，Adapter不能从远端DNS结果建立完整的管理端口隔离。此拓扑在已有Proxy实测中
存在，不能将其当作不支持的配置；部署隔离验收必须另行覆盖它。Chrome只为实际Extension连接和
签名更新服务配置直连端口；Extension控制仍校验精确扩展Origin以及Secret/Generation，更新服务
只提供签名公开产物。仅CDP监听loopback或Adapter目标过滤均不足以证明网页无法接触所有管理入口。

Adapter、Chrome网页流量和远程控制链路必须分别验证：

- Chrome目标网站流量确实从配置Proxy出站。
- Proxy故障时请求失败而不是Direct。
- Worker到Backend、Core到Gateway和WebRTC ICE不误走Profile Proxy。
- 出口IP测试是管理员显式动作，不作为持续遥测。

## 可观察性

关联使用请求、命令、Worker、Profile和Session的实际ID。Backend HTTP日志使用 `reqId`，与响应 `x-request-id` 及审计 `requestId` 相同；控制命令日志使用 `commandId`，对应协议 `messageId`。Worker/Profile/Session字段沿用代码的 `workerId`、`profileId` 和 `sessionId`。Session创建、关闭、Viewer准备及成功继续的审计metadata记录实际 `commandId`；未下发命令的直接终态操作不编造ID。其他组件诊断关联仍需结合各自事件字段，不能因一个Session ID存在就宣称完整端到端跟踪。敏感URL只能记录origin或摘要。

提供：

- `/health/live`：进程仍可响应。
- `/health/ready`：依赖和启动条件满足。
- Prometheus指标：请求、命令、Session、Worker、WebRTC汇总、Proxy和磁盘。
- Portal审计日志：身份、授权、Profile、Proxy、Worker、脚本、设置和Session生命周期。

Backend提供`GET /metrics`的Prometheus文本格式端点，当前输出请求开始/完成/5xx计数、按状态码
计数、已结束响应的累计单调耗时、进程运行时间和常驻内存；进行中的请求不改变耗时累计值，SSE仅在响应结束时计入，客户端提前断开不算已完成响应。该聚合值不是普通API的延迟分位数。指标只包含聚合数值，不包含用户、Cookie、正文或URL。
Worker健康端口的`GET /metrics`输出进程、连接状态、Chrome Runtime就绪、CPU、Session、Tab、
Profile/temporary storage容量和内存指标，以及最新已完成真实采样的开始时间 `browshare_worker_metrics_observed_timestamp_seconds`；首个采样完成前不输出该时间。抓取不会触发CDP采样，样本过旧时可通过该时间辨别，不能仅凭HTTP 200判定Chrome状态新鲜。Gateway健康
端口的`GET /metrics`沿用健康端点Bearer认证，输出连接数、待配对数和对应上限。Worker、Gateway和
WebRTC业务指标由Worker接收Remote Tab公开诊断事件后聚合，部署时分别抓取各组件指标入口。

Backend同时导出命令RPC的开始、传输尝试、结束结果、累计单调耗时和待完成数。RPC开始前的API
校验拒绝仍计入HTTP指标，不计入命令；重发增加attempts，不重复增加started。命令正常返回但代理
健康检查失败时，命令结果仍为succeeded，Proxy健康为UNHEALTHY。累计耗时包含等待重连时间，
不代表执行耗时或延迟分位数，进程重启后counter归零。

业务gauge来自本次数据库查询与当前控制连接：Worker状态、就绪与调度容量、Session种类/状态、
Proxy最新探测健康、Profile路由异常/未知/待重启和磁盘阻塞。固定Session和Proxy状态即使为空也
输出零；终态Session按数据库保留行数统计，保留清理后会下降。查询失败使抓取失败，不输出伪零。
`browshare_business_observed_timestamp_seconds`标记查询完成时间；这些跨服务观察不是原子事务快照。

Worker仅保存活跃Session最近的固定媒体字段，指标label不包含Session/Profile/用户ID、页面地址、
标题、编解码器字符串或错误正文。Remote Tab每5秒推送媒体诊断，15秒未更新的样本标记stale并
排除出数值聚合；Session关闭、媒体断开或Viewer代次改变时移除旧样本。每个字段只统计实际报告
它的fresh样本，通过`browshare_webrtc_field_contributors`给出分母，缺失RTT等不能当作零。
`packets_lost`、`frames_dropped`等peer累计读数仍导出为gauge，因为peer更换会归零。

例如，全部Worker的视频发送码率与有报告RTT的平均值可分别查询：

```promql
sum(browshare_webrtc_bitrate_bps_sum{direction="outbound",kind="video"})
```

```promql
sum(browshare_webrtc_round_trip_time_milliseconds_sum{direction="outbound",kind="video"})
/ sum(browshare_webrtc_field_contributors{direction="outbound",kind="video",field="roundTripTimeMs"})
```

无贡献样本时查询为空或NaN，不能解释为健康零延迟。数据通道只按固定channel名称汇总最近fresh的
bufferedAmount。抓取这些指标只读取内存，不发起CDP查询，不加入控制心跳等待链。

不内置Prometheus、Grafana、Loki或托管错误收集，只提供Compose示例和采集接口。可选的[Prometheus采集示例](../../deploy/observability/README.md)使用独立数据卷、私有健康端口和Gateway凭据文件；它不属于BrowShare启动依赖。默认不向BrowShare开发者上传遥测。

服务的标准 `err` 日志仅保留错误类型和机器诊断字段，复用Backend请求错误的脱敏规则；不直接序列化原始message、stack、cause或异常输入。Backend/Worker的配置加载和运行时启动错误也进入结构化日志，避免Node默认未捕获异常输出环境URL、数据库凭据或损坏identity文件片段。

默认保留：审计180天、Session元数据90天、诊断日志30天。管理员可以改为永久或自定义周期。

## 升级

### 控制面

1. 阅读Release升级说明。
2. 备份PostgreSQL。
3. 拉取明确版本镜像，不使用生产`latest`。
4. 运行独立migrator。
5. 启动Backend和Portal并验证readiness。

升级至 Control 1.21 / 迁移 0022 时，先把 Worker 设为 DRAINING、结束 Session 并停止 Profile，
等待旧 START outbox 完成，再停止 Backend、备份数据库并运行 migrator。迁移遇到旧 START 会回滚并
明确报错；使用旧 Backend 完成或通过正式 STOP 替换这些操作后重试，不手改 outbox。然后替换
Backend、Portal 与 Worker 的协调镜像；旧 Worker 仍可恢复停止与诊断，但不允许新 START。
历史尝试启动过的 Profile 按可能含数据处理；若当时确实未产生有效目录，应由管理员检查原 Worker
及备份，或创建明确的新 Profile，不清除初始化标记让原账号静默变成空白状态。

All-in-one 复用上文 `dc` 函数。完成排空及同批备份后，构建或取得明确协调版本，把 `.env` 的
Backend/Migrator/Gateway/Portal/Worker 镜像引用一起改为候选固定引用；Extension 更新时同步 CRX
路径、文件名和 `worker.env` 中的版本对应 ID/摘要，不再次运行拒绝覆盖的初始化生成器。执行：

```bash
dc stop worker backend
dc run --rm migrator
dc --profile worker --profile turn up -d
dc ps -a
```

migrator 失败时保持维护窗口，不启动新 Backend。成功后先检查实际 readiness 和 Worker 对账，再在
维护窗口内恢复 ACTIVE 并验证原 Profile 数据/新 Session。镜像升级前后的标识、schema 和归档时间
应记录到同批清单。需要数据库回退时恢复升级前归档至另一个空库，不能让旧 Backend 直接连接新 schema。

首版单Backend会产生短暂控制面不可用；有效租约内的WebRTC Session继续。失败后是否允许数据库回退由该次migration说明决定，不承诺通用自动降级。

### Worker

1. 将Worker设为`DRAINING`。
2. 等待Session自然结束，或由管理员明确终止。
3. 停止Profile Runtime。
4. 备份Worker identity和关键Profile。
5. 替换固定版本镜像并复用持久卷。
6. 启动、执行Capability Probe并完成Backend对账。

Backend可以独立重启；Worker会保持现有浏览器资源，在控制端恢复后用同一进程`instanceId`重新发送
更高sequence的全量快照。Worker日志出现`control channel connected`之前，Backend应先出现最终
`reconciliationComplete: true`。若日志持续出现非空清理计划，先检查Profile generation、Session
租约和数据库终态，不要通过手工把Worker改为`ONLINE`绕过对账。

节点维护时通过状态API写入`DRAINING`，而不是停掉控制连接。升级完成后写入`ACTIVE`；只有当前
连接已完成READY Probe和Snapshot时才立即返回`ONLINE`，否则返回`PENDING`或`OFFLINE`并等待正常
重连。紧急禁用写入`DISABLED`会立即关闭socket，运行中的Worker会按退避策略继续探测；管理员恢复
后不需要重启daemon。后台只把心跳过期的`ONLINE`节点转为`OFFLINE`，不会覆盖维护或禁用意图。
`BROWSHARE_WORKER_OFFLINE_AFTER_MS`必须至少为心跳间隔两倍，避免单次调度抖动造成误判。

Chrome和扩展只在明确的Worker发行中更新，不运行时自动更新。

Extension私钥由部署者在`browshare-tab-remote`签名环节长期保存，不进入Worker镜像或挂载。普通升级
复用同一私钥以保持ID，发布更高版本CRX并同步更新期望版本与SHA；Worker Drain后整体重启，在新建
Session前完成策略安装和Capability Probe。私钥轮换会产生新ID，必须作为单独迁移处理，不能在滚动
升级中静默替换。

## 容量与限制

平台不根据CPU、内存或磁盘自动设置并发。管理员配置Worker最大Tab数，并结合指标和压测调整。

管理员可把Worker `maxActiveTabs`设为非负整数或`null`。默认值为4；0适合临时阻止新增但又不需要
改变节点状态的场景，`null`表示平台层不设上限。修改值立即影响后续调度，不终止既有Session。
当占用已经高于新值时，Worker详情显示`OVER_LIMIT`和`CAPACITY_REACHED`，管理员应先Drain并等待
自然释放，或明确结束指定Session。Worker心跳中的CPU、内存、磁盘、Chrome和网络数据用于人工
判断该值，不触发自动升降容。

- 2C2G、无GPU的机器适合单会话功能验证，不代表四路性能基线。
- 1080p/60是默认允许上限，不是单Session持续保证。
- TURN中继会让服务器同时承担入站和出站媒体带宽。
- Profile和下载需要磁盘配额与外部备份。
- systemd或容器运行时应提高文件描述符限制，并为`/dev/shm`提供足够空间。

## 灾难恢复

以下是另一台空环境恢复同一安装的最短顺序，不要求复用原物理主机，但要求保留原业务身份。
旧 Worker 必须已停止并保持停止，不能让两个运行实例同时使用一份身份/数据。同宿主用新项目名演练时，
先停止原整套项目以释放同一组入口端口，保留原卷；不能让恢复 Worker 通过旧地址连回仍运行的原控制面。
另一宿主恢复则在受控切换 DNS/路由后再启动 Worker，确保原身份保存的控制地址实际指向恢复环境。重新 Enrollment 会产生
新 Worker ID，不能接回数据库中的原 Profile 归属，也不能通过冷归档的原 Worker ID 校验。

1. 取得同批 PostgreSQL、每个 Profile、原 Worker identity 归档，以及原部署配置、Worker CA 与 CRX。
   CA 必须能验证原身份中的客户端证书；恢复原 CA 私钥后才能继续签发/轮换。不要在恢复目录运行配置
   生成器以产生新 CA/Secret。准备同一协调镜像，复用原 Extension ID。开发 TLS 过期时单独续签服务端
   证书并分发信任，不替换 Worker 身份 CA。
2. 私密复制部署配置到新宿主并保留权限。修正 `.env` 中的绝对部署目录、CRX 路径及新 Compose 项目名；
   本例以新项目的空命名卷演练。保留原广告域名/控制地址并把 DNS 指向恢复入口；若必须改地址，按
   [容器部署](../../deploy/docker/README.md) 的全部配置关联操作，不能只改 Nginx。离线身份也保存
   控制地址，原入口必须保持可达。沿用上节的 `dc` 函数，把 `deployment` 指向恢复配置目录。
3. 只启动 PostgreSQL，禁止先 `up -d` 整个项目。镜像首次创建 `browshare` 空数据库；Backend 与 migrator
   尚不启动。先执行原恢复脚本，再显式迁移：

```bash
dc up -d --wait postgres
# backup_directory 是本机已复制并验证的同批私密备份目录。
dc exec -T --user postgres postgres sh -c \
  'umask 077; set -C; cat > /tmp/browshare-restore.dump' < "$backup_directory/browshare.dump"
dc exec -T --user postgres \
  -e 'DATABASE_URL=postgresql:///browshare?host=/var/run/postgresql&user=browshare' \
  postgres sh -s -- /tmp/browshare-restore.dump < tools/database-restore.sh
dc exec -T --user postgres postgres rm -- /tmp/browshare-restore.dump
dc run --rm migrator
```

恢复脚本会拒绝非空目标，不清空已有业务表；数据库恢复未成功时不要继续 migrator/Backend。
固定 23 项 schema 恢复配套镜像时，重复 migrator 不增加记录。历史升级是否允许以该候选继续迁移，
取决于具体迁移说明；不通过删除 migration 历史绕过校验。

4. 在尚未启动 Worker 的空命名卷里恢复原 identity，再按每个 Profile 的原 UUID 创建空目录并恢复。
   以下命令只运行离线工具，不执行 Worker daemon：

```bash
dc run --rm --no-deps -v "$backup_directory:/backup:ro" --entrypoint /bin/sh worker -c '
  set -eu
  test -z "$(ls -A /var/lib/browshare/identity)"
  tar -xzf /backup/worker-identity.tar.gz --no-same-owner -C /var/lib/browshare/identity
  test -f /var/lib/browshare/identity/worker-identity.json
'
profile_id=REPLACE_WITH_PROFILE_UUID
dc run --rm --no-deps --entrypoint /bin/sh worker -c \
  'mkdir -m 0700 -- "$1"' sh "/var/lib/browshare/profiles/$profile_id"
dc run --rm --no-deps -v "$backup_directory:/backup:ro" \
  --entrypoint /app/tools/profile-archive.sh worker restore \
  /var/lib/browshare/identity "/var/lib/browshare/profiles/$profile_id" "/backup/$profile_id"
```

5. 确认所有原 Profile 及身份恢复完成、旧 Enrollment Token 已移除，启动控制面与所需 Worker/TURN：

```bash
dc --profile worker --profile turn up -d
dc ps -a
```

6. 用原管理员登录，检查 Backend readiness、原 Worker ID、能力探测/对账及 Profile 归属。旧活动 Session
   应收敛为 FAILED/CLOSED，不恢复旧 Tab。保持用户入口的维护窗口，先将节点恢复 ACTIVE（DRAINING
   拒绝 START），通过管理操作启动一个原 Profile，检查持久 Cookie/localStorage；验证媒体、输入、
   Proxy 和下载新领取。全部恢复检查完成后开放用户流量，恢复需要的运行模式。Session 临时数据不在
   本冷备份内，未归档的留存下载字节也不能宣称已恢复。

数据库存在但Profile卷丢失时，Profile必须显示明确的数据缺失错误，不能自动创建空目录冒充原登录态。
`PROFILE_DATA_MISSING` 不触发 ALWAYS_ON 自动重试。停止相关 Worker 后，使用 `profile:archive restore`
将原 Worker / Profile 对应归档恢复到空目录，保留相同 Worker identity 和目录归属，再启动 Worker，
等待能力探测与对账完成，手动 START 并验证业务登录态。不得将启动成功等同于全部 Chrome 数据完好。

Worker能力探测由daemon自行启动短生命周期Chrome，不需要另起Chrome容器或配置固定CDP地址。
业务Profile则由Worker在其持久卷中启动。Worker镜像构建需要Docker Buildx，并从相邻的
`browshare-tab-remote`源码构建协调的Core/Protocol生产依赖；非默认位置通过
`BROWSHARE_REMOTE_TAB_SOURCE`指定。Chrome、Core和Extension以`deploy/compatibility.json`为准。

## Portal与Remote Tab Viewer构建

Portal与Worker/Gateway使用同一协调版本，`tools/prepare-portal-viewer.mjs`检查
`deploy/compatibility.json`中的Remote Tab版本，构建相邻仓库导出的Viewer、Client、Protocol包，
以生产依赖部署到忽略的`tmp/portal-viewer-package/`，再链接到Portal的node_modules。
源码不在默认相邻目录时设置`BROWSHARE_REMOTE_TAB_SOURCE`；先在两个仓库分别执行
`pnpm install --frozen-lockfile`。Portal的dev、build和typecheck脚本包含此准备步骤。

业务代码只导入`@browshare/remote-tab-viewer`公开导出，不导入相邻仓库源文件。Vite将Viewer及
浏览器依赖打包到`apps/portal/dist/`，部署静态产物时不需要相邻源码或上述tmp目录。服务端需要
对`/workspace`、`/sessions`及`/sessions/:id`配置SPA入口，`/api`保留到Backend的同源代理；
Viewer Ticket来自REST响应，不放进路由。完整域名/TLS/Compose入口仍受PROGRESS发布项约束。

## Profile持久生命周期升级（控制协议1.3）

发布包包含migration0005。先停止待升级Worker的Profile并记录当前业务状态，再停止旧Worker和
Backend，备份数据库，使用新Backend生产依赖包运行migrator，随后启动新Backend及Worker。
旧活动记录会变成`RUNTIME_IDENTITY_UPGRADE_REQUIRED`，需重新启动Profile；不会把无法验证身份
的旧Chrome当作可直接接管的运行实例。Profile持久目录不受SQL迁移影响。

新Backend的手动运行API要求Worker协商1.3并完成能力与快照对账。原Worker身份、CA和Profile
数据卷应复用；通过ONLINE、controlReady、周期快照以及真实API启动/停止验证升级，不能只检查
容器Up。旧容器可停止保留，数据库已升级时不得不经兼容评估直接启动旧Backend；需要回退时使用
升级前数据库备份并处理升级后的业务写入。

Portal发布包增加健康检查URL表单和Profile事件流。反向代理必须关闭该SSE路径的缓冲，并允许
15秒心跳持续传输；保持同源Session Cookie与原有权限校验。全量Portal业务发布仍受PROGRESS中
未完成Session、策略和运维模块约束。


### Worker 下载文件入口

启用保留下载领取时，Worker 设置 `BROWSHARE_WORKER_DOWNLOAD_ENDPOINT` 为反向代理后的完整
HTTPS 文件 URL，设置 `BROWSHARE_WORKER_DOWNLOAD_PORTAL_ORIGIN` 为精确 Portal HTTPS origin。
独立私有监听默认 `127.0.0.1:3411`，可通过 `BROWSHARE_WORKER_DOWNLOAD_HOST` 与
`BROWSHARE_WORKER_DOWNLOAD_PORT` 修改；容器部署仅向文件反向代理网络暴露该监听。

反向代理保持配置 URL 的路径，只转发该文件路由；关闭请求/响应缓冲，保留 Origin、Content-Type、
Content-Disposition 与流中断。文件路由禁止记录请求正文、凭据和敏感名称，不能转发至 Backend
或信令 Gateway。健康、CDP、Extension loopback 入口不能因此暴露。TLS 终止在文件反向代理；
Worker 消费/复查凭据通过已有 Control mTLS 服务完成，Backend 不可达时拒绝文件传输。

候选升级需同时准备 DB 0015/0016 migration、Control 1.17 Backend/Worker、Remote Tab Core 与
Extension 0.1.21、包含下载收件箱的 Portal，以及上述文件 HTTPS 路由。保留卷必须持久挂载，
且与 Chrome spool 同文件系统。在完整 Chrome 下载、原生保存、撤销、中断和清理验收前，
不要把仅配置 sink 的 Worker 单独替换为对用户提供服务的版本。

## 管理员诊断包

`GET /api/v1/admin/diagnostics` 生成 `browshare.diagnostics.v1` JSON。需要同时拥有
`system.manage`、`worker.read`、`profile.read` 和 `audit.read`；系统管理权限不隐含其他读取权限。
可传 `sessionId` UUID，将范围限定为该 Session、所属 Profile/Worker 及以该 Session 为目标的审计。
不存在或已被保留策略移除的 Session 返回 404。系统范围的各类记录按最新更新时间或发生时间排序，
每类最多 200 条，`truncated` 明确标记更多记录。输出包含采样起止时间，数据库和控制内存观察不承诺
原子一致；Worker metrics 同时保留实际 observedAt 和 Backend receivedAt，离线旧样本不改写为当前。

包中只选择版本、固定探测检查状态、数值指标、业务身份与状态、时间及审计关联。Worker 名称、主机名、
配置地址、Profile/Session 名称、网页标题、原始日志、原始错误、凭据、策略/脚本正文、context、
剪贴板和文件内容均不导出。版本仅接受数字版本格式，其余输出 null；失败码保留 REST 已知机器码及 Chrome 退出、Profile 数据缺失、Remote Tab 失败、Worker 重连状态缺失这四类固定 Runtime 码，
其他错误标记 `UNCLASSIFIED_ERROR`。审计不导出 changes、任意 metadata、操作者身份或来源 IP，
仅提取合法 UUID 的 targetId/requestId/commandId；系统设置等非 UUID 目标输出 null。

生成通过后记录 `system.diagnostics.generate`，关联本次请求 ID 和可选 Session ID。响应使用
`Cache-Control: no-store`。接口不调用 Worker 探测、不执行 CDP、不收集现场页面或上传遥测；
Gateway ID 用于人工关联，不代表本次主动探测 Gateway 健康。数据库不可用时无法认证和生成包，
应使用部署主机上的健康端点及标准运行日志排查，不能把空包解释为健康。

Portal 系统设置显示范围输入、采样时间、各类数量、截断提示与 JSON 预览；管理员显式下载到本机。
生成失败不保留可误认作新结果的旧包；请求 ID 用于查错，权限不足时阻止再次导出。内部资源 ID 和
运行时间仍属于内部诊断资料，导出后由管理员保管。没有额外常驻采集器或服务器归档目录。

Gateway 使用 Remote Tab 公开诊断 hook 输出固定的配对、协商、ICE restart、错误、断开和超时
事件。日志带配置 Gateway ID、经过校验的 Session UUIDv7/Viewer generation 及观察时间；机器码
取协调协议包的固定集合。票据、SDP、ICE 地址、任意错误正文和未知字段不会转发。连接认证前的
事件可能没有 Session 身份，不编造关联。可以将真实 `pair.completed`/`peer.disconnected` 与
诊断包的 Session/Gateway/代次对照；这些事件不是主动 Gateway 健康检查或完整网络 trace。
