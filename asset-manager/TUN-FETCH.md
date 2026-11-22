# 本机 Clash/TUN 兼容抓取

## 为什么新增模式

Clash fake-IP DNS可把公网域名解析到198.18.x，普通fetch使用域名、由TUN接管连接；旧守卫在连接前拒绝了占位IP。用户明确同意在搜索器里增加兼容模式，不修改Clash配置。

## 显式配置

仅Search-core的私有SC_DATA_DIR/config.json：

~~~json
{"fetchNetworkMode":"trusted-tun","fakeIpCidrs":["198.18.0.0/15"],"ssrf":"strict"}
~~~

或该进程环境SC_FETCH_NETWORK_MODE=trusted-tun、SC_FAKE_IP_CIDRS=198.18.0.0/15、SC_SSRF=strict。不能在fetch工具参数开启，默认strict；生成DSH配置不自动授权。只接受198.18.0.0/15及规范子网，空名单/非法范围/错误模式/off或allowPrivate混用拒绝。旧CIDR独立豁免已收紧。采用新构建须重新生成独立运行包并明确启动；运行中DSH不会因源码更新改变。

## 保留检查与取舍

仅正常公网形式域名解析到名单内fake-IP允许交给OS/TUN。直接IP字面量（含IPv6/十六进制/整数等URL归一化形式）全部拒绝；localhost/单标签/.local/.internal等拒绝；真实私网DNS、空答案、混合不安全答案拒绝。每个重定向逐跳检查协议/端口/域名/DNS，TLS默认校验证书与域名不关闭。

transport.mode显示strict或trusted-tun；remoteIpVerified=false，不认证代理最终IP，trusted-tun附明确警告。公共域名可能经代理指向内网；这项模式适用于可信个人本机代理，不等价于开放抓取服务SSRF防护。strict旧实现也是DNS预检查后fetch再次解析，并非连接IP固定，不声称完整防DNS重绑定。

## 缓存

scoped_pages新增网络策略缓存，按模式、ssrf、CIDR、域名政策隔离；strict不能复用TUN正文，缩小范围也不复用。旧pages保留离线语料，search_cache查询的是历史已抓内容，不保证当前网络策略来源；不删除用户旧库，首次fetch重新验证并按新范围缓存。

## 实测与复跑

node asset-manager/probe-tun-fetch.mjs --live显式进行公网测试，独立HOME/SC_DATA_DIR，不读用户账号/Clash配置；当前Node v26.13.1官方SQLite文档和SQLite WAL正文通过，repeat内容完全一致，strict拒绝相同fake-IP环境。证据是MCP返回正文，不仅HTTP200；没有抓包证明或代理最终IP认证。

宿主探针HUB_DSH_TUN_FETCH=1明确增加官方网络fetch及信任标记回流；默认未设置则只拒绝IP字面量，不自动出网。两版DSH和独立提交副本按精确构建验收，历史质量-only报告不审批新代码。

所有测试不改Clash/用户DNS/live DSH，不创建子代理。
