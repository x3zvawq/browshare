# 本地开发

所有命令从 BrowShare 仓库根目录执行。准备 Node.js 24.12.0、pnpm 10.28.2、OpenSSL 和 PostgreSQL 17，先创建PostgreSQL数据库、执行显式migration，并生成只用于 Worker客户端证书的自签 CA：

```bash
pnpm install --frozen-lockfile
pnpm --dir ../browshare-tab-remote install --frozen-lockfile
pnpm build:shared
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


## 开发 Worker 与 Viewer

完整 Chrome 运行时使用 Linux amd64。先按[容器部署](../deploy/docker/README.md)准备 Worker、固定签名 Extension 和所需网络入口；macOS 上可以开发 Portal 和 Backend，并连接 Linux 测试节点。

Portal 构建会使用相邻 `browshare-tab-remote` 的公共 Viewer 包，`pnpm dev:portal` 会自动准备该包并启动开发服务；其他源码目录通过 `BROWSHARE_REMOTE_TAB_SOURCE` 指定。

## 提交前验证

```bash
pnpm check
```

按修改范围选择必要验证：页面变更检查实际页面，协议和 Chrome 行为检查真实连接，数据库变更检查显式 migration。完整验收范围见[测试与验收](design/09-testing-and-acceptance.md)，提交说明见[贡献指南](CONTRIBUTING.md)。
