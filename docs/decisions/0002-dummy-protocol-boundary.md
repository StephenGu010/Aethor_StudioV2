# ADR-0002：Dummy ASCII v1 采用收敛白名单与证据分级

- 状态：Accepted
- 日期：2026-08-08

## 背景

固定固件提交支持模式 1–5、多个维护/RGB/电流入口，以及 `>`、`&`、`@` 三种运动前缀。首版产品只需要六轴硬件调试、关节组控制和动作编排，并明确排除模式 4/5、RGB、标定、PID、reboot、笛卡尔控制和通用电流控制。旧前端校验仍接受这些排除项，且把部分 ACK 当成成功，形成了安全边界冲突。

## 决策

- 公共结构化命令只包含核心系统命令、三个只读查询、模式 1–3 和 `>` 六轴关节组。
- 固件中的 `&` 与 `>` 在模式 1–3 执行代码等价；V2 只生成 `>`，避免两个入口表达同一产品语义。
- `$0,0,0,0,0,0` 只作为未来停止链的内部兼容步骤，不能由 UI、raw terminal 或公共命令 DTO 构造。固件成功路径无 ACK，写入后必须继续执行 `!DISABLE` 和 `#GETENABLE`。
- JSON Schema 是跨进程 wire contract；TypeScript 类型、Zod 的 Profile 交叉字段校验和语言无关 conformance vectors 共同防漂移。Phase 4 的 C# 类型与 adapter 已复用相同 Schema 资产和 vectors；后续破坏性变化仍必须新增版本。
- 设备队列整数和通用 `ok` 只属于证据，不等于物理完成。关节组只有经新鲜反馈收敛确认后才能进入 `completed`；无法确认时进入 `unconfirmed`。
- 静态展示源不能产生连接、使能、设备 ACK 或完成事件。

## 固件证据

- `ascii_processor.cpp`：`MAX_LINE_LENGTH=256`，达到 256 后在行结束前切换为丢弃，因此 V2 最大有效行负载固定为 255 字符。
- `dummy_robot.h`：运动 FIFO 为 16 项、每项 64 bytes，因此关节组 formatter 限制为最多 63 个 ASCII 字符。
- `dummy_robot.cpp`：模式 1/3 等待循环同时受 `IsEnabled()` 影响，模式 2 立即回 `ok`；任一 `ok` 都不足以独立证明到位。
- `ascii_protocol.cpp`：`$` 成功路径只缓存电流值，不发送成功响应；README 中的成功 `ok` 与固定提交代码不一致。

## 后果

优点是 UI、C# 服务和固件证据之间只有一条可审计入口，且不会把 ACK 提升为运动成功。代价是固件已有的高级/维护功能不能通过首版专家终端绕过；若未来确需开放，必须新增能力版本、危险操作设计和实机验收，而不是扩大 raw whitelist。

## 回滚

如固定固件版本改变，先新增新的 adapter 版本与 conformance vectors。不得直接放宽 `dummy-ascii-v1`，以免旧 Profile 获得新权限。
