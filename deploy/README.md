# 人物兴趣雷达每周任务

这里仅部署“人物兴趣雷达”，不提供链上概览、地址追踪、用户画像、地址关联或实时交易接口。

每次任务依次完成：

1. 从 `trump.fm` 读取特朗普的 Truth Social 归档。
2. 使用 X App Bearer Token 读取马斯克、Vitalik 和 CZ 的公开动态。
3. 补充市场指标，调用 DeepSeek 生成关键词与四章数据故事。
4. 校验证据、指标、排名和故事结构。
5. 只把通过校验的公开快照提交到 GitHub `main`，供 GitHub Pages 读取。

原始动态输入、市场输入、增量游标、失败候选和所有密钥只保留在服务器，不进入自动提交。发布脚本在推送前会确认本地 `main` 与远程完全一致，并使用路径白名单限制提交范围；远程有新代码时任务会安全失败，绝不会强推覆盖。

## 0. 前置条件

- 先合并包含本目录的 PR，服务器只部署 `main`。
- 服务器安装 Node.js `22.14.0` 或更高版本、Git 和 OpenSSH Client；`/usr/bin/node` 必须存在。
- X 账户有读取用户公开动态所需的额度，DeepSeek 账户有可用余额。
- 不要把 X、DeepSeek、服务器登录密钥或 GitHub 私钥粘贴进仓库、Issue、PR 或网页前端。

## 1. 创建专用系统用户

```bash
sudo useradd --system --home-dir /var/lib/onchain-radar --create-home --shell /usr/sbin/nologin onchain-radar
sudo install -d -o root -g onchain-radar -m 0750 /etc/onchain-radar
sudo install -d -o onchain-radar -g onchain-radar -m 0750 /opt/onchain-radar-worker
sudo install -d -o onchain-radar -g onchain-radar -m 0750 /var/lib/onchain-radar/social-input /var/lib/onchain-radar/market-input
```

如果用户已经存在，`useradd` 会提示已存在，可以继续后续步骤。

## 2. 配置仓库专用 Deploy Key

在服务器生成一把只用于此仓库的密钥：

```bash
sudo ssh-keygen -t ed25519 -N '' -C onchain-radar-publisher -f /etc/onchain-radar/github_deploy_key
sudo chown root:onchain-radar /etc/onchain-radar/github_deploy_key
sudo chmod 0640 /etc/onchain-radar/github_deploy_key
sudo chmod 0644 /etc/onchain-radar/github_deploy_key.pub
```

复制 `.pub` 文件内容，进入 GitHub 仓库 `Settings → Deploy keys → Add deploy key`，勾选 `Allow write access`。私钥文件不能离开服务器。

```bash
sudo cat /etc/onchain-radar/github_deploy_key.pub
```

保存 GitHub 主机公钥并对照 GitHub 官方公布的 SSH 指纹核验：

```bash
ssh-keyscan -t ed25519 github.com | sudo tee /etc/onchain-radar/known_hosts >/dev/null
sudo chmod 0644 /etc/onchain-radar/known_hosts
sudo ssh-keygen -lf /etc/onchain-radar/known_hosts
```

官方指纹页面：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints>

## 3. 克隆代码并初始化服务器运行数据

```bash
sudo -u onchain-radar env GIT_SSH_COMMAND='/usr/bin/ssh -i /etc/onchain-radar/github_deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/onchain-radar/known_hosts -o StrictHostKeyChecking=yes' \
  git clone git@github.com:lei-xy24/onchain-flow-visualizer.git /opt/onchain-radar-worker

sudo install -d -o onchain-radar -g onchain-radar -m 0750 /opt/onchain-radar-worker/work
sudo install -o onchain-radar -g onchain-radar -m 0640 /opt/onchain-radar-worker/data/social-input/latest.json /var/lib/onchain-radar/social-input/latest.json
sudo install -o onchain-radar -g onchain-radar -m 0640 /opt/onchain-radar-worker/data/market-input/latest.json /var/lib/onchain-radar/market-input/latest.json
```

运行数据放在 `/var/lib/onchain-radar`，避免 X 原始输入和游标污染 Git 工作区。

## 4. 保存 X 和 DeepSeek 密钥

创建仅由 systemd 读取的环境文件：

```bash
sudo install -o root -g root -m 0600 /dev/null /etc/onchain-radar.env
sudoedit /etc/onchain-radar.env
```

填入实际值；不要在聊天、终端截图或 GitHub 中公开这些值：

```env
X_BEARER_TOKEN="替换为真实 Bearer Token"
DEEPSEEK_API_KEY="替换为真实 DeepSeek Key"
DEEPSEEK_MODEL="deepseek-v4-pro"
TRUMP_FM_BASE_URL="https://trump.fm"

SOCIAL_INPUT_FILE="/var/lib/onchain-radar/social-input/latest.json"
X_STATE_FILE="/var/lib/onchain-radar/social-input/x-state.json"
TRUMP_FM_STATE_FILE="/var/lib/onchain-radar/social-input/trump-fm-state.json"
MARKET_INPUT_FILE="/var/lib/onchain-radar/market-input/latest.json"

RADAR_GITHUB_PUBLISH="1"
RADAR_GIT_REMOTE="origin"
RADAR_PUBLISH_BRANCH="main"
RADAR_GIT_AUTHOR_NAME="onchain-radar-bot"
RADAR_GIT_AUTHOR_EMAIL="onchain-radar-bot@users.noreply.github.com"
```

## 5. 安装并手动验收

```bash
sudo install -m 0644 /opt/onchain-radar-worker/deploy/systemd/onchain-radar-snapshot.service /etc/systemd/system/
sudo install -m 0644 /opt/onchain-radar-worker/deploy/systemd/onchain-radar-snapshot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start onchain-radar-snapshot.service
sudo systemctl status onchain-radar-snapshot.service --no-pager
sudo journalctl -u onchain-radar-snapshot.service -n 150 --no-pager
```

验收成功必须同时满足：

- 日志最后出现 `"delivery":"github"` 和发布成功信息。
- GitHub `main` 出现一条 `Update social radar snapshot ...` 提交。
- 该提交只修改根目录和 `static-site/` 下的 `data/latest-snapshot.json`、`data/snapshot-index.json`、`data/snapshots/*.json`。
- GitHub Pages 的人物兴趣雷达显示新的每周版本。

任何一步失败都不要启用 timer。常见状态：X `401/403` 是 Token 或权限问题，`402/429` 通常是额度或频率问题；DeepSeek 报余额或限额时应先处理账户余额。

## 6. 启用每周任务

```bash
sudo systemctl enable --now onchain-radar-snapshot.timer
systemctl list-timers onchain-radar-snapshot.timer --all
```

timer 在北京时间每周一 08:00 触发，并加入最多 45 秒随机延迟。某次采集、模型、校验或 GitHub 推送失败时，任务退出失败并保留网站上一份成功快照。

## 更新服务器代码

远程 `main` 有新代码时，发布预检会停止自动任务。人工更新：

```bash
sudo systemctl stop onchain-radar-snapshot.timer
sudo -u onchain-radar env GIT_SSH_COMMAND='/usr/bin/ssh -i /etc/onchain-radar/github_deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/onchain-radar/known_hosts -o StrictHostKeyChecking=yes' \
  git -C /opt/onchain-radar-worker fetch origin main
sudo -u onchain-radar git -C /opt/onchain-radar-worker merge --ff-only origin/main
sudo systemctl start onchain-radar-snapshot.timer
```

如果 `merge --ff-only` 失败，不要使用 `reset --hard` 或强推；先检查本地日志和 Git 状态，再人工处理。
