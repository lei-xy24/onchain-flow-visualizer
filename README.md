# 区块链与数字金融服务安全测试平台前端

本仓库以 `static-site/` 前端为交付主体。链上概览、地址追踪、用户画像、地址关联和实时交易只消费后端团队提供的 HTTP 接口，本仓库不实现这些业务后端；接口地址统一配置在 `static-site/runtime-config.js`，留空时使用内置演示数据。

“人物兴趣雷达”由 GitHub Actions 每周一北京时间 08:00 运行：从 `trump.fm` 读取特朗普的 Truth Social 归档，并通过 X API 读取马斯克、Vitalik 和 CZ 的公开动态；随后调用 DeepSeek V4 Pro 归纳真实关注主题。动态直接提到具体资产、且资产与当前主题直接相关时，系统会用 CoinGecko 历史小时行情对照 T-24h 至 T+72h 的价格和成交量反应；其他主题继续使用公开动态证据，不强加币价。`deploy/` 保留阿里云 systemd 作为可选的自托管替代方案。

仓库结构：

- `static-site/`：GitHub Pages 的完整前端，也是当前业务交付主体。
- `scripts/`、`data/`：人物兴趣雷达的采集、市场数据和每周快照生成逻辑。
- `deploy/`：人物雷达可选的自托管 systemd 模板；当前线上定时任务使用 GitHub Actions。
- `app/`、`worker/`：保留的 Sites/Cloudflare 构建入口，用于另一套地址追踪原型和构建验证，不是链上业务后端。
- `data/example-flow.json`、`lib/flow-data.ts`：Sites 原型使用的演示数据读取层。

## JSON 数据格式

示例数据采用“链 -> 搜索地址 -> 资金流”的结构。`input` 表示资金流入搜索地址，`output` 表示从搜索地址流出。

```json
{
  "eth": {
    "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97": {
      "label": "ETH sample account",
      "input": [],
      "output": []
    }
  },
  "bsc": {
    "0xB5C0000000000000000000000000000000000001": {
      "label": "BSC sample account",
      "input": [],
      "output": []
    }
  },
  "polygon": {
    "0x9000000000000000000000000000000000000001": {
      "label": "Polygon sample account",
      "input": [],
      "output": []
    }
  }
}
```

字段约定：

- `address`：交易对手方账户地址。
- `time`：交易时间，建议后端返回 ISO 8601 字符串。
- `amount`：交易金额，数字类型。
- `asset`：币种或资产符号。
- `txHash`：交易哈希。
- `tag`：可选账户标签。
- `label`：可选搜索地址标签。

## 后端接入位置

静态演示页面的接口入口在 `static-site/runtime-config.js`。后端接口可用后，只填写公开 HTTPS 地址，不要把 Etherscan、DeepSeek、X 或其他供应商密钥放进前端。接口契约见 `static-site/README.md`。

## 常用命令

```bash
npm run dev
npm run build
npm test
npm run lint
npm run typecheck
```

## 上传 GitHub 前的安全边界

- 可以提交源代码、演示 JSON、人物插画、测试、部署模板和 `.env.example`。
- 不要提交 `.env`、真实 API Key、X Token、服务器地址与登录信息、SSH 私钥、日志或本地增量状态文件。
- `.gitignore` 已覆盖常见环境文件、证书、私钥、日志，以及 `data/social-input/*-state.json`。
- `.github/workflows/social-radar-snapshot.yml` 每周一北京时间 08:00 运行，也保留手动验收入口。手动运行默认复用最近已采集动态并跳过 X/Trump 请求，适合生成失败后低成本重试；取消勾选 `reuse_social_input` 才会重新采集。定时运行始终采集最新动态。工作流通过 Repository Secrets 读取 X、DeepSeek 和可选的 CoinGecko Demo Key，并用路径白名单发布根目录和 `static-site/` 两份公开快照；网页前端和提交内容都不会包含密钥。
- `.openai/hosting.json` 只包含 Sites 项目标识和逻辑绑定，不包含访问凭证。

GitHub 仓库应上传整个项目。当前 GitHub Pages 从 `main` 根目录发布，因此人物雷达成功后会把 `static-site/data/` 原子同步到根目录 `data/`；两个目录必须指向同一快照版本。真实密钥只保存在 GitHub Repository Secrets，不会回写到仓库。
