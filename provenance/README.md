# 提取来源与边界

来源私有仓库：xiiiblue/hive-os，默认分支main，固定完整提交：`3d3a634be5b401ef02740fdbebd00fcdc16fb2ff`。本地HEAD与GitHub main在提取开始时一致，工作树干净。所有材料通过git show读取该提交，不复制未提交内容。

[机器清单](manifest.json)记录每份源文件路径、原文SHA-256、目标和改写说明；整理稿不宣称与来源逐字一致，所有新增规范仍待采用项目确认。原始来源只能由有权访问者在固定提交核对；本项目不打包未经脱敏的来源快照。

## 通用部分

提取9项规范、研发流程手册全部章节的通用方法、Agent入口和PR模板思路；保留设计追踪、分支检查、Issue关系与流程统计，抽出Loop纯函数与ACL模板。其余模板由这些规则整理而成，并非虚称来源仓库已有同名文件。

## 未提取与原因

|来源范围|处理与理由|
|---|---|
|apps、packages、providers、skill-packages、deploy、业务测试与产物|业务源码、连接器、运行时与部署不属于规范项目|
|docs/01-需求、02-设计、03-实施、04-版本的真实记录|只借用结构，不复制业务事实、人员、版本或验收证据|
|docs/05-环境、历史及交付材料|环境、私有地址和业务历史不提取|
|scripts/operations全部|生产/开发发布、SSH、备份恢复工具不提取|
|scripts/workflows/manage-issue.mjs与.github/workflows/issue-sync.yml|GitHub外部写操作和标签策略需另行设计，不移植自动同步|
|scripts/workflows/change-loop-status.mjs|依赖蜂巢验证摘要、Git树和档位；不能用简化实现绕过证据收口|
|scripts/verify/verify-change.mjs、工具链/数据库/镜像/CI检查|依赖蜂巢包图与部署，采用项目自行接入|
|scripts/lib/docs及check-docs/report-agent-context|内置具体设计、历史目录和上下文规则，改为本项目独立链接/敏感检查，不声称完整等价|
|.env、凭据及无关个人文件|未读取、未复制|
|网站仓库|未修改|

## 改写决策

业务标识使用示例，来源环境授权删除；STD-007重写为工具库验证要求；其它STD保留通用规则并移除失效项目链接及历史批次。手册归并为guide与tools，避免把蜂巢专属命令当成本项目能力。Loop库只保留模板和纯状态函数，无自动完成命令。统计时区由参数指定，默认UTC；追踪外部Issue链接允许通用GitHub仓库。

## 验证边界

本机验证覆盖本仓库内链接、锚点、敏感模式、追踪及合成fixture工具行为。没有运行源仓库工具，没有生产接口、SSH、部署、数据库、实机或产品集成验证；外部链接未联网全量探测。Secret模式扫描不能替代人工审阅。权利与分发条件见[NOTICE](../NOTICE.md)。
