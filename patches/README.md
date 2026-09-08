# Proxy依赖补丁

Worker Adapter使用公开的proxy-chain API。以下补丁通过pnpm的`patchedDependencies`和
lockfile固定；`pnpm install --frozen-lockfile`及Worker生产部署包都会应用，不能只改本机node_modules。

- `proxy-chain@3.0.0`：HTTP响应关闭时终止上游请求；Direct CONNECT客户端完全关闭时销毁目标socket，避免远端半开连接残留；SOCKS转发和CONNECT将源连接关闭传给
  握手的AbortSignal，并阻止关闭后的迟到连接继续转发；CONNECT的IPv6 URL去掉方括号后交给TCP/SOCKS层。
- `socks@2.8.10`：把socket options传入`net.Socket`构造函数。Node的`socket.connect()`忽略
  AbortSignal，仅传给connect会使未完成的SOCKS握手继续占用上游连接。
- `socks-proxy-agent@8.0.5`：上游IPv6 URL的hostname去掉方括号后交给SOCKS客户端。

以上均由真实可达的HTTP/CONNECT连接复现。验收覆盖正在等待上游时关闭Adapter后连接释放、
IPv6上游与目标、四种出口的Chrome HTTP/HTTPS与ws/wss、凭据错误和拒绝连接不直连。
临时复现和结果在忽略的`tmp/proxy-adapter-qa/`；上游第三方完整源码只放在tmp中。

升级这些依赖时先检查上游是否已修复相同问题，再用真实网络复现验证。已修复的补丁应移除；
不要为了让补丁套用而盲目改动上下文。这些补丁不改变上游包的许可证。
