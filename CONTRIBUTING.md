# 贡献与验证

先读AGENTS.md和目标规范；检查工作树，不覆盖已有改动。规范改变要说明行为差异和来源；新重要规则由Director确认，表达修订无需重复审批。

```sh
npm run check
npm test
npm run branch:check
npm run diff:check
```

check执行本地Markdown目标/锚点检查、Secret模式与私有地址检查及设计追踪校验；test在.tmp内复制合成fixture，验证正例与拒绝路径。测试不执行来源工具或访问任何业务接口。自动检查不能证明语义正确或保证所有未知Secret被识别，仍需人工阅读差异。

源码和测试变化添加针对真实风险的回归。不要手改生成的追踪区；修改后用trace:render。不要以刷新摘要冒充验证通过。

使用普通中文写提交说明，正常推送main或按风险使用独立分支。禁止强推、移动正式标签和混入敏感文件。私有仓库不自动授予内容对外分发权。
