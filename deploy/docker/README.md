# Container deployment

## 控制面与本地 HTTPS

`Dockerfile` 提供 `backend`、`migrator`、`gateway`、`portal` 和 `worker-chrome` 目标。
Backend 与 migrator 使用同一生产依赖及 SQL migration 集合；Portal 包含协调版本 Remote Tab Viewer，
通过 Nginx 提供静态页面、SPA 路由、REST、SSE 和 WSS。运行时配置与 Secret 不进入镜像。

以下源码安装路径要求 Linux amd64、Git、Docker Engine/Compose v2/Buildx、Node.js 24、pnpm 10.28.2 与 OpenSSL。
以下固定源码版本分别通过托管 CI，并已完成 Portal 配对镜像构建和部署验证；不能只凭两仓库的相同版本号混用源码：

| 仓库 | 固定提交 | 托管验证 |
| --- | --- | --- |
| BrowShare | `d13cd9e38b3851e5adf2ddf3df0651fda05aa712` | [CI](https://github.com/x3zvawq/browshare/actions/runs/34233182261) |
| Remote Tab | `81ef000692a1bf41b9e23428e94431219a6407f6` | [CI](https://github.com/x3zvawq/browshare-remote-tab/actions/runs/34232402173) |

在新的工作目录获取公开源码；Remote Tab 的本地目录别名与 GitHub 仓库名不同，以下命令已显式指定：

```bash
git clone https://github.com/x3zvawq/browshare.git browshare
git clone https://github.com/x3zvawq/browshare-remote-tab.git browshare-tab-remote
git -C browshare checkout --detach d13cd9e38b3851e5adf2ddf3df0651fda05aa712
git -C browshare-tab-remote checkout --detach 81ef000692a1bf41b9e23428e94431219a6407f6
cd browshare
```

Remote Tab 默认位于相邻 `../browshare-tab-remote`，其他位置设置
`BROWSHARE_REMOTE_TAB_SOURCE`。两仓库分别运行 `pnpm install --frozen-lockfile`；签名构建也需要 Remote Tab 的依赖。
本指南从源码构建镜像，后续 Compose 使用生成的本地镜像标签。
小内存宿主应先按[受限构建器说明](../../docs/RELEASING.md#带-sbom-和来源记录的-oci-候选)
限制构建并发与内存，并将构建和 Chrome 业务运行分时安排。
本地构建入口使用 `docker buildx build --load`，将结果显式导入 Docker 镜像库，供后续 Compose
使用；切换到独立 `docker-container` 构建器时也不能省略该导入步骤。

从 BrowShare 仓库根目录构建控制面镜像，并生成独立的开发配置：

```bash
pnpm control:images:build local
pnpm deployment:prepare:development --output ./tmp/development-deployment
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml config --quiet
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml up -d
```

生成器需要 Node.js 24 与 OpenSSL，默认域名 `browshare.test`、HTTPS 端口 `8443`、控制端口 `8445`，
只绑定宿主 `127.0.0.1`。客户端 hosts 文件需把该域名指向 Docker 宿主；浏览器需信任输出目录的
`tls/control-tls-ca-certificate.pem`。远程开发可转发这两个端口；不要关闭 TLS 证书校验。
可以通过 `--hostname`、`--https-port`、`--control-port`、`--project`、`--tag` 指定隔离环境，
只有显式 `--bind-address 0.0.0.0` 才发布到宿主所有接口。

生成器创建两个独立 CA：Worker 客户端身份 CA，以及开发 HTTPS/控制服务端 CA。它生成随机数据库密码、
Cookie Secret、Gateway Secret 和一次性初始化 Token，不输出秘密值，并拒绝覆盖现有目录。
Linux root 执行时将运行期私密文件交给 UID/GID `1000:1000`；普通用户执行时 Compose 使用当前 UID/GID。
PostgreSQL 密码文件为 `0444`，宿主父目录保持 `0700`，且只把该单个文件挂入 PostgreSQL；其余 Secret 为
`0600`。Compose 文件型 Secret 不负责重新设置宿主权限，迁移配置目录时必须保留这些权限与所有者。

首次启动先等待 PostgreSQL healthy，再运行一次性 migrator，成功退出后 Backend 才能启动。
打开 `https://browshare.test:8443/setup`，使用 `secrets/bootstrap_token` 中的 Token 创建首位管理员。
Token 通过部署者自己的安全终端读取；不要发送到日志或保存为浏览器 URL。数据库初始化完成后，该入口关闭，
继续保留 Token 也不能重新初始化或重置管理员。

`compose.control.yml` 提供 PostgreSQL、Backend、Portal、Gateway 和独立 migrator，
Worker、TURN 和文件入口通过下方 `compose.all-in-one.yml` 叠加。开发证书默认 30 天，不能作为公网受信发布证书。

Portal 通过运行期挂载的 `ingress.conf` 配置入口。当前模板公开 HTTPS 和独立 mTLS 控制端口，
PostgreSQL 不映射宿主端口，Gateway 的认证健康/指标入口 `8444` 只在 Compose 网络内监听。
SSE 使用实际 `/api/v1/.../events` 路由，反向代理禁用缓冲；静态 `/assets/` 缺失返回 404，
业务页面路由回到 `index.html`。替换 TLS 文件时必须重新加载 Portal 并重启读取证书的 Backend。

检查与停止控制面：

```bash
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml ps -a
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml down
```

`down` 保留数据库卷。已使用环境不要重新运行生成器、删除 Secret 或使用 `down -v`；
升级先备份数据库与对应 Worker 数据，再用新版本 migrator 显式迁移，不能用重建空卷代替升级。

## All-in-one Worker、TURN 和文件入口

Linux 宿主先完成控制面初始化，在管理界面签发 Worker Enrollment Token，并把 Token 写入部署目录外的
私密临时文件。准备协调版本的签名 CRX3；Extension ID 必须来自同一签名密钥。再执行：

```bash
pnpm worker:image:build browshare/worker:local
node tools/prepare-worker-deployment.mjs \
  --directory ./tmp/development-deployment \
  --crx /absolute/path/browshare-remote-tab-0.1.25.crx \
  --extension-id <signed-extension-id> \
  --enrollment-token-file /private/path/enrollment-token \
  --image browshare/worker:local
node tools/prepare-turn-deployment.mjs \
  --directory ./tmp/development-deployment \
  --public-address <server-public-ipv4> --hostname turn.example.com \
  --certificate /private/path/turn-fullchain.pem \
  --private-key /private/path/turn-key.pem
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml -f deploy/docker/compose.all-in-one.yml \
  --profile worker --profile turn config --quiet
docker compose --env-file ./tmp/development-deployment/.env \
  -f deploy/docker/compose.control.yml -f deploy/docker/compose.all-in-one.yml \
  --profile worker --profile turn up -d
```

两个准备工具拒绝覆盖现有 Worker/TURN 设置，不输出 Token 或 Secret。Worker 保持镜像内 UID 1000，
独立持久卷保存身份、Profile、临时文件与 Managed Policy；仅把签名 CRX 文件挂入容器，不挂载签名私钥目录。
Chrome 使用专用 seccomp 与 sandbox，保留 `SYS_CHROOT` 以允许该 seccomp 配置中的 namespace chroot；
非 root 进程不获取宿主 root 权限。根文件系统只读；`/home/node` 为有界 tmpfs，供启动器及 crash handler
写入用户元数据，浏览器业务数据仍在 Profile 卷。Worker CLI 每次启动生成新的 Extension generation，容器重启
不需人工改 generation。首次注册成功后，从 `worker.env` 删除 `BROWSHARE_WORKER_ENROLLMENT_TOKEN_FILE`
行，再删除 `worker-enrollment/token` 及原始 Token 临时文件；重建容器后使用身份卷中的证书。

Portal 用 Nginx stream 转发控制端口到 Backend，TLS 在 Backend 端终止并验证 Worker 客户端证书；该端口也
承载 Worker 文件授权元数据请求。文件领取默认使用 `https://<hostname>:8446/claim` 独立 origin，
`--files-port` 可覆盖端口。入口只开放精确 `/claim`，向 Worker 转发时去掉 Cookie/Authorization，
保留 POST body 中的短期领取 Token。文件字节直接从 Worker 返回，不流经 Backend/Gateway。
客户端必须能连接该端口并信任 HTTPS 证书；远程开发时也需要单独转发文件端口。
修改域名或广告端口时，不能只改 `.env`：同时更新 `backend.env` 的 allowed origins/Worker control URL、
`gateway.env` 的 Backend/public endpoint、`secrets/gateway_registry` 的 public endpoint/health URL，以及
`worker.env` 的 Backend URL、下载 endpoint/Portal origin；独立节点还需同步各自对应配置和 DNS。
为新域名准备匹配的 TLS 证书与信任链后，再运行
`node tools/render-deployment-ingress.mjs --directory <配置目录>` 重写 Nginx 配置，并通过 Compose 重建
读取这些配置的服务。该工具只渲染 Nginx，不自动迁移业务配置；已有 Worker identity 也保存注册时的控制地址，
地址迁移应保留原控制入口可达，不能仅凭改环境变量就假定旧身份已迁移。

TURN 工具面向公网 IPv4 直接配置在该 Linux 宿主上的部署；NAT/多网卡场景需按实际映射调整 coturn 配置。
广告域名必须解析到该服务器，TLS 证书需覆盖该域名并受到客户端信任。coturn 使用 host network，默认开放
3478 UDP/TCP、5349 TCP/TLS、49160–49223 UDP relay；可用 `--port`、`--tls-port`、
`--relay-min-port`、`--relay-max-port` 调整。宿主和云防火墙都需允许这些端口。`no-tcp-relay`
禁止 TCP relay allocation，不禁用客户端通过 TCP/TLS 建立 WebRTC 的 UDP relay。

Gateway 从单独 Secret 文件按每次授权配对签发短期 TURN 凭据；coturn 配置中的共享 Secret 与之相同。
Gateway 只挂载共享 Secret，coturn 只挂载其配置与 TLS 文件。官方 coturn 镜像以 UID 65534 运行，
保留 `NET_BIND_SERVICE` 以执行带文件 capability 的二进制，同时使用只读根文件系统及 `no-new-privileges`。
宿主 Secret 父目录仍为 0700，文件权限和所有者必须随迁移保留。修改 Secret/TLS 后需要重建读取它们的服务。

## 创建第一条业务 Session

Worker 容器启动后，在管理界面确认节点已完成能力探测和对账、可调度且容量充足，再进行业务验收：

Node 健康探测与 Control 使用的开发 CA 不会自动进入远端 Chrome 的业务站点信任库。
HTTPS 业务站点必须提供 Chrome 信任的证书；健康检查成功不等于业务页面加载成功。
隔离演练可使用部署者明确提供的 HTTP 测试页与普通、非敏感的持久 Cookie，并如实记录这一范围。

1. 在 Profile 管理创建一个启用的 Profile，选择刚注册的 Worker、Direct 与 ON_DEMAND。为独立演练
   明确填写 Worker 可以正常访问的 HTTPS 健康检查地址；测试域名使用部署者自己的可信证书及 DNS。
2. 为该 Profile 授予测试用户访问权（管理员也不自动取得普通 Session 的 Profile 授权）；单用户隔离
   演练也可显式选择“全部启用用户可见”。不要把正式共享环境的 Profile 为方便测试而扩大可见范围。
3. 在 Profile 导航策略中保存并发布允许演练目标 URL 的规则，确认生效版本；仅保存草稿不会改变普通
   Session。目标页面应由部署者提供，包含可交互输入、持久 Cookie/localStorage 和可下载附件，便于
   后续恢复核对。不要把仅有浏览器错误页的解码帧数当作站点访问成功。
4. 以获授权用户进入工作区，创建 Session 并打开 Viewer；ON_DEMAND 会启动 Runtime，MANUAL 则需管理员
   先 START。确认真实目标内容、输入回显及连续媒体；测试下载从 Portal 收件箱经独立文件 origin 领取。
5. 记录 Profile/Worker ID、实际 Gateway 归属、目标站点持久数据与下载结果。结束 Session，确认终态及
   容量释放，再进行备份。多用户授权、代理、策略和媒体完整边界由各自验收覆盖，这不是一次 smoke 的结论。

备份、升级及另一空环境恢复按 [部署与恢复](../../docs/design/08-deployment-and-operations.md#持久数据)
执行。应先完成可恢复的备份，再升级；恢复目标先只启动 PostgreSQL，禁止空库自动 migrator 抢先建表。

## Worker image

本目录定义BrowShare Worker的`linux/amd64`容器构建和Chrome sandbox配置。镜像包含
Worker应用、固定Google Chrome Stable及必要系统库。签名Extension作为部署者生成的只读release
挂载提供，运行期Managed Policy由Worker生成。镜像从相邻Remote Tab源码构建并内置协调Core/Protocol及其
生产依赖。节点能力与就绪状态可通过管理界面查看。

## 固定兼容集

[`../compatibility.json`](../compatibility.json)是机器可读的版本入口。构建固定：

- Node.js基础镜像标签和OCI digest。
- Google Chrome Stable Debian包版本、下载URL和SHA-256。
- Worker应用版本和预期Remote Tab版本。
- Chrome专用seccomp profile的内容SHA-256及上游来源。

构建时会先校验Chrome `.deb`摘要，再交给`apt`解析运行依赖；安装完成后再次核对`dpkg`版本。
Google安装脚本加入的APT source、keyring和cron入口会从最终镜像移除，运行中不会自行更新Chrome。
Worker 最终镜像不包含 npm、Corepack、pnpm 或 Yarn。

基础镜像由digest固定，但Debian安全更新和Chrome依赖从在线仓库解析，因此不同日期构建的OS包层
不承诺字节级一致。应用兼容集不会因此静默漂移；正式发布仍应保存最终镜像digest和SBOM。

## 构建与实测

宿主需要Docker Buildx。默认从相邻的`../browshare-tab-remote`构建Remote Tab依赖；不同位置可设置
`BROWSHARE_REMOTE_TAB_SOURCE=/absolute/path/to/browshare-tab-remote`。构建通过具名源码context传入，
不复制源码到BrowShare仓库，也不要求先发布npm包。构建在安装前核对Core/Protocol版本与本仓库兼容表，
两份源码各自用冻结lockfile安装；最终镜像只保留两个项目的生产导出物和依赖。

Backend、Gateway 和 Worker 镜像内置 Docker `HEALTHCHECK`，默认探测 `3400/health/ready`、
`3482/health/ready` 和 `3410/health/live`。探针读取各服务实际端口配置，Gateway 同时读取
`BROWSHARE_GATEWAY_SECRET` 或对应 `_FILE` 完成认证，不把 Secret 或响应正文写入探针日志。健康探测不通过时只表示
该容器不应接收新流量，不能代替 Backend 的 Worker 对账或 Chrome/Profile 业务状态检查。

启动 Worker 前可运行宿主预检：

```bash
pnpm worker:host:check -- --data-root /var/lib/browshare --min-free-bytes 536870912
```

预检确认 Linux/x64、Docker Engine、数据目录读写执行权限和 `/dev/shm`；它不会修改宿主机，失败时
应先修复宿主条件。生产容器还应由编排层设置明确的 CPU、内存和 PID 上限，避免 Chrome 或异常任务
耗尽宿主资源；这些限制属于部署环境参数，不由镜像默认擅自覆盖。

仓库提供了只针对 Worker 的可复用模板
[`compose.worker.example.yml`](./compose.worker.example.yml)。它要求显式传入固定 digest 镜像、0600
环境文件和五个宿主目录，并默认限制为 4 CPU、4 GiB 内存和 1024 个 PID；部署者可按 Chrome 并发量
调整，但必须保留明确上限。模板不是完整 All-in-one Compose，Backend、PostgreSQL、Gateway 和
TURN 仍需由部署拓扑提供。


```bash
pnpm compatibility:check
pnpm worker:image:build
pnpm worker:image:verify
```

`worker:image:verify`必须在支持`linux/amd64`容器的Linux宿主机运行。它验证镜像架构、非root用户、
PID 1入口、固定版本、目录权限、工具链裁剪和自动更新入口清理，并使用专用seccomp profile启动一只
不带`--no-sandbox`的headless Chrome，实际读取CDP `/json/version`和`/json/list`。

验证其他tag时显式传入：

```bash
pnpm worker:image:verify -- browshare/worker:candidate
```

完整Worker部署还必须至少提供：

```yaml
security_opt:
  - seccomp=./deploy/docker/chrome-seccomp.json
shm_size: 1gb
```

并分别挂载`/var/lib/browshare/identity`、`/var/lib/browshare/profiles`和
`/var/lib/browshare/session-temp`，还要把签名CRX目录只读挂载到
`/opt/browshare/extension-release`。不要挂载Docker Socket，不要使用`privileged`、`SYS_ADMIN`、
`seccomp=unconfined`或Chrome的`--no-sandbox`。挂载卷会覆盖镜像内的目录权限，部署者必须确保容器
内UID/GID `1000:1000`可以访问，identity目录及其中的凭据不得对其他用户开放。

## 签名Extension与Managed Policy

Extension源码、构建和CRX3签名由独立的`browshare-tab-remote`仓库负责。首次部署时生成一把长期
RSA私钥并保存在Worker之外；后续版本继续使用同一私钥，才能保持Extension ID不变。不要把私钥放入
CRX release目录、容器镜像、环境变量、日志或源码仓库。

在相邻的`browshare-tab-remote`工作区构建当前协调版本时，可以使用：

```bash
pnpm --filter @browshare/remote-tab-extension build
pnpm --filter @browshare/remote-tab-extension-signing build
node tools/extension-signing/dist/cli.mjs generate-key \
  --key tmp/extension-signing/private.pem
node tools/extension-signing/dist/cli.mjs build \
  --source packages/extension/build/chrome \
  --key tmp/extension-signing/private.pem \
  --out tmp/browshare-worker-extension-release \
  --base-url http://127.0.0.1:9225/
```

首次部署才运行`generate-key`；升级直接复用受保护的原私钥。`build`输出JSON中的Extension ID、版本和
SHA-256是Worker配置与发布记录的输入。

签名工具返回的`extensionId`和`sha256`分别配置为
`BROWSHARE_REMOTE_TAB_EXTENSION_ID`与`BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256`，并把产物命名为
`browshare-remote-tab-<version>.crx`。`deploy/compatibility.json`固定当前版本和文件名；release目录
只需要包含CRX，不需要复制工具生成的公网`updates.xml`或策略模板。Worker会：

1. 启动Extension WebSocket loopback。
2. 校验挂载CRX的magic、CRX3格式和配置摘要，错误立即停止启动。
3. 在`127.0.0.1`或`::1`启动更新服务；Chrome附加的更新查询参数不会改变路由目标。
4. 以`0600`原子写入包含固定ID、update URL、loopback URL、Secret和Generation的策略文件。
5. 由镜像内root-owned符号链接让Google Chrome读取策略，但Worker始终以UID 1000运行。

普通升级使用同一私钥签出更高Chrome Extension版本，同时更新兼容清单、文件名、期望版本和SHA，
然后Drain Worker并更换release挂载后重启。更换私钥会改变Extension ID，属于需要迁移所有策略和
Profile的密钥轮换，不是普通版本升级。

## Seccomp来源与边界

[`chrome-seccomp.json`](chrome-seccomp.json)派生自Moby默认profile：

- Repository：`https://github.com/moby/profiles`
- Commit：`61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31`
- Source：`seccomp/default.json`

它保留上游`SCMP_ACT_ERRNO`默认拒绝和其余allow规则，只把`clone`、`clone3`、`setns`、`unshare`
改为无条件允许，使非root Chrome可以创建内部sandbox namespace，而无需授予容器
`CAP_SYS_ADMIN`。更新profile时必须重新审查上游差异、更新兼容清单摘要并执行真实Chrome验证。

若宿主Docker默认seccomp导致`Failed to move to new namespace: Operation not permitted`，可以在隔离
测试中短暂使用`seccomp=unconfined`确认根因；它不是生产修复。生产应使用本目录的专用profile，
如果仍失败则让Worker保持不可调度并报告宿主兼容错误。

## 发布与许可证

仓库源码使用MIT许可证，但Google Chrome不是MIT软件。Dockerfile只允许部署者在本地从Google下载
并校验官方包；在确认Google分发条款前，不发布包含Chrome的公共GHCR镜像或源码Release附件。

Worker先启动Extension loopback和更新服务，再自行创建临时Chrome完成能力探测。探测结束后Chrome与
临时Profile一起清理，不保留专用探测Chrome进程，不配置固定CDP端口。扩展首次强制安装依赖0.1.15的
Managed Storage到达事件处理；旧0.1.14候选不包含该冷启动修复。

Worker生产包还包含`dist/profile-chrome-supervisor.mjs`。它在Worker异常退出时根据IPC断开信号
清理自己启动的flock/Chrome进程组；无需另行安装守护服务。调试时保留镜像的tini入口，例如
`docker run ... IMAGE node /qa/verify.mjs`，不要用`--entrypoint node`绕过子进程回收器。

## 独立 Gateway

[`compose.gateway.yml`](./compose.gateway.yml) 是独立 Compose 项目，包含 Gateway 与 TLS ingress，
不依赖控制面项目的容器名、网络或数据库卷。它复用协调版本 Gateway 镜像和 Portal 的 Nginx 镜像；
挂载的 [`gateway-ingress.conf.template`](./gateway-ingress.conf.template) 只开放 `/signal/`、
`/health/ready` 与 `/metrics`，其他路径返回 404，不提供 Portal 页面或 Backend API。
健康与指标请求由 Gateway 校验 Bearer，Nginx 不持有或自动补充 Gateway Secret。

先准备 Gateway 对外域名的完整 TLS 证书链和私钥、Backend HTTPS 的可信 CA 文件，以及现有 coturn
的动态共享 Secret。该模板不创建 TURN 容器，也不生成新的 TURN Secret；复制的 Secret 必须与目标
coturn 一致。使用 Node.js 24 生成一个全新的私密目录：

```bash
node tools/prepare-gateway-deployment.mjs \
  --output ./tmp/gateway-deployment \
  --hostname gateway.example.com --https-port 8443 \
  --backend-url https://browshare.example.com \
  --backend-ca-file /private/path/backend-ca-bundle.pem \
  --certificate /private/path/gateway-fullchain.pem \
  --private-key /private/path/gateway-key.pem \
  --gateway-image browshare/gateway:local \
  --ingress-image browshare/portal:local \
  --turn-secret-file /private/path/turn-shared-secret \
  --turn-urls 'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp' \
  --project browshare-gateway --bind-address 0.0.0.0
```

生成器拒绝覆盖已有目录，校验证书当前有效、域名/IP SAN 与私钥匹配；不会关闭运行期 TLS 校验。
默认仅绑定 `127.0.0.1`，公网部署需显式选择 `0.0.0.0` 并放行 HTTPS 端口。
支持 `--https-port 443`：公开地址与宿主端口使用 443，非 root Nginx 在容器内监听 8443；
其他允许端口的宿主与容器监听值相同。`--turn-ttl` 默认 3600 秒（60–86400），
`--ice-policy` 默认 `all`，可选 `relay`；TURN 密码按每次配对动态签发，
共享 Secret 仅通过 `TURN_SHARED_SECRET_FILE` 挂载读取。Gateway 和 ingress 默认分别限制为
1 CPU/512 MiB 与 1 CPU/256 MiB，可通过 `.env` 中对应 `BROWSHARE_GATEWAY_*`、
`BROWSHARE_INGRESS_*` 资源变量调整。Gateway 的 3481/3482 和 Nginx liveness 8080 不发布到宿主。

输出的 `secrets/gateway_registry.json` 是仅含这台 Gateway 的注册数组，包含 Secret，不能打印或
公开分发。部署者应在私密文件中将该记录合并到 Backend 已配置的 `BROWSHARE_GATEWAYS_JSON_FILE`
数组，保留其他 Gateway，并确认 ID 和公开 WSS 地址没有重复；不要用单条输出覆盖现有注册表。
Backend 没有动态注册 API，修改后需重启或重建 Backend。私有 CA 场景还需让 Backend 信任此
Gateway 入口的 CA；已有 `NODE_EXTRA_CA_CERTS` 应指向同时包含所需 CA 的 PEM bundle，不能
为了新增 Gateway 丢弃其他入口的信任链。Worker 与 Viewer 也必须信任并能解析、访问该公开 WSS
地址；独立网络上的 Gateway 必须能解析并访问 `--backend-url`，不能沿用只有控制面网络可解析的
容器别名。开发环境需要按实际网络设置 DNS/hosts，不能以禁用 TLS 校验替代。

注册与信任配置完成后启动：

```bash
docker compose --env-file ./tmp/gateway-deployment/.env \
  -f deploy/docker/compose.gateway.yml config --quiet
docker compose --env-file ./tmp/gateway-deployment/.env \
  -f deploy/docker/compose.gateway.yml up -d
docker compose --env-file ./tmp/gateway-deployment/.env \
  -f deploy/docker/compose.gateway.yml ps
```

注册缺失、Secret 不一致或 Backend TLS/网络不可达时，Gateway readiness 不会通过；ingress 的
liveness 只证明 Nginx 正在运行。实际接入应验证匿名 health/metrics 被拒绝、Backend 的认证健康
探测成功，再创建真实 Session 并让 Worker 与 Viewer 在新 Gateway 完成配对和媒体连接。
仅 WSS 升级成功不证明业务授权、配对或 WebRTC。多 Gateway 注册表按顺序选择可用节点，若保留
原 Gateway，验收时应确认新 Session 实际使用的 `gatewayId`，不能只看某个 Gateway healthy。

生成目录与 `secrets/`、`tls/` 目录为 0700，文件为 0600。Linux root 执行时供容器读取的文件
归 UID/GID 1000；普通用户执行时 Compose 使用当前 UID/GID。迁移时保留权限和所有者，不将整个
秘密目录挂入容器；Nginx 只挂载自身证书/私钥，Gateway 只挂载自身 Secret、Backend CA 和 TURN
Secret。更换配置或证书后重建对应容器，不能重新运行生成器重置 Gateway ID。停止独立项目用同一
配置执行 `down`，不会停止控制面或 Worker；若永久移除节点，还需在 Backend 私密注册表中移除
对应记录并重启 Backend。

## 独立 Worker 与文件入口

`compose.worker.yml` 在独立 Compose 项目和网络运行 Worker 与文件 HTTPS ingress。它与 All-in-one
通过 `compose.worker-runtime.yml` 复用 Chrome sandbox、只读目录、资源限制和数据卷配置；无需加入
控制面的 Docker 网络。每个节点使用不同项目名、身份卷及文件入口，不把同一身份卷挂给两台 Worker。

```bash
node tools/prepare-worker-deployment.mjs \
  --directory /private/deployment/worker-a \
  --backend-url https://browshare.example.com \
  --files-origin https://files-a.example.com \
  --server-ca /private/ca/server-trust-bundle.pem \
  --files-certificate /private/tls/files-a-fullchain.pem \
  --files-private-key /private/tls/files-a-key.pem \
  --project browshare-worker-a --bind-address 0.0.0.0 \
  --image browshare/worker:local --ingress-image browshare/portal:local \
  --crx /private/release/browshare-remote-tab-0.1.25.crx \
  --extension-id <signed-extension-id> \
  --enrollment-token-file /private/enrollment-token
docker compose --env-file /private/deployment/worker-a/.env \
  -f deploy/docker/compose.worker.yml config --quiet
docker compose --env-file /private/deployment/worker-a/.env \
  -f deploy/docker/compose.worker.yml up -d
```

文件 origin 的公网端口映射到容器内 8446；`--files-port` 可修改内部非特权端口。例如默认 HTTPS
origin 使用宿主 443，不要求非 root Nginx 直接监听 443。若 Portal 与 Backend API 使用不同 origin，
显式传入 `--portal-origin`，下载领取的来源检查以 Portal 为准。

`--server-ca` 是 Worker 对 Backend HTTPS、控制 WSS 和 Gateway WSS 使用的服务端信任 bundle，
可以包含多个 PEM CA；不要传入 Worker 客户端身份 CA 的私钥。部署不复制数据库、Session Secret、
Gateway Secret 或客户端证书签发私钥。注册完成后按 All-in-one 步骤移除 Enrollment Token 配置及文件，
再重建 Worker 验证持久身份。Profile 固定归属节点；停止一台 Worker 不会迁移其 Profile 到另一台。

跨主机需保证 Worker 能解析并连接 Backend 返回的控制 URL、Gateway 公网 URL 及 Profile 上游。
Viewer 必须能连接该 Worker 广告的文件 origin。Gateway、Worker 和 Backend 使用真实 DNS 或明确的
宿主解析配置；只在一个 Compose 网络中生效的服务名或别名不能当作跨节点地址。

## 独立 TURN

[`compose.turn.yml`](./compose.turn.yml) 只运行 coturn，不需要控制面、Worker 或 Gateway 的配置目录。
它与 All-in-one 的 TURN 服务通过 [`compose.turn-runtime.yml`](./compose.turn-runtime.yml) 复用同一
固定镜像 digest、非 root 用户、能力边界和资源限制。独立模式面向公网 IPv4 直接配置在 Linux 宿主上
的节点；NAT 或多网卡映射仍需按实际网络调整 coturn 配置。

准备覆盖广告域名的完整证书链与私钥，并创建一个全新的私密输出目录：

```bash
node tools/prepare-turn-deployment.mjs \
  --mode standalone --project browshare-turn \
  --directory ./tmp/turn-deployment \
  --public-address <turn-server-public-ipv4> --hostname turn.example.com \
  --certificate /private/path/turn-fullchain.pem \
  --private-key /private/path/turn-key.pem
docker compose --env-file ./tmp/turn-deployment/.env \
  -f deploy/docker/compose.turn.yml config --quiet
docker compose --env-file ./tmp/turn-deployment/.env \
  -f deploy/docker/compose.turn.yml up -d
```

省略 `--mode` 时仍使用原来的 `integrated` 模式：读取已有控制面部署目录并更新其 Gateway TURN 配置。
`standalone` 模式不读取或修改其他部署，只生成 `.env`、`turn/` 中的 TLS 文件，以及 `secrets/` 中的
coturn 配置和共享 Secret；拒绝覆盖已有目录。命令输出公开 TURN URLs 与 Secret 文件路径，不输出内容。
原始目录和秘密子目录保持 0700；Linux root 执行时，coturn 配置/证书/私钥为 UID 65534 所有的 0600
文件，共享 Secret 为执行用户所有的 0600 文件。非 root 生成时，供 UID 65534 容器读取的单独文件使用
0444，但宿主父目录仍为 0700；迁移配置时应保留权限和所有者。不要把整个秘密目录挂入容器。

默认端口为 3478 UDP/TCP、5349 TCP/TLS，UDP relay 范围为 49160–49223。可通过 `--port`、
`--tls-port`、`--relay-min-port`、`--relay-max-port` 指定。容器使用 host network，配置监听宿主
所有接口，Docker 不做端口转换；宿主和云防火墙都需开放选定端口。独立模式额外允许
`--tls-port 443`，用于该监听地址没有其他 443 服务的 TURN 节点；不能与同地址的 HTTPS 服务直接共占
端口，也不能通过普通 HTTP 反向代理转发 TURN TLS。广告域名必须能被 Worker 与 Viewer 正确解析，
TLS 证书也必须受到客户端信任。

把 `secrets/turn_shared_secret` 通过部署者的私密传输渠道提供给 Gateway 节点，并在独立 Gateway
生成器中传入 `--turn-secret-file` 和匹配的 `--turn-urls`；若 Gateway 已存在，则在其受保护配置中
设置 `TURN_SHARED_SECRET_FILE` 与 `BROWSHARE_GATEWAY_TURN_URLS`，保持与 coturn 一致后重建 Gateway。
不要把 Secret 放进命令参数、日志、镜像或源码，也不要重新运行生成器替代一次明确的 Secret 轮换。
只有 Gateway 与 coturn 需要共享 Secret，浏览器获取的是按配对签发的短期凭据。节点时钟须保持同步。

容器 `Up` 不能证明 TURN 已可用。正式接入需用实际 Gateway 签发的凭据验证 Allocate/Refresh，
并通过真实 Viewer 的 ICE 统计确认选中 relay candidate、对应 TCP/UDP/TLS transport 和解码媒体。
TCP/TLS 控制交互成功不能代替浏览器媒体证明。停止或重建该节点会释放现有内存 allocation，可能中断
媒体；停止独立项目时，用与启动相同的 `--env-file` 和 `-f` 参数执行 `docker compose ... down`，
不会停止控制面、Gateway 或 Worker。
