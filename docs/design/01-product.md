# BrowShare product requirements

## 产品定义

BrowShare是一个开源、自托管、单租户的共享浏览器工作区平台。管理员维护持久 Google Chrome Profile，用户在获得授权后，从 Web Portal创建并使用独占 Tab Session。

平台解决的是“让多人受控地复用同一个浏览器登录环境”，不是给每个用户复制一份账号，也不是提供完整远程桌面。

> [!IMPORTANT]
> 同一 Profile中的所有 Tab共享 Cookie、LocalStorage、IndexedDB、Service Worker和网站账号。Tab Session只隔离画面、输入、文件和生命周期，不构成数据安全隔离。

## 产品目标

1. 管理员能够创建、登录、维护和停止持久 Profile。
2. 管理员能够控制哪些用户可看到并使用哪些 Profile。
3. 每个用户能够在获授权的 Profile中创建多个独占 Tab Session。
4. 用户通过网页获得接近本地浏览器的画面、键鼠、输入法、导航、文件和剪贴板体验。
5. 控制面、Worker和远程 Tab数据面保持清晰边界，能够按 Worker横向扩展。
6. 默认部署足够简单，单机 Compose即可启动；组件仍可拆到不同服务器。
7. Remote Tab能力作为独立开源项目供其他应用嵌入。

## 明确不做

- 不承诺规避目标网站风控、模拟单人行为或绕过服务条款。
- 不提供多租户 SaaS隔离。
- 不提供通用桌面远控、任意本地应用或完整浏览器窗口转发。
- 首版不支持跨 Worker复制、迁移或同步 Profile。
- 首版不提供 ProfileVersion、Golden Profile、Base Profile或每 Session克隆。
- 首版不提供本机麦克风到远端页面。
- 首版不提供普通用户 API Token、计费系统、邮件发送、MFA或控制面多副本高可用。
- 不根据 CPU或内存自动承诺 Worker容量；管理员决定并发上限。

## 用户与任务

| 用户          | 主要任务                                                   | 约束                         |
| ------------- | ---------------------------------------------------------- | ---------------------------- |
| 平台管理员    | 管理用户、权限、Profile、Proxy、Worker、策略和系统设置     | 只能执行已授权 Permission    |
| Profile维护者 | 独占进入 Profile完成登录、修复页面和发布脚本               | 维护期间普通 Session不可进入 |
| 普通成员      | 查看获授权 Profile，创建、继续、重命名和结束自己的 Session | 不能选择或覆盖 Profile Proxy |
| 部署者        | 配置域名、TLS、数据库、TURN、Worker和备份                  | 负责宿主机和目标网站合规     |
| Embedder      | 将 Remote Tab Viewer嵌入其他应用                           | 不获得 BrowShare业务能力     |

## 核心用户旅程

### 建立可用 Profile

1. 管理员注册 Worker并确认 Capability Probe通过。
2. 管理员创建 Profile，填写名称、备注、Worker、运行模式、Proxy、分组、授权和策略。
3. Worker创建空持久目录并按配置启动 Chrome。
4. 管理员进入独占维护模式，在目标网站完成登录。
5. 管理员测试 Navigation Policy和 Page Script并发布。
6. 管理员结束维护，Profile进入可用状态。

### 使用 Profile

1. 用户登录 Portal并查看可见 Profile。
2. 用户创建 Session；Backend原子检查 User、Profile和 Worker额度。
3. Worker创建主 Tab，绑定 Remote Tab捕获和 CDP控制。
4. Viewer使用短期 Ticket连接指定 Signaling Gateway。
5. WebRTC优先直连，失败时自动使用 TURN。
6. 用户关闭、被策略回收或发生不可恢复故障时，Worker只销毁该 Tab及临时文件。

### 维护运行中的 Profile

1. 管理员请求维护。
2. Backend拒绝新普通 Session，并要求现有普通 Session全部结束。
3. Profile进入 `MAINTAINING`，管理员独占操作 Chrome。
4. 维护允许保留必要附属窗口，普通 Session仍只拥有一个主 Tab。
5. 维护结束后 Profile返回正常运行模式。

## 功能范围

### Portal

侧边栏分为：

