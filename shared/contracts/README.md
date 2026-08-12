# Aethor Studio V2 接口契约

`shared/contracts/` 是前端、C# 网关与 Windows WebView2 壳之间的版本化边界，也是 `@aethor/contracts` TypeScript workspace。它不打开串口，也不提供网络服务；真实 transport 生命周期属于 `services/robot-gateway`。

- `robot-profile-v1.schema.json`：受管机器人配置包的 manifest Schema；可选 `jointGroups` 用于显式声明多机械臂分组与 TCP link。
- `gateway-contracts-v1.schema.json`：会话、关节帧、整组命令、受限 engineering direct 请求/结果、协议帧、信号与桌面能力的 JSON Schema `$defs`。
- `robot-gateway-v1.md`：RobotGatewayV1.3 的命令、遥测、错误、来源与安全语义。
- `action-program-v1.schema.json`：Dummy 六轴离线动作文档 Schema。
- `action-program-v1.md`：点位、来源、显式保存、兼容性与未来执行边界。
- `desktop-bridge-v1.md`：WebView2 原生窗口能力契约。
- `src/types.ts`、`src/actionProgram.ts`：与 wire/file Schema 对应的 TypeScript 类型；前端不再保留副本。
- `src/dummyAsciiV1.ts`：Dummy formatter、白名单、response parser 和有界行解码器。
- `src/commandStateMachine.ts`、`sessionStateMachine.ts`：纯状态转换规则。
- `src/transport.ts`、`src/testing.ts`：transport port 与只用于测试的有界 fake。
- `conformance/dummy-ascii-v1.vectors.json`：TypeScript 与 C# 共用的协议向量。

## 跨语言一致性

JSON Schema 是 wire contract 的权威来源。TypeScript 通过严格类型、Ajv 2020-12、格式校验和 conformance vectors 验证；Profile 的 DOF、重复映射和限位等跨字段不变量继续由前端 Zod 校验。Phase 4 的 C# Domain 显式维护对应 DTO，并由 C# adapter 读取同一协议 vectors；当前没有 Schema-to-C# 自动生成链，因此破坏性 Schema 变化必须同时更新两端测试，不能宣称由生成器自动同步。

跨进程字段必须携带明确单位、来源、时间和有效性。内部 C# 类型和串口驱动类型不得直接暴露给前端。公共 Schema 的破坏性变化必须新增版本，不能静默修改已发布版本。

## `.aethor-robot` 受管配置包

- 文件是 ZIP，根目录必须包含由 `robot-profile-v1.schema.json` 描述的 `manifest.json`；URDF、STL 和来源/许可记录只能使用包内相对路径。
- 前端预览门先读取 ZIP 中央目录，只选择性解压 `manifest.json` 与 manifest 指定的 URDF；STL 不在校验阶段展开。压缩包与声明解包总量分别不超过 250 MiB，文件不超过 2,048 项，manifest 不超过 1 MiB，URDF 不超过 8 MiB，诊断最多保留 64 项并汇总其余错误。
- 路径按 Windows 大小写不敏感语义去重，并拒绝绝对路径、`..`、NTFS ADS 冒号、控制字符、尾随点/空格和设备保留名。缺失 mesh、重复关节、DOF/索引/限位错误继续失败关闭。
- 前端结果只表示“本地可预览”，不会安装、持久化、连接设备或声明协议适配器可用。未来 C# 安装服务必须从原始包重新执行独立校验，不能信任前端结果。

## 内置 Profile

- `dummy-6dof`：单组六轴，协议适配器 `dummy-ascii-v1`；硬件能力以 Dummy 网关协商结果为准。
- `aethor-robo-dual-7dof`：两组各七轴，协议适配器暂为 `aethor-robo-pending`。`controlModes` 可以为空，以如实表示当前没有可用硬件模式；所有 capability 为 false。
- `jointGroups` 中的关节必须存在、不得重复跨组，且有分组时必须覆盖 manifest 的全部可控关节。固定安装关节、车轮等模型关节不应伪装成控制组。
