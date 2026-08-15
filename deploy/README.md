# 人物兴趣雷达定时任务

这个目录仅用于部署“人物兴趣雷达”的三小时分析任务，不提供链上概览、地址追踪、用户画像、地址关联或实时交易接口。

- `onchain-radar-snapshot.timer` 在北京时间 0、3、6、9、12、15、18、21 点触发一次分析。
- 任务从 `trump.fm` 读取特朗普的 Truth Social 归档，从 X API 读取马斯克、Vitalik 和 CZ 的公开动态，补充公开市场指标，调用 DeepSeek 生成关键词与数据故事，再输出前端可读取的快照 JSON。
- 没有 `X_BEARER_TOKEN` 时任务会正常退出并保留上一份快照，不会把演示内容伪装成实时结果。
- 其他页面所需数据由独立后端团队提供，前端接口地址统一配置在 `static-site/runtime-config.js`。

## 环境变量

服务器只需要保存人物雷达任务的密钥；不要把密钥写入 `static-site/`：

```env
DEEPSEEK_API_KEY=
X_BEARER_TOKEN=
TRUMP_FM_BASE_URL=https://trump.fm
```

建议将实际值保存到服务器的 `/etc/onchain-radar.env`，文件权限设为仅管理员可读；不要把服务器地址、账号、密码或该文件复制进 GitHub。`data/social-input/x-state.json` 和 `data/social-input/trump-fm-state.json` 是服务器本地增量状态，也已从 Git 提交范围中排除。

可选变量见根目录 `.env.example`。准备好 X Token 后可手动验证一次：

```bash
systemctl start onchain-radar-snapshot.service
journalctl -u onchain-radar-snapshot.service -n 100 --no-pager
systemctl list-timers onchain-radar-snapshot.timer --all
```

候选快照只有通过人物来源、证据数量、主题类型、市场指标和故事结构校验后才会原子发布。失败记录写入 `work/social-radar/rejected/`，最近成功快照不会被覆盖。

如果定时任务服务器与前端托管位置不同，需要在发布流程中把 `static-site/data/` 的最新快照同步到前端静态目录或对象存储；这一步不应与链上业务后端混在一起。
