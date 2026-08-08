# Aethor Robot Gateway（后续阶段）

本目录仅记录边界，不包含 C# 实现。

后续建议项目：`AethorStudioV2.Domain`、`AethorStudioV2.Application`、`AethorStudioV2.Infrastructure`、`AethorStudioV2.Api`、`AethorStudioV2.Tests`。

- Domain：归一化设备状态、命令不变量和错误分类，不依赖串口、HTTP 或文件系统。
- Application：连接、刷新、使能、停机、回零、复位、模式切换、关节整组下发和急停用例。
- Infrastructure：Dummy ASCII 适配器、串口所有权、Profile 存储、日志和有界遥测缓冲。
- API：loopback REST 命令、SignalR 遥测、会话令牌和静态前端托管。

真实实现必须遵守 [`shared/contracts/robot-gateway-v1.md`](../../shared/contracts/robot-gateway-v1.md)，不得让前端直接组合急停链或解析设备回包。
