# BrowShare release preparation

当前版本是 `0.1.0` 未发布候选。本文区分可在本机生成的候选产物、CI 执行事实和公开发行。源码采用
[MIT](../LICENSE)，依赖、基础镜像和 Chrome 的条件见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 固定兼容性

| 层 | 当前候选 |
| --- | --- |
| BrowShare | 0.1.0 |
| Worker 平台 | Linux amd64 |
| Node / pnpm | 24.12.0 / 10.28.2 |
| Google Chrome Stable | 152.0.7977.75，deb 152.0.7977.75-1 |
| Remote Tab / Extension | 0.1.24 / 0.1.24 |
| Worker Control | 1.22 |

[compatibility.json](../deploy/compatibility.json) 固定 Chrome 下载地址、包校验和、Node 基础镜像
digest、seccomp 来源及摘要。`pnpm compatibility:check` 检查根包与四个应用版本、Dockerfile 和
Worker 默认值；候选准备还检查 Remote Tab 的 Core、Protocol、Viewer、Signaling、Extension 包版本。
不要将版本相同当成源码相同：两仓库均需记录精确源码身份。

支持的浏览器和真实链路证明见 [验收文档](design/09-testing-and-acceptance.md)。升级 Chrome、
Extension 或媒体协议时必须重新执行受影响的 Chrome/WebRTC/数据卷验收，不能只修改此表。

## 本地源码候选

准备两个相邻 checkout，安装锁定依赖；也可用 `BROWSHARE_REMOTE_TAB_SOURCE` 指定 Remote Tab。
需要 Node、pnpm、Git、tar 和 Syft 1.51.1。候选命令只读源码，不创建 commit 或发布。

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
pnpm --dir ../browshare-tab-remote install --frozen-lockfile
pnpm check
npx --yes @google/design.md@0.4.0 lint docs/DESIGN.md
pnpm release:prepare tmp/release-candidate
for source in browshare browshare-tab-remote; do
  syft scan "dir:tmp/release-candidate/.sources/$source" --source-name "$source" \
    -o "cyclonedx-json=tmp/release-candidate/sbom-$source.cdx.json" \
    -o "spdx-json=tmp/release-candidate/sbom-$source.spdx.json"
done
pnpm release:finalize tmp/release-candidate
pnpm release:verify tmp/release-candidate
```

输出目录必须不存在，且位于仓库 `tmp/` 内。准备命令用 Git 文件清单收集非忽略的正式文件，排除
构建目录、环境配置与临时目录，保留两个完整源码压缩包、许可证、版本说明、兼容性和依赖许可证清单。
新增正式文件后仍须检查归档清单，不能把 `.gitignore` 当作保密审查。

`source-record.json` 明确记录 commit（未提交时为 null）、dirty 状态及两个压缩包的 SHA-256。
有未提交内容时身份是 `working-tree-snapshot`，不会冒充 commit 构建。`SHA256SUMS` 覆盖所有
最终平面文件；验证也拒绝增加、遗漏或修改的文件。`.sources/` 仅作构建输入，不上传此暂存目录。
源 SBOM 描述锁文件中的生产及开发依赖，不等于运行时镜像的实际安装包清单。

## 带 SBOM 和来源记录的 OCI 候选

需要支持 OCI 导出和 attestations 的 Docker Buildx/BuildKit。使用 Docker container builder 或启用
containerd image store 的 Docker builder。普通 `docker save` 不是保留完整 attestation 的替代方式。
小内存机器上，构建与 Chrome 业务验收分时进行，使用独立构建器限制并发和资源。下面的配置
已在约 2 GiB 内存、配置了 swap 的干净测试机上完成本次 Worker 候选构建；不是业务容量指标。
内存限制也作用于实际构建步骤所在的子 cgroup。机器没有足够资源时，应换用构建机，而非同时
保留多套历史测试服务。Docker 的配置说明见 [BuildKit 配置](https://docs.docker.com/build/buildkit/configure/)
与 [Docker container driver](https://docs.docker.com/build/builders/drivers/docker-container/)。

```bash
mkdir -p tmp
cat > tmp/release-buildkitd.toml <<'EOF'
[worker.oci]
  max-parallelism = 1
EOF
docker buildx create --name browshare-release --driver docker-container \
  --driver-opt image=moby/buildkit:v0.26.2,memory=1200m,memory-swap=1600m,restart-policy=no \
  --buildkitd-config tmp/release-buildkitd.toml --use --bootstrap
