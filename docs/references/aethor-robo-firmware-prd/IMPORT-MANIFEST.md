# Aethor_robo 固件 PRD 导入说明

## 快照性质

- 导入日期：2026-08-17
- 内容：用户提供的固件开发 PRD，共 18 个 Markdown 文件
- 用途：保留需求、阶段计划和历史交接背景，供 Studio 与固件团队对照
- 权威性：本目录是参考快照，不是 Aethor Studio V2 的协议或实现事实源

发生冲突时，以 Studio 的 `docs/roadmap.md`、`docs/protocols/`、`shared/contracts/` 和对应阶段 handoff 为准。快照内的阶段状态、串口参数和 `aethor-arm-ascii-v1` 描述不能直接解释为当前固件已经实现的能力。

## 当前固件对照基线

- 仓库：[StephenGu010/Aethor_robo_fw](https://github.com/StephenGu010/Aethor_robo_fw)
- 检查提交：`db0818b15eb3c2bc7cdde5b34a548c6e69f47a9f`
- 检查方式：只读取该提交的 Git 对象；没有修改、提交或推送固件仓库
- 该提交的正式 USB CDC 协议是 `aethor-text-v1`，无应用层 CRC
- `aethor-arm-ascii-v1` 在该提交中仅作为迁移前兼容性回归资产，不是当前 Keil 固件入口

因此，本快照可以用于追溯最初 PRD，但不能作为 Studio 已兼容当前固件的证据。后续 A1-H1-F 必须先决定 Studio 迁移到 `aethor-text-v1`，还是由固件重新提供版本化的 `aethor-arm-ascii-v1` 正式入口。

## 导入处理

原始文档只有一处包含个人桌面绝对路径。入库副本将其改为“外部供应商资料（未纳入本仓库）”；根 README 的两处 Markdown 行尾空格等价改写为显式 `<br>`，使 `git diff --check` 保持通过。除此之外保持原有目录和正文，原始本地文件未被修改。

## 原始文件 SHA-256

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `01_产品需求与系统架构.md` | 12607 | `29e426a28f37ebec850fcd19866eb72ae880dc265110ea4c04092eb7e8eb1bbd` |
| `02_上位机串口协议_aethor-arm-ascii-v1.md` | 18236 | `b3755e6411c1b20fc0cd48f82031963c40107d30f360b96d26327e9cbc9a91d5` |
| `03_达妙CAN与实时固件规范.md` | 20749 | `6ba27e591a1ce67fde9eabbeca27f05396152d81e5958c364b1cd50947a282e0` |
| `04_分阶段实施与验收.md` | 17530 | `760907dee39ade6613af3e91d25c83d2f8ae296cb9f8e599cba9461dfff5ae44` |
| `05_上位机同步开发与联调.md` | 14765 | `59c1e688ce70d7e02780f7c5a3bca6cac14b0c1a4b3a84ce10df03f81e4348b4` |
| `06_测试矩阵与交接模板.md` | 13032 | `5233f6f7e525ef7604cb238412984896a72e620e78c71cf9be5b8bdbe5853287` |
| `CHANGELOG.md` | 2957 | `8c7e3039c1ea87b904f099876561b9bdc56b5e5fa6ce0433084294206ca49070` |
| `README.md` | 6799 | `725354cca12040f6bc989404b6123072d365c36a1ec1ec13154ea0dea036ece8` |
| `handoffs/README.md` | 1215 | `9746e900af51cfd24a73d96fc95413f867f05ebc4b9212a90baa04f2a317d21a` |
| `handoffs/phase-00.md` | 715 | `73e949487f600c106a7c09ff1cf145e222e50a2e57e3d2be88fed12b2b16bc7a` |
| `handoffs/phase-01.md` | 873 | `c81b57babdba9e7c1cef7e3fac1e86961248d64a115e2031f6ae3cb8ac3a4ff6` |
| `handoffs/phase-02.md` | 978 | `c6d23ef754c439027831300c71349e66c721163afe4d0efcf6adb6536ce64296` |
| `handoffs/phase-03.md` | 903 | `8dd946095da8f5f74d0a44f7265d13d4908dd073a89bae663e25a1e5a3d6da80` |
| `handoffs/phase-04.md` | 689 | `8d219ee65bc444d1464457a185d363475836f60638c2f54ba389b25b936783df` |
| `handoffs/phase-05.md` | 647 | `86a4ae668d72802276c3b026e581088cc08e7e88dbfdedd33425509c013ae85d` |
| `handoffs/phase-06.md` | 756 | `2af04144b654ff6665c4d3e5471f8f9f8d3a99de99e7706c0bcfc8d317bedc4c` |
| `handoffs/phase-07.md` | 729 | `9d0e2cd8f72acd1a3e9b3d091c4846093b9f3af928c7dd2ebb6cec9a0139f56e` |
| `handoffs/phase-08.md` | 834 | `5f0ced2ebdc928ceadce6f4cc2d75f0e7757b9762a63e51daf5a23672f218b26` |
