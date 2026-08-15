# 区块链与数字金融服务安全测试平台前端

本仓库以 `static-site/` 前端为交付主体。链上概览、地址追踪、用户画像、地址关联和实时交易只消费后端团队提供的 HTTP 接口，本仓库不实现这些业务后端；接口地址统一配置在 `static-site/runtime-config.js`，留空时使用内置演示数据。

唯一需要单独服务器任务的是“人物兴趣雷达”：每三小时从 `trump.fm` 读取特朗普的 Truth Social 归档，并通过 X API 读取马斯克、Vitalik 和 CZ 的公开动态；随后补充公开市场指标，调用 DeepSeek 生成经过程序校验的关键词与数据故事。任务模板和验收方法见 `deploy/README.md`。

仓库结构：

- `static-site/`：GitHub Pages 的完整前端，也是当前业务交付主体。
- `scripts/`、`data/`：人物兴趣雷达的采集、市场数据和三小时快照生成逻辑。
- `deploy/`：以后启用人物雷达服务器任务时使用的 systemd 模板；当前不会自动运行。
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
- `.github/workflows/social-radar-snapshot.yml` 只有手动入口，没有定时触发；未配置 Secret 时不会自动调用 X 或 DeepSeek。
- `.openai/hosting.json` 只包含 Sites 项目标识和逻辑绑定，不包含访问凭证。

GitHub 仓库应上传整个项目；如果只发布 GitHub Pages，发布产物必须以 `static-site/index.html` 为站点入口。GitHub Pages 的分支发布设置只支持分支根目录或 `/docs`，因此可使用 Pages 工作流上传 `static-site/`，或把该目录内容发布到专用分支根目录。人物雷达以后启用服务器任务时，真实密钥只保存在服务器环境文件中，不要回写到仓库。
