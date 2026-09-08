# Contributing to BrowShare

感谢参与 BrowShare。交付以实际行为、设计契约和必要验证一致为准；当前实现状态见 [PROGRESS.md](../PROGRESS.md)。行为、状态或公共接口变化在同一修改中同步相关设计。

## 开始贡献

- 阅读根目录 [Agent guide](../AGENTS.md) 和当前任务涉及的设计、代码及调用方。
- 在当前任务、Issue 或 PR 中说明真实场景、职责归属和完成条件；已有明确任务可直接实施，不要求先另建 Issue。
- 保持改动集中，按 [测试与验收](design/09-testing-and-acceptance.md) 选择验证；公共接口、权限和持久化变化保留对应的兼容、撤销和迁移验证。
- 在 PR 中简短说明行为变化、影响范围、实际验证及限制，不把未执行的检查写成通过。

## 文档约定

- 设计文档位于 `docs/design/`，文件以两位数字排序。
- 标题不超过三级；代码块必须声明语言。
- 相对链接必须能从当前文件解析。
- Mermaid图应保持节点名称简短，并使用稳定 ASCII节点 ID。
- 不把 `tmp/`材料作为正式依据链接给最终用户。
- 页面变化影响视觉 token 或交互规则时同步更新 [DESIGN.md](DESIGN.md)。
- 纯文档修改检查变更内容的相对链接、命令入口和代码块；修改 Mermaid 时检查图源码。只对修改的文件检查格式，不运行全仓格式化。
- 修改 `docs/DESIGN.md` 时，从仓库根目录运行 `npx @google/design.md lint docs/DESIGN.md`；其余文档不触发这项校验。纯文档任务通常无需业务构建、数据库或真实浏览器测试；修改可执行示例时按其实际影响验证。

## 安全与隐私

- 不提交真实密码、Token、Cookie、代理凭据、Profile数据或用户文件。
- 安全漏洞不要创建公开 Issue；按 [SECURITY.md](SECURITY.md)报告。
- 新增日志字段时证明其不包含页面正文或敏感 URL。
- 更改授权、Ticket、Session租约或 Worker身份时必须包含越权与撤销测试。

## 许可证

提交代码即表示你有权按项目的 [MIT License](../LICENSE)提供该贡献。
