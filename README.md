# 本地大模型部署检测站 (Local LLM Fit Checker)

检测电脑配置，判断能否本地部署主流开源大模型，对比不同配置下的 token 生成速度，
集成模型下载地址（HuggingFace / ModelScope / Ollama）与本地部署教程。

## 功能

- **浏览器端硬件检测**：CPU 核心数、内存（Chromium 粗估）、GPU 型号（WebGL）、磁盘空间，附手动修正面板（localStorage 持久化）
- **兼容性判断**：按量化等级（Q4_K_M / Q8_0 / FP16）计算内存/显存需求，给出 可运行 / 受限 / 内存不足 三级结论
- **速度对比**：基于「内存带宽决定生成速度」的物理模型 + 社区基准因子估算 tok/s，支持排序、筛选、条形图对比、可选浏览器基准校准
- **下载集成**：每个模型带 HuggingFace / ModelScope 直达链接 + 一键复制 `ollama pull` 命令
- **部署教程**：Ollama、LM Studio、llama.cpp、vLLM 完整步骤 + 量化科普 + FAQ

## 技术栈

纯静态：HTML + CSS + 原生 JavaScript，无任何依赖、无构建步骤、数据不出浏览器。

```
index.html         主页面（检测 + 对比）
tutorials.html     部署教程页
css/style.css      样式（深色主题）
js/models.js       模型数据库（体积/链接/ollama 命令）
js/estimate.js     GPU 数据库 + 需求计算 + 速度估算引擎
js/hardware.js     浏览器硬件检测 + 手动覆盖 + 基准校准
js/app.js          页面交互逻辑
```

## 使用

直接双击 `index.html` 即可使用（推荐用 Chrome/Edge）。
或本地起一个静态服务器：

```bash
python -m http.server 8000
# 访问 http://localhost:8000
```

也可直接部署到 GitHub Pages / Netlify / Vercel 等任意静态托管。

## 部署到 GitHub Pages（一键）

前置条件（一次性，约 5 分钟）：
1. 安装 git：`winget install Git.Git`
2. 安装 GitHub CLI：`winget install GitHub.cli`
3. 登录：`gh auth login`（选 GitHub.com → HTTPS → 浏览器登录）

然后运行一键脚本（自动建仓、推送、开启 Pages）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy-gh-pages.ps1
```

部署地址形如 `https://<你的用户名>.github.io/local-llm-check/`。
之后每次更新站点，重新运行脚本即可。

> 不想装工具？也可以直接把这个项目文件夹拖到 <https://app.netlify.com/drop> 免费上线。

## 数据维护

- 增删模型：编辑 `js/models.js`（体积、链接、`ollama` 标签）
- 增删显卡：编辑 `js/estimate.js` 的 `GPU_DB`
- 速度估算公式：`js/estimate.js` 的 `estSpeed()` / `cpuSpeed()`

## 说明

所有速度均为估算值（±30% 误差），仅用于横向对比；精确值请用 `llama-bench` 实测。
