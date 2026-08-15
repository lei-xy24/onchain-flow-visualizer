# df-flow-tracker 静态版

静态版包含两套独立功能：

- `index.html`：首页，展示各链基础数据，右上角是四个功能入口。
- `runtime-config.js`：统一配置后端团队提供的公开接口地址；留空时使用演示数据。
- `track.html`：显示地址搜索框与本机搜索历史，不读取资金流 JSON。
- `search-history.js`：管理最近 10 条搜索记录、筛选、复用和清除操作。
- `address-history.js`：让用户画像和地址关联共用同一份地址搜索历史。
- `result.html`：接收链和地址，向后端请求该地址的数据并显示结果。
- `mock-api/`：后端尚未完成时使用的逐地址模拟响应。
- `live.html`：通过选择框进入 ETH、BSC 或 Polygon 实时图谱。
- `live-result.html`：每 10 秒请求一次最近 10 秒交易并绘制动态图谱。
- `mock-live/`：ETH、BSC 和 Polygon 各五批、共 50 秒的实时交易演示数据。
- `profile.html` / `profile.js`：生成账户画像。
- `relation.html` / `relation.js`：查询两个地址的直接关联交易。
- `analysis-loading.js`：用户画像与地址关联共用的全屏加载过渡页。
- `hot-topic.html`：人物兴趣雷达，分析人物近期公开动态并归纳兴趣主题。
- `event-explorer.html`：从人物兴趣主题进入的数据故事页，展示主题规模、趋势、排名与观察结论。
- `data/`：最近成功快照、历史版本索引和按三小时保存的快照文件。

页面流程：

```text
track.html
  -> 用户选择链并输入地址
  -> result.html?chain=eth&address=0x...
  -> GET 后端接口?chain=eth&address=0x...
  -> 后端只返回该地址的 JSON
  -> result.html 校验并显示
```

## 首页行为

`index.html` 是首页，展示四块内容：核心指标条、多链运行状态、稳定币大额转账、重点协议活动。

首页不直接调用 Etherscan。它只向 `runtime-config.js` 中配置的 `overview` 地址请求概览 JSON，由后端团队负责数据源与汇总。接口未配置或请求失败时页面会明确提示并回退到演示数据；任何供应商密钥都不应出现在静态页面里。

稳定币大额转账和重点协议中显示的地址均可点击，点击后会携带 ETH 网络和完整地址进入地址追踪结果页。

## 首页后端接口

前端发送：

```http
GET https://api.example.com/overview
Accept: application/json
```

后端返回：

```json
{
  "metrics": {
    "blockNumber": "0x1661f60",
    "gasOracle": { "SafeGasPrice": "4.2", "ProposeGasPrice": "5.1", "FastGasPrice": "6.8", "suggestBaseFee": "4.05" },
    "ethPrice": { "ethusd": "4482.16", "ethbtc": "0.0392" },
    "dailyTx": { "UTCDate": "2026-07-28", "transactionCount": "1284530" },
    "networkUtilization": { "UTCDate": "2026-07-28", "networkUtilization": "0.5324" }
  },
  "chains": [
    {
      "chain": "eth",
      "latestBlock": { "number": "0x1661f60", "gasUsed": "0x11bde28", "gasLimit": "0x1c9c380" },
      "avgBlockTime": { "UTCDate": "2026-07-28", "blockTime_sec": "12.06" }
    }
  ],
  "largeTransfers": [
    {
      "hash": "0x...",
      "from": "0x...",
      "to": "0x...",
      "value": "28600000000000",
      "tokenSymbol": "USDT",
      "tokenDecimal": "6",
      "timeStamp": "1753776000"
    }
  ],
  "protocols": [
    { "name": "Uniswap V3 工厂", "type": "dex", "address": "0x1F98431c...", "eventCount": 24 }
  ]
}
```

说明：

- `chains` 按 eth、bsc、polygon 各返回一项，`chain` 取值与其他页面一致。
- `largeTransfers` 是 USDT/USDC 的最近转账，条目结构就是 Etherscan `tokentx` 的原始行。后端可以先按金额过滤；前端也会再过滤一次，只显示折算后不低于 100 万的，最多 8 条。
- `protocols` 的 `type` 取值为 `dex`、`lending`、`bridge`，前端会显示为中文；`eventCount` 由后端统计得出。
- 前端页面上不标注数据来源接口；每个字段与 Etherscan V2 API 的对应关系见下表。

