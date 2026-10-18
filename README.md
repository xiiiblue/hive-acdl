# hive-acdl

ACDL（Agent Collaborative Development Lifecycle）是一套由人（Director）指挥Agent协同研发的方法、规范、模板与本地工具。Director决定方向、边界和重要取舍，Agent负责在授权范围内实施、验证并留下可核对的证据。

ACDL关注“人怎样指挥Agent协作”；HiveFlow关注“流程怎样在授权范围内自动流转”。二者可以协作，但不互相替代。本项目是规范与工具仓库，现有网站仓库独立维护。

## 快速开始

需要Node.js 22+、npm；分支检查和差异检查需要Git。不需要安装依赖，没有业务服务、数据库或部署步骤。

```sh
npm run check
npm test
npm run branch:check
npm run process:metrics -- --format=json
```

从[使用指南](docs/guide.md)选择流程，从[规范入口](docs/00-规范/README.md)查长期规则，从[模板](templates/README.md)建立记录，从[工具说明](docs/tools.md)了解参数、写入和采用方式。

## 仓库内容

- `docs/00-规范/`：九项规范的通用整理稿，当前为Review，供采用项目确认。
- `docs/guide.md`：角色、冷启动、需求、设计、ACL/DFL/ERL、并行与版本。
- `templates/`：Agent入口、需求、设计、ADR、Issue、三类Loop、交接与版本模板。
- `scripts/`：本地检查、设计追踪、关系校验、统计和纯Loop函数。
- `docs/01-需求/`、`docs/02-设计/`、`docs/03-实施/`、`tests/traceability/`：空白可运行骨架，不包含蜂巢业务记录。

本仓库暂为私有，未选开源许可证。见[权利说明](NOTICE.md)、[来源清单](provenance/README.md)及[贡献与验证](CONTRIBUTING.md)。
