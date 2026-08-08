# Aethor Studio V2 接口契约

`shared/contracts/` 是前端、C# 网关与未来 WebView2 壳之间的版本化边界，也是 `@aethor/contracts` TypeScript workspace。它不打开串口，也不提供网络服务；真实 transport 生命周期属于 `services/robot-gateway`。

- `robot-profile-v1.schema.json`：受管机器人配置包的 manifest Schema。
- `gateway-contracts-v1.schema.json`：会话、关节帧、整组命令、结果、协议帧、信号与桌面能力的 JSON Schema `$defs`。
- `robot-gateway-v1.md`：命令、遥测、错误、来源与安全语义。
- `desktop-bridge-v1.md`：WebView2 原生窗口能力契约。
- `src/types.ts`：与 wire Schema 对应的 TypeScript 类型；前端不再保留副本。
- `src/dummyAsciiV1.ts`：Dummy formatter、白名单、response parser 和有界行解码器。
- `src/commandStateMachine.ts`、`sessionStateMachine.ts`：纯状态转换规则。
- `src/transport.ts`、`src/testing.ts`：transport port 与只用于测试的有界 fake。
- `conformance/dummy-ascii-v1.vectors.json`：TypeScript 与 C# 共用的协议向量。

## 跨语言一致性

JSON Schema 是 wire contract 的权威来源。TypeScript 通过严格类型、Ajv 2020-12、格式校验和 conformance vectors 验证；Profile 的 DOF、重复映射和限位等跨字段不变量继续由前端 Zod 校验。Phase 4 的 C# Domain 显式维护对应 DTO，并由 C# adapter 读取同一协议 vectors；当前没有 Schema-to-C# 自动生成链，因此破坏性 Schema 变化必须同时更新两端测试，不能宣称由生成器自动同步。

跨进程字段必须携带明确单位、来源、时间和有效性。内部 C# 类型和串口驱动类型不得直接暴露给前端。公共 Schema 的破坏性变化必须新增版本，不能静默修改已发布版本。