## 首页字段与 Etherscan API 对应表

Etherscan V2 统一接口为 `https://api.etherscan.io/v2/api?chainid={id}`，eth 用 `chainid=1`，bsc 用 `chainid=56`，polygon 用 `chainid=137`。标注 Pro 的需要付费 key。

| 响应字段 | Etherscan 接口 | 是否 Pro | 说明 |
| --- | --- | --- | --- |
| `metrics.blockNumber` | `module=proxy&action=eth_blockNumber`（chainid=1） | 否 | 原样透传十六进制区块号 |
| `metrics.gasOracle` | `module=gastracker&action=gasoracle`（chainid=1） | 否 | 原样透传 `result` 对象 |
| `metrics.ethPrice` | `module=stats&action=ethprice`（chainid=1） | 否 | 原样透传 `result` 对象 |
| `metrics.dailyTx` | `module=stats&action=dailytx`（chainid=1） | 是 | 取最近一天的那一行 |
| `metrics.networkUtilization` | `module=stats&action=dailynetutilization`（chainid=1） | 是 | 取最近一天的那一行 |
| `chains[].latestBlock` | `module=proxy&action=eth_getBlockByNumber&tag=latest&boolean=false` | 否 | 只需 `number`、`gasUsed`、`gasLimit` 三个字段，燃料占用由前端计算 |
| `chains[].avgBlockTime` | `module=stats&action=dailyavgblocktime` | 是 | 取最近一天的那一行 |
| `largeTransfers[]` | `module=account&action=tokentx&contractaddress={USDT或USDC}&sort=desc`（chainid=1） | 否 | USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`，USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `protocols[].eventCount` | `module=logs&action=getLogs&address={协议地址}&fromBlock={最新区块-2000}&toBlock=latest`（chainid=1） | 否 | 后端统计返回日志条数。Uniswap V3 工厂 `0x1F98431c8aD98523631AE4a59f267346ea31F984`，Aave V3 资金池 `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`，Polygon 跨链桥 `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf` |

前端每 10 秒向后端请求一次概览 JSON。后端调用 Etherscan 时注意频率限制，免费 key 是每秒 5 次；建议后端对各接口做缓存（区块 10 秒左右，每日统计可以缓存到小时级），不要把前端的每次请求都透传给 Etherscan。

## 地址搜索页行为

`track.html` 不执行 `fetch()`，只负责：

1. 校验链和 EVM 地址。
2. 将最近 10 条有效搜索保存到当前浏览器的 `localStorage`。
3. 跳转到独立结果页。

搜索框获得焦点时会展开历史记录。记录按最近使用时间排序，同一条链上的同一地址会自动去重；用户可以点击再次搜索、删除单条记录或全部清空。历史数据只保存在当前浏览器，不会随查询发送给后端。

示例跳转地址：

```text
result.html?chain=eth&address=0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97
```

## 后端请求

所有公开后端地址统一定义在 `runtime-config.js`：

```js
window.ONCHAIN_API_CONFIG = Object.freeze({
  overview: "https://api.example.com/overview",
  flow: "https://api.example.com/flow",
  liveTransfers: "https://api.example.com/live-transfers",
});
```

结果页会发送：

```http
GET https://api.example.com/flow?chain=eth&address=0x...
Accept: application/json
```

每次搜索只发送一次请求，只读取被搜索地址的数据，不会下载其他账户的数据。

请求期间，结果页会显示独立加载界面，并依次反馈“连接数据接口、读取响应数据、校验并生成图谱”三个阶段。后端返回成功后自动切换到结果图谱，请求失败时仍保留重新读取入口。

如果 `BACKEND_API_URL` 为空，结果页会使用本地 mock：

```text
./mock-api/{chain}/{小写地址}.json
```

例如：

```text
./mock-api/eth/0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97.json
```

## 后端响应格式

后端返回的是一个中心账户，不再是“全部链 -> 全部地址”的大对象：

```json
{
  "chain": "eth",
  "address": "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
  "label": "Account label",
  "input": [],
  "output": []
}
```

- `chain` 必须与请求中的链一致。
- `address` 必须与请求中的地址一致，比较时不区分大小写。
- `input` 表示交易对手方向中心账户转账。
- `output` 表示中心账户向交易对手方转账。

如果后端返回了另一个链或另一个地址的数据，结果页会拒绝显示，避免数据串线。

## 单条转账格式

```json
{
  "id": "eth-input-1",
  "address": "0xA91c7F2b2f32E7d42A61A0C4A53e80B3d8D7C91A",
  "time": "2026-07-09T09:42:18Z",
  "rawAmount": "8420000000000000000",
  "decimals": 18,
  "asset": "ETH",
  "assetAddress": null,
  "txHash": "0x7d3d2f8b7d7d5e9d01a6b2073d2a531d74fb8f93d6b18d26c2b2d4f93a3d4812",
  "tag": "Exchange hot wallet"
}
```

| 字段 | 类型 | 是否必填 | 含义 |
| --- | --- | --- | --- |
| `id` | string | 是 | 当前响应中唯一且稳定的转账 ID |
| `address` | string | 是 | 交易对手方 EVM 地址 |
| `time` | string | 是 | 可解析的 ISO 8601 时间 |
| `rawAmount` | string | 是 | 链上最小单位整数，只能包含数字 |
| `decimals` | integer | 是 | 资产小数位，范围 0 到 255 |
| `asset` | string | 是 | 资产符号 |
| `assetAddress` | string/null | 是 | 代币合约地址；原生资产填 `null` |
| `txHash` | string | 是 | `0x` 加 64 位十六进制交易哈希 |
| `tag` | string | 否 | 交易对手方标签 |

金额按照 `rawAmount / 10^decimals` 显示和汇总，计算过程使用整数，避免浮点误差。

## 实时交易图谱

入口页与结果页的流程：

```text
live.html
  -> 用户搜索或选择币种
  -> live-result.html?chain=eth
  -> 立即请求最近 10 秒交易
  -> 每 10 秒替换当前交易线，并把新账户增量加入已有图谱
