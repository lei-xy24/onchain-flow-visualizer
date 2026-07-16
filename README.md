# df-flow-tracker 静态版

静态版包含两套独立功能：

- `index.html`：只显示搜索框，不读取资金流 JSON。
- `result.html`：接收链和地址，向后端请求该地址的数据并显示结果。
- `mock-api/`：后端尚未完成时使用的逐地址模拟响应。
- `live.html`：搜索 ETH、BNB/BSC 或 POL/Polygon。
- `live-result.html`：每 10 秒请求一次最近 10 秒交易并绘制动态图谱。
- `mock-live/`：ETH、BSC 和 Polygon 各两批实时交易演示数据。

页面流程：

```text
index.html
  -> 用户选择链并输入地址
  -> result.html?chain=eth&address=0x...
  -> GET 后端接口?chain=eth&address=0x...
  -> 后端只返回该地址的 JSON
  -> result.html 校验并显示
```

## 首页行为

`index.html` 不执行 `fetch()`，只负责：

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
  -> 每 10 秒重新请求并替换当前图谱
```

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

当 `BACKEND_API_URL` 为空时，页面每次从下面路径读取一批数据，并在两个批次之间循环：

```text
./mock-live/{chain}/batch-1.json
./mock-live/{chain}/batch-2.json
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
      "valueUsd": 17500,
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
| `asset` | string | 是 | 资产符号，如 `ETH` 或 `USDC` |
| `assetAddress` | string/null | 是 | 代币合约地址；原生资产填 `null` |
| `valueUsd` | number | 是 | 转账时的美元估值，用于跨币种统一密度 |
| `txHash` | string | 是 | `0x` 加 64 位十六进制交易哈希 |

### 点状线密度规则

所有链和所有资产都按 `valueUsd` 使用同一套规则：

| 密度等级 | 美元价值 | 点间距 `dotGap` |
| --- | --- | --- |
| 1 | `< $1,000` | 28 |
| 2 | `$1,000 - $9,999.99` | 22 |
| 3 | `$10,000 - $99,999.99` | 18 |
| 4 | `$100,000 - $999,999.99` | 13 |
| 5 | `>= $1,000,000` | 8 |

`dotGap` 越小，同一条路径上的运动点越密。路径始终从 `from` 指向 `to`，并在收款端显示箭头。

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
http://localhost:8000/live.html
```

## GitHub Pages 上传内容

后端尚未上线、需要保留示例数据时，上传：

```text
index.html
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
result.html
live.html
live-result.html
live.css
live-search.js
live-core.js
live-result.js
```

`README.md` 可选。