```text
使用
├── Profiles
└── 我的 Sessions

管理
├── Users
├── Profiles
├── Profile Groups
├── Proxies
├── Workers
├── 全部 Sessions
└── Audit Logs

系统
└── Settings
```

没有相应 Permission的菜单和动作不显示；Backend始终再次鉴权。

### 用户与注册

- 注册默认关闭；关闭时只有管理员能创建用户。
- 开放后使用邮箱和密码直接注册，无审核。
- 开放注册用户默认没有任何 Profile权限，默认并发为1。
- 首版不发送验证邮件；`require_email_verification`只有配置了邮件 Provider后才能开启。
- 用户可以修改密码、查看和撤销登录设备。
- 管理员可以启用、禁用、软删除用户并重置密码。
- 禁用、删除或密码重置立即撤销相关 Portal Session、Viewer Ticket和 Tab Session。

### Profile可见性

可见性取以下路径的并集：

- Profile直接授权给 User。
- Profile加入一个或多个 Profile Group，User加入这些 Group。
- Profile标记为所有已启用用户可见。

Group不嵌套、不提供显式 deny。禁用 Group只取消该路径，不影响其他授权。

### Profile运行

运行模式：

- `ALWAYS_ON`：无人使用时仍保持 Runtime；故障后指数退避重启。
- `ON_DEMAND`：首个 Session触发启动；空闲后按策略停止。
- `MANUAL`：只由管理员显式启动和停止；故障后等待处理。

Profile业务状态与运行状态分离。禁用 Profile立即阻止新 Session，并按管理员选择结束现有 Session或等待自然结束。

### Session

- 用户可以在同一 Profile创建多个 Session。
- 每个 Session独占一个远端主 Tab。
- 同一 Session只允许一个活动 Viewer。
- 第二个 Viewer连接时必须确认接管。
- Profile卡片和“我的 Sessions”展示可继续的 Session。
- 用户可重命名；未重命名时标题跟随远端网页。
- 达到并发限制立即返回具体限制来源，不排队。

### Viewer能力

- Tab视频和音频。
- 鼠标、滚轮、拖拽、键盘、快捷键、中文 IME和 Emoji。
- URL导航、前进、后退和刷新。
- 文本及图片剪贴板。
- 文件选择、拖入、粘贴上传和下载领取。
- 全屏、画质、音量、连接诊断和错误状态。
- 新窗口 URL的本机打开确认。
- Page Script触发的结构化 Notice。

## 默认限制

| 设置                           | 默认值                     |
| ------------------------------ | -------------------------- |
| 普通新用户最大活动 Session     | 2                          |
| 开放注册新用户最大活动 Session | 1                          |
| Profile最大普通 Session        | 4                          |
| Worker最大活动 Tab             | 4                          |
| Viewer Ticket有效期            | 60秒，单次使用             |
| Session授权租约                | 10分钟                     |
| Viewer断线回连期               | 5分钟                      |
| Viewer失焦暂停                 | `WHEN_UNFOCUSED`，15秒宽限 |
| 默认画质目标                   | 1280×720，30 FPS           |
| 默认画质上限                   | 1920×1080，60 FPS          |
| 单文件上传                     | 50 MiB                     |
| 单次文件数                     | 10                         |
| Session临时文件总量            | 200 MiB                    |
| 下载完成保留                   | 30分钟                     |
| Session结束后未领取文件        | 10分钟                     |

所有并发限制允许设为 `null`表示不限制。画质上限是允许值，不是性能承诺。

## 成功标准

- 管理员能够在全新 all-in-one部署中完成 Worker注册、Profile登录和用户授权。
- 用户无需安装本地软件即可进入独占 Tab，并完成输入、导航、上传、下载和本地打开。
- 四个并发 Tab不会串画面、串输入、串文件或相互影响生命周期。
- 控制面短暂不可用时，已建立连接在有效租约内继续；恢复后自动对账。
- Proxy故障不会泄漏为 Direct出口。
- 所有授权撤销均能在规定时间内终止 Portal、Viewer和远端 Tab访问。
- 部署者能从文档理解数据边界、备份范围和无法承诺的第三方兼容性。
