# BrowShare 文档

BrowShare 的安装、使用、运维与开发指南。返回[项目首页](../README.md)。

## 使用与部署

| 我想要 | 阅读 |
| --- | --- |
| 在自己的服务器部署 | [容器部署](../deploy/docker/README.md) |
| 创建 Profile 并打开远程会话 | [第一条业务 Session](../deploy/docker/README.md#创建第一条业务-session) |
| 理解共享环境、权限与策略 | [产品介绍](design/01-product.md)、[身份与授权](design/04-auth-and-policy.md) |
| 配置网络、备份、恢复和保留策略 | [部署与运维](design/08-deployment-and-operations.md) |
| 了解下载收件箱与领取流程 | [下载保留与领取](design/11-download-retention.md) |
| 核对版本或报告安全问题 | [版本说明](../CHANGELOG.md)、[兼容性](../deploy/compatibility.json)、[安全策略](SECURITY.md) |

## 开发与扩展

- [本地开发](development.md)与[贡献指南](CONTRIBUTING.md)。
- [系统架构](design/02-architecture.md)与[领域模型](design/03-domain-model.md)。
- [Session 与 Viewer](design/05-session-and-viewer.md)、[Worker 与 Chrome Runtime](design/06-worker-runtime.md)。
- [接口与协议](design/07-protocols.md)、[页面设计](DESIGN.md)。
- [Remote Tab](https://github.com/x3zvawq/browshare-remote-tab)：引擎、Viewer 与嵌入接口。

## 维护者资料

- [测试与验收](design/09-testing-and-acceptance.md)、[实现进度](../PROGRESS.md)。
- [发行流程](RELEASING.md)、[实施计划](design/10-implementation-plan.md)。
- [Agent 工程约束](../AGENTS.md)。

历史验收保留对应版本和证明范围；安装、升级时应使用部署指南中列出的固定源码配对。
