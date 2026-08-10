# ADR-0008：Windows 安装、升级与用户数据边界

- 状态：Accepted（安装格式与数据策略；工具链和签名身份待关闭）
- 日期：2026-08-09
- 范围：Phase 8B Windows 正式发布门

## 背景

Aethor Studio V2 需要可安装、可修复、可升级和可卸载的 Windows 交付物，同时必须默认保留动作程序、Robot Profile、WebView2 本机状态、日志和诊断证据。安装或升级过程也不能强制结束仍可能持有串口的网关，更不能把进程退出当作设备已安全去使能。

MSIX 会将部分桌面应用 AppData 写入包私有位置，并在完整卸载包时清除被重定向的数据；这与当前“默认保留用户数据”的产品边界冲突。Windows Installer 原生支持已安装应用登记、修复和 Major Upgrade，且允许把应用二进制与 `%LOCALAPPDATA%\Aethor Studio V2` 数据根保持为两个独立所有权域。

## 决策

1. 正式 Windows 交付格式选择签名的 MSI；若需要离线携带 WebView2 Runtime，则在 MSI 外增加同样签名、可审计的 prerequisite bundle。现有便携目录仍只用于开发与诊断，不是正式安装器。
2. 默认采用当前用户安装，不请求管理员权限；二进制安装到用户程序目录，开始菜单和“已安装的应用”登记只属于当前用户。未来企业级全机部署必须作为独立经过验证的安装上下文，不能用同一个包静默切换作用域。
3. MSI 只拥有其安装的二进制、快捷方式和卸载登记。`%LOCALAPPDATA%\Aethor Studio V2` 永远不进入 MSI 组件表，因此修复、Major Upgrade 和普通卸载均保留其中的动作、Profile、WebView2 数据、日志、CrashDumps、布局与窗口位置。
4. 删除用户数据必须是独立、明确、默认未选中的操作。实现前必须显示解析后的绝对目标、列出数据类别并再次确认；不得在 MSI 回滚、升级或静默卸载中隐式执行，也不得使用宽泛通配符递归删除。
5. 每个发布版本复用稳定 UpgradeCode，并生成新的 ProductCode；只使用 `major.minor.patch` 三段版本参与 Windows Installer 比较，禁止降级和同版本覆盖。升级失败必须由 MSI 事务回滚到可启动的旧版本。
6. 安装、升级、修复和卸载不得打开串口、启动机器人会话或调用命令 API。检测到桌面或网关进程仍在运行时，安装器只请求操作者从应用内安全退出；禁止强制杀进程或自动重启并连接设备。
7. 正式签名顺序为先签桌面/网关可执行文件，再生成并签 MSI/bundle；必须使用组织提供的代码签名身份和可信 RFC 3161 时间戳。证书主题、发布者名称、时间戳服务和私钥托管方式未提供前，不生成伪造发布者或“已签名”候选。
8. MSI 编译器必须可固定版本、离线还原、校验供应链并支持上述升级/修复语义。WiX 7 是当前首选候选，但 WiX 6/7 存在 Open Source Maintenance Fee/EULA 约束；在项目所有者确认适用性与履约方式前，不把 WiX 包、`AcceptEula` 或下载器写入仓库。已结束公共安全维护的 WiX 5 不作为工业交付退路。
9. 正式 MSI/bundle 必须携带与便携包同源的第三方 SPDX 2.3 清单、机器可读完整性摘要、模型 NOTICE/provenance 和法律附件。生产依赖只能从锁定的 pnpm 图及实际发布 `.deps.json` 派生；摘要存在任何缺失许可正文时，候选发布失败关闭，不得由安装器签名覆盖或降级该问题。

## 后果

- 用户数据保留不依赖卸载器脚本中的例外分支，二进制与运行数据所有权清晰。
- 正式安装器实现暂时被工具治理、组织发布者身份、签名证书和离线 WebView2 Runtime 策略阻止；这不影响便携包、DPI 和崩溃恢复的软件验证。
- 当前生产依赖清单已可重复生成，但 6 个组件及两个模型的再分发材料仍不完整；签名只能证明发布者和完整性，不能替代许可条款。
- MSIX 当前被拒绝，不是永久禁止；只有未来迁移到明确的非虚拟化数据位置并完成卸载数据策略验证后才可重新评估。
- Inno Setup 当前不作为首选，因为 Phase 8 明确需要 Windows Installer 的企业修复/Major Upgrade 语义，且其商业使用同样需要单独治理确认。

## 关闭实现门的输入

1. 组织/个人的正式 Publisher 名称与代码签名证书方案。
2. WiX 7 OSMF/EULA 适用性结论，或批准的等价 MSI 工具链。
3. WebView2 Evergreen 已安装前置条件与离线 Runtime bundle 二选一的发布决定。
4. 两个不同三段版本的干净提交，用于真实安装、修复、升级、降级拒绝和卸载演练。
5. 六个第三方组件的权威许可正文/法律处置，以及 Dummy 与 Aethor_robo 模型的完整再分发条款。

## 依据

- [Microsoft：Windows 应用安装与卸载最佳实践](https://learn.microsoft.com/windows/apps/get-started/best-practices)
- [Microsoft：Windows Installer Major Upgrade](https://learn.microsoft.com/windows/win32/msi/major-upgrades)
- [Microsoft：MSIX 桌面应用运行与 AppData 卸载行为](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [FireGiant：WiX Open Source Maintenance Fee](https://docs.firegiant.com/wix/osmf/)
