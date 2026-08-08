# Aethor Studio V2 接口契约

`shared/contracts/` 是前端、未来 C# 服务与 WebView2 壳之间的版本化边界。当前实现只消费这些契约，不提供真实网络服务。

- `robot-profile-v1.schema.json`：受管机器人配置包的 manifest Schema。
- `gateway-contracts-v1.schema.json`：会话、关节帧、整组命令、结果、协议帧、信号与桌面能力的 JSON Schema `$defs`。
- `robot-gateway-v1.md`：命令、遥测、错误、来源与安全语义。
- `desktop-bridge-v1.md`：WebView2 原生窗口能力契约。

跨进程字段必须携带明确单位、来源、时间和有效性。内部 C# 类型和串口驱动类型不得直接暴露给前端。
