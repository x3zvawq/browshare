export const proxyQuickEntryMessages = {
  'zh-CN': {
    proxyQuickEntry: {
      title: '粘贴 Proxy 地址',
      hint: '支持 HTTP、HTTPS 和 SOCKS5，自动填写下方连接信息。用户名或密码中的特殊字符可使用 URL 百分号编码。',
      placeholder: "protocol://user:password{'@'}host:port",
      apply: '填入连接信息',
      invalid: '请输入有效的 http://、https:// 或 socks5:// 地址及端口，不包含路径、查询或片段。',
      applied: '连接信息已填入，请检查后保存。',
    },
  },
  'en-US': {
    proxyQuickEntry: {
      title: 'Paste a Proxy URL',
      hint: 'HTTP, HTTPS and SOCKS5 URLs fill the connection fields below. Percent-encode special characters in credentials when needed.',
      placeholder: "protocol://user:password{'@'}host:port",
      apply: 'Fill connection fields',
      invalid:
        'Enter a valid http://, https:// or socks5:// URL with an explicit port and no path, query or fragment.',
      applied: 'Connection fields filled. Review them before saving.',
    },
  },
}