export BUILDX_BUILDER=browshare-release
```

上一步生成后，以暂存源码中的工具构建，确保两仓库输入与候选归档一致：

```bash
for target in backend migrator gateway portal worker-chrome; do
  bash tmp/release-candidate/.sources/browshare/tools/build-release-image.sh \
    "$target" "tmp/release-images/$target"
done
```

使用上述独立构建器时，构建完成后运行 `docker buildx stop browshare-release`，再启动业务验收。
它保留构建缓存；不必为了停止构建器而删除缓存或运行数据卷。

若之前设置了 `BROWSHARE_REMOTE_TAB_SOURCE`，此步骤应将它设置为当前候选的
`tmp/release-candidate/.sources/browshare-tab-remote` 的绝对路径，避免读取变化中的开发 checkout。
默认使用暂存 BrowShare 的相邻 Remote Tab 快照。

每个目标有独立且必须不存在的输出目录，包括 OCI tar、BuildKit metadata、SPDX 镜像 SBOM、
in-toto SLSA provenance、源码归档身份和校验和。工具检查 linux/amd64 runtime manifest、config、
attestation 的实际 digest 和引用关系，并区分 index digest、runtime manifest digest 和 config digest。
导出包仍需接受实际部署与业务链路验证；元数据校验不等于启动成功。

这些是 **未签名的 BuildKit 来源记录**，不是经过认证的发布者身份，也不宣称某个 SLSA 等级。
正式公开镜像应通过受信 CI 签名/attestation，并用接收方的验证流程核对仓库、工作流、commit 和 digest。
当前工具没有 `push`；含 Chrome 的 Worker 只在本地构建，未确认再分发条件前不上传其 OCI tar。

## CI 与首次公开

[CI workflow](../.github/workflows/ci.yml) 在 push/PR 执行锁定安装、完整检查、设计规范校验及两个
源码快照的 Syft 扫描。手动触发并选中 `build_images` 后，五个独立 job 导出 OCI 候选；Worker
仅上传 JSON 构建事实和 SHA256SUMS，不上传含 Chrome 的 tar。此事实附件的 SHA256SUMS 包含
本地 Worker tar 的摘要，拿不到该 tar 时不能声称验证了该文件。普通控制面 OCI 附件保留 7 天，
源码附件保留 14 天；CI 附件不是长期发行下载站。

已确认的仓库为 [BrowShare](https://github.com/x3zvawq/browshare) 与
[Remote Tab](https://github.com/x3zvawq/browshare-remote-tab)。本地 `origin` 已指向对应仓库，
Remote Tab 六个公开包已填写精确仓库 URL 与各自目录。首次提交消息为 `init`，后续提交按
`type(scope): message` 描述实际变化；提交与推送不代表正式版本或其他发行资产已经发布。

BrowShare 的 Repository Variables：

- `BROWSHARE_REMOTE_TAB_REPOSITORY`：已设置并读取核对为 `x3zvawq/browshare-remote-tab`。
- `BROWSHARE_REMOTE_TAB_REVISION`：经过 Remote Tab 发布检查的完整 40 位小写 commit SHA。

固定 revision 必须填写经过审查的实际提交，不从浮动分支构建，也不为运行 CI 虚构提交。
Hosted CI 是否通过应核对对应提交的运行记录。正式发行前仍须配置 npm trusted publishers、GHCR、
稳定 Extension 签名 ID 和公开更新地址；遵守 Remote Tab 自己的发布 Gate。

公开 BrowShare 前需要受审查的 commit/tag、成功的托管 CI、精确匹配的源码及镜像摘要、有效的私密
安全报告入口和更新后的 [版本说明](../CHANGELOG.md)。记录数据库迁移、实际部署升级/恢复和已知
浏览器限制。首次版本没有“上一已发布版本”，历史 schema 夹具不能被写成已发布版本升级验证。
真正的第三方空机演练使用 [部署入口](../deploy/docker/README.md)，不得依赖维护者的 `tmp/`、
预置数据库、旧身份卷或未公开构建产物。

发布和安全公告按 [SECURITY.md](SECURITY.md) 协调。私钥、测试凭据、Profile 数据及诊断包不属于
Release 资产；未执行的公开发布、独立演练或签名身份验证继续保留为未完成项。
