const allowedStatuses = new Set(['Ready', 'In Progress', 'Review', 'Accepted', 'Completed', 'Withdrawn']);

const transitions = new Map([
  ['Ready', new Set(['In Progress', 'Withdrawn'])],
  ['In Progress', new Set(['Review', 'Withdrawn'])],
  ['Review', new Set(['In Progress', 'Completed', 'Withdrawn'])],
  ['Accepted', new Set(['Completed'])],
  ['Completed', new Set()],
  ['Withdrawn', new Set()],
]);

export function nextAclNumber(registry) {
  const numbers = [...registry.matchAll(/^\|`ACL-(\d{6})`\|/gmu)].map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function assertLoopTransition(current, target) {
  if (!allowedStatuses.has(target)) throw new Error(`未知Loop状态：${target}`);
  if (target === 'Accepted') throw new Error('新收口只使用Completed');
  if (current === target) throw new Error(`Loop已经是${target}`);
  if (!transitions.get(current)?.has(target)) throw new Error(`不允许从${current}迁移到${target}`);
}


export function aclRecordTemplate({ date, goal, id, source, title, version = '未确定', ready = false, branch = 'main', revision = '待固定' }) {
  const planned = version === '未确定' ? '未确定' : `\`${version}\``;
  const status = ready ? 'Ready' : 'In Progress';
  return `# \`${id}\` ${title}

> 轮次状态：${status}
>
> 结果：待定
>
> 责任角色：Director
>
> 轮次ID：\`${id}\`
>
> 工作类型：工程维护
>
> 计划版本：${planned}
>
> 实际纳入版本：未纳入
>
> 工作来源：${source}
>
> 登记时间：${date}
>
> 实际开始时间：${ready ? '待填写' : date}
>
> 结束时间：待填写
>
> 启动分支与基线：\`${branch}@${revision}\`
>
> 首次统一验证：待填写
>
> 结束依据：待填写
>
> 结束记录人：待填写
>
> 结束记录时间：待填写
>
> 结束说明：待填写

## 1.启动方案

### 1.1目标与非目标

${goal}

非目标：待补充。

### 1.2实施步骤

待补充。

### 1.3停止条件

待补充。

### 1.4完成条件

待补充。

## 2.实施与验证

### 2.1当前摘要

当前步骤：${ready ? '已经准备好，尚未实际开始。' : '已经开始实施。'}

下一动作：按启动方案实施并持续记录验证结果。

### 2.2当前记录

待实施后补充。

## 3.结论

尚未形成结束结论；剩余问题将在实施与验证中持续更新。
`;
}
