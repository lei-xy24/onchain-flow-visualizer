# df-flow-tracker 静态版

静态版包含两套独立功能：

- `index.html`：首页，展示各链基础数据，右上角是四个功能入口。
- `track.html`：只显示搜索框，不读取资金流 JSON。
- `result.html`：接收链和地址，向后端请求该地址的数据并显示结果。
- `mock-api/`：后端尚未完成时使用的逐地址模拟响应。
- `live.html`：搜索 ETH、BNB/BSC 或 POL/Polygon。
- `live-result.html`：每 10 秒请求一次最近 10 秒交易并绘制动态图谱。
- `mock-live/`：ETH、BSC 和 Polygon 各五批、共 50 秒的实时交易演示数据。

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

首页不直接调用 Etherscan。它只向自己的后端请求一个概览 JSON，由后端去调 Etherscan 再汇总返回。首页里的 `BACKEND_API_URL` 为空时显示内置演示数据；填入后端地址后请求真实数据，请求失败时回退到演示数据。这样 Etherscan 的 key 只存在后端，不会暴露在静态页面里。

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
2. 跳转到独立结果页。

示例跳转地址：

```text
result.html?chain=eth&address=0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97
```

## 后端请求

真实后端地址定义在 `result.html`：

```js
const BACKEND_API_URL = "";
```

后端上线后改成：

```js
const BACKEND_API_URL = "https://api.example.com/flow";
```

结果页会发送：

```http
GET https://api.example.com/flow?chain=eth&address=0x...
Accept: application/json
```

每次搜索只发送一次请求，只读取被搜索地址的数据，不会下载其他账户的数据。

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

真实后端地址在 `live-result.js` 中配置：

```js
const BACKEND_API_URL = "https://api.example.com/live-transfers";
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
```

## GitHub Pages 上传内容

后端尚未上线、需要保留示例数据时，上传：

```text
index.html
track.html
result.html
mock-api/
live.html
live-result.html
live.css
live-search.js
live-core.js
live-result.js
mock-live/
```

两个后端都上线并配置对应的 `BACKEND_API_URL` 后，可以删除 `mock-api/` 和 `mock-live/`，但仍需上传所有 HTML、CSS 和 JS 文件。

```text
index.html
track.html
result.html
live.html
live-result.html
live.css
live-search.js
live-core.js
live-result.js
```

`README.md` 可选。
