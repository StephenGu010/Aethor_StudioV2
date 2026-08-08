# Aethor Studio V2 接口契约

`shared/contracts/` 是前端、未来 C# 服务与 WebView2 壳之间的版本化边界，也是 `@aethor/contracts` TypeScript workspace。它不打开串口，也不提供真实网络服务。

- `robot-profile-v1.schema.json`：受管机器人配置包的 manifest Schema。
- `gateway-contracts-v1.schema.json`：会话、关节帧、整组命令、结果、协议帧、信号与桌面能力的 JSON Schema `$defs`。
- `robot-gateway-v1.md`：命令、遥测、错误、来源与安全语义。
- `desktop-bridge-v1.md`：WebView2 原生窗口能力契约。
- `src/types.ts`：与 wire Schema 对应的 TypeScript 类型；前端不再保留副本。
- `src/dummyAsciiV1.ts`：Dummy formatter、白名单、response parser 和有界行解码器。
- `src/commandStateMachine.ts`、`sessionStateMachine.ts`：纯状态转换规则。
- `src/transport.ts`、`src/testing.ts`：transport port 与只用于测试的有界 fake。
- `conformance/dummy-ascii-v1.vectors.json`：TypeScript 与未来 C# 共用的协议向量。

## 跨语言一致性

JSON Schema 是 wire contract 的权威来源。TypeScript 通过严格类型、Ajv 2020-12、格式校验和 conformance vectors 验证；Profile 的 DOF、重复映射和限位等跨字段不变量继续由前端 Zod 校验。Phase 4 创建 C# 服务时使用 NJsonSchema 或等价生成器从同一 Schema 生成 DTO，并让 C# adapter 读取同一 vectors；在生成链落地前不得声明 C# 一致性已验证。

跨进程字段必须携带明确单位、来源、时间和有效性。内部 C# 类型和串口驱动类型不得直接暴露给前端。公共 Schema 的破坏性变化必须新增版本，不能静默修改已发布版本。
