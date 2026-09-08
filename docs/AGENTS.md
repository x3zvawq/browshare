# BrowShare documentation guide

仓库工程约束见根目录 [AGENTS.md](../AGENTS.md)。本文件只补充文档维护要求，适用于 `docs/`。

- 按当前任务读取相关设计，不要求顺序通读所有文档。编号用于导航；阶段计划和历史证据不限制已经获授权的后续实现。
- 设计说明预期行为、职责、数据和协议约束以及完成条件；当前交付状态记录在 [PROGRESS.md](../PROGRESS.md)。新增状态结论需有代码或实测依据，保留历史证据原有日期、版本和证明范围。
- 接口变化同步拥有该接口的专题及必要示例；只更新受影响段落，不为统一风格重写整套设计。
- [DESIGN.md](DESIGN.md) 定义产品 UI 及交互约束。其中的删除、接管确认是产品用户流程，不代表编码 Agent 在普通文档或代码修改前要额外请求批准。
- 文档使用相对链接、有语言标记的代码块和可编辑 Mermaid；标题原则上不超过三级。验证规则见 [贡献指南](CONTRIBUTING.md)。

这些协作约定参考 [OpenAI Model guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)（2026-09-05 查阅）：明确任务授权、清理冲突指令、按变更风险验证并简洁交付。项目具体约束仍由根目录指南和设计契约维护。