```

账户节点在当前页面会话中只增不减。某个账户在后续 10 秒没有新交易时，节点仍保留在原位置并显示为历史账户；只有当前窗口的交易线会更新。新增账户优先放在其交易对手附近的空闲位置，已有节点保持原坐标。节点持续增加导致空间不足时，布局只围绕画布中心做等比例压缩，不重新排序。

实时交易同样读取 `runtime-config.js`：

```js
liveTransfers: "https://api.example.com/live-transfers"
```

前端会每 10 秒发送：

```http
GET https://api.example.com/live-transfers?chain=eth&from=2026-07-16T08%3A00%3A00.000Z&to=2026-07-16T08%3A00%3A10.000Z
Accept: application/json
```

`from` 和 `to` 相差 10 秒。后端应返回这个时间窗口内的全部转账，不要分页或只返回大额交易。

`id` 必须在持续数据流中稳定且唯一。前端使用它去重累计统计；即使接口因为重试重复返回一笔交易，也不会重复增加账户的累计金额和交易次数。

当 `BACKEND_API_URL` 为空时，页面每次从下面路径读取一批数据。每批覆盖 10 秒，五批连续播放 50 秒后重新循环：

```text
./mock-live/{chain}/batch-1.json
./mock-live/{chain}/batch-2.json
./mock-live/{chain}/batch-3.json
./mock-live/{chain}/batch-4.json
./mock-live/{chain}/batch-5.json
```

### 实时后端响应

```json
{
  "chain": "eth",
  "window": {
    "from": "2026-07-16T08:00:00Z",
    "to": "2026-07-16T08:00:10Z"
  },
  "transfers": [
    {
      "id": "eth-live-1-1",
      "from": "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
      "to": "0xA91c7F2b2f32E7d42A61A0C4A53e80B3d8D7C91A",
      "fromLabel": "Demo Exchange",
      "toLabel": "Bridge Vault",
      "time": "2026-07-16T08:00:01Z",
      "rawAmount": "5000000000000000000",
      "decimals": 18,
      "asset": "ETH",
      "assetAddress": null,
      "txHash": "0x7d3d2f8b7d7d5e9d01a6b2073d2a531d74fb8f93d6b18d26c2b2d4f93a3d4812"
    }
  ]
}
```

| 字段 | 类型 | 是否必填 | 含义 |
| --- | --- | --- | --- |
| `chain` | string | 是 | `eth`、`bsc` 或 `polygon`，必须与请求一致 |
| `window.from` | string | 是 | 时间窗口开始，ISO 8601 |
| `window.to` | string | 是 | 时间窗口结束，ISO 8601 |
| `transfers` | array | 是 | 窗口内的全部转账，无交易时为 `[]` |
| `id` | string | 是 | 稳定且唯一的转账 ID |
| `from` | string | 是 | 付款方 EVM 地址 |
| `to` | string | 是 | 收款方 EVM 地址 |
| `fromLabel` | string | 否 | 付款账户标签 |
| `toLabel` | string | 否 | 收款账户标签 |
| `time` | string | 是 | 转账时间，ISO 8601 |
| `rawAmount` | string | 是 | 链上最小单位整数，只能包含数字 |
| `decimals` | integer | 是 | 资产小数位，0 到 255 |
| `asset` | string | 是 | 资产符号，如 `ETH`、`BNB` 或 `POL` |
| `assetAddress` | string/null | 是 | 代币合约地址；原生资产填 `null` |
| `txHash` | string | 是 | `0x` 加 64 位十六进制交易哈希 |

### 点状线密度规则

所有链都按币数量数量级使用同一套规则，计算值为 `log10(rawAmount / 10^decimals)`：

| 密度等级 | 数量级 | 点间距 `dotGap` |
| --- | --- | --- |
| 1 | `< 1` | 28 |
| 2 | `1 - 99.999999` | 22 |
| 3 | `100 - 9,999.999999` | 18 |
| 4 | `10,000 - 999,999.999999` | 13 |
| 5 | `>= 1,000,000` | 8 |

`dotGap` 越小，同一条路径上的运动点越密。方向只由运动点从 `from` 流向 `to` 来表达，不显示箭头。

### 资金追踪金额显示

资金追踪结果页默认只按查询链的原生币种显示样例资金，例如 ETH 链只显示 ETH，BSC 只显示 BNB，Polygon 只显示 POL。页面上的“单位转换：美元”按钮使用前端固定演示汇率估算，不请求行情接口；后端仍只需要返回链上原始金额字段。

## 用户画像与地址关联

用户画像和地址关联的地址输入框会读取与地址追踪相同的最近 10 条搜索记录。用户画像选择一条历史后会直接重新生成画像；地址关联的两个输入框分别可以从历史中选择地址。三处历史都只保存在当前浏览器中，支持单条删除和全部清空。

两页读取数据期间会显示与资金追踪一致的全屏过渡页，展示当前网络、地址和处理阶段。请求超过 12 秒会自动结束加载并显示超时提示；读取失败时会显示重新生成或重新查询按钮，不会继续停留在“正在生成”状态。

## 人物兴趣与主题数据故事

`hot-topic.html` 不在浏览器内调用大模型，而是读取 `data/snapshot-index.json` 指向的最近一份成功快照。快照由根目录的 `scripts/generate-social-radar-snapshot.mjs` 生成：它只读取人物最近 7 天的公开动态，对模型返回的证据引用、主题类型、市场指标和故事章节进行程序校验，通过后才原子发布。某次生成失败时不会覆盖上一份成功结果。

页面顶部可以切换历史三小时版本。进入 `event-explorer.html` 时，人物、主题和快照 id 会一起写入 URL，主题页从同一份快照读取指标、趋势、排名和故事，不再分别读取两份写死的 mock 文件。

点击兴趣主题后进入 `event-explorer.html`。主题故事分为四章：

1. 说明兴趣主题是如何从多条公开信号中归纳出来的。
2. 展示该主题的核心规模或长期趋势。
3. 展示网络、板块、项目方向或应用场景的排名和结构。
4. 收束成三条值得持续跟踪的数据问题。

不同主题使用不同的数据口径。例如稳定币侧重市场规模与网络分布，公链侧重用户与应用生态，DeFi 侧重流动性与资本效率，隐私技术侧重研发与采用。仓库内已发布三份演示快照，用于验证版本切换；其中的社交信号和市场指标明确标记为演示输入，不代表人物的真实实时行为。

### 三小时自动生成

本地生成演示快照：

```bash
npm run radar:demo
```

真实生成需要在任务环境中提供 `X_BEARER_TOKEN` 和 `DEEPSEEK_API_KEY`。特朗普通过不需要密钥的 `trump.fm` API 读取 Truth Social 归档，并在 `data/social-input/trump-fm-state.json` 保存增量位置；马斯克、Vitalik 和 CZ 通过 X API 采集，并在 `data/social-input/x-state.json` 保存 `since_id`。两路数据合并为滚动 7 天输入；市场适配器默认从 CoinGecko 公共接口生成实时市值、成交量、趋势估算与排名。可先复制 `.env.example` 查看环境变量名；密钥不能放到 `static-site/`。

GitHub Actions 的三小时任务依次执行：

1. 使用 `trump.fm` REST API 读取特朗普的 Truth Social 归档，使用 X API `GET /2/users/{id}/tweets` 读取另外三人；两路都排除转发，回复权重为 0.5。
2. 调用 DeepSeek JSON Output，归纳主题并生成四章故事；默认使用关闭思考模式的 `deepseek-v4-flash` 控制成本。
3. 校验来源 id、证据数量、允许的主题、市场指标和故事结构。
4. 只在全部通过后更新 `static-site/data/`，再同步根目录 `data/` 并提交快照，供 GitHub Pages 读取。

人物最近 7 天不足两条动态时，不会为了凑主题而让模型生成结论；该人物本期不进入分析。所有人物都不足两条时，本次任务不发布，页面继续展示上一份成功快照。

三小时调度使用 `.github/workflows/social-radar-snapshot.yml`，并保留手动验收入口。运行时需要 Repository Secrets `X_BEARER_TOKEN` 和 `DEEPSEEK_API_KEY`；`TRUMP_FM_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL` 和 `X_API_BASE_URL` 可按需覆盖。成功快照通过 `scripts/publish-radar-to-github.mjs` 同步到根目录和 `static-site/data/`，再以路径白名单提交到 `main`。原始动态、增量状态和密钥不会进入提交。`deploy/systemd/` 只作为可选的自托管替代方案，不应与 GitHub Actions 同时启用。

## CORS

GitHub Pages 是纯静态网站，不能自己运行后端。如果后端使用另一个域名，后端需要允许 GitHub Pages 域名跨域访问，例如：

```http
Access-Control-Allow-Origin: https://lei-xy24.github.io
Content-Type: application/json
```

## 本地运行

在项目根目录执行：

```bash
python3 -m http.server 8000 --directory static-site
```

然后访问：

```text
http://localhost:8000/index.html
http://localhost:8000/track.html
http://localhost:8000/live.html
http://localhost:8000/hot-topic.html
http://localhost:8000/event-explorer.html
```

## GitHub Pages 上传内容

后端尚未上线、需要保留示例数据时，上传：

```text
index.html
runtime-config.js
track.html
search-history.js
address-history.js
result.html
mock-api/
live.html
live-result.html
live.css
live-search.js
live-core.js
live-result.js
profile.html
profile.js
relation.html
relation.js
flow-demo-data.js
analysis-loading.js
mock-live/
hot-topic.html
hot-topic.css
hot-topic.js
snapshot-store.js
data/latest-snapshot.json
data/snapshot-index.json
data/snapshots/
event-explorer.html
event-explorer.css
event-explorer.js
assets/
```

后端接口上线并在 `runtime-config.js` 配置对应地址后，可以选择删除 `mock-api/` 和 `mock-live/`；保留它们则方便无后端环境演示。发布时仍需上传所有 HTML、CSS 和 JS 文件。

```text
index.html
runtime-config.js
track.html
search-history.js
address-history.js
result.html
live.html
live-result.html
live.css
live-search.js
live-core.js
live-result.js
profile.html
profile.js
relation.html
relation.js
flow-demo-data.js
analysis-loading.js
hot-topic.html
hot-topic.css
hot-topic.js
event-explorer.html
event-explorer.css
event-explorer.js
snapshot-store.js
data/
assets/
```

`README.md` 可选。
