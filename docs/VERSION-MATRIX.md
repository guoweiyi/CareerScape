# VERSION-MATRIX

运行时修复：Nuxt 4.6 / Nitro 2.13 的 Windows路径外置renderer导致SSR报错（构建本身成功），已在`nitro.externals.inline`加入跨平台路径正则并以生产浏览器验证。参考[Nuxt上游问题36467](https://github.com/nuxt/nuxt/issues/36467)。Pinia调用显式绑定当前Nuxt实例的`usePinia()`。构建仍有上游exports路径与pure-comment警告，退出码为0；没有隐藏为“零警告”。

核对日期：2026-10-08（Asia/Shanghai）。以下为实际安装版本；`pnpm-lock.yaml` 是依赖解析依据，未使用“Nuxt 3/4 均可”的悬置选择。

| 项目 | 锁定/实际版本 | 核对依据 |
|---|---|---|
| Node | 24.16.0 | 本机 `node --version`；Nuxt engine ^24.15.0 |
| pnpm | 12.6.0 | 本机、packageManager、CI固定 |
| Nuxt / Vue | 4.6.0 / 3.5.43 | npm元数据、实际构建 |
| Nitro / Vite | 2.13.4 / 8.3.3 | Nuxt锁文件与构建输出 |
| Nuxt UI / Tailwind | 4.11.3 / 4.3.3 | UI peer要求Tailwind ^4 |
| Pinia / Nuxt模块 | 4.0.3 / 1.0.2 | 实际安装与peer检查 |
| AI SDK / OpenAI provider | 7.0.130 / 4.0.86 | 实际导出、SDK7类型检查 |
| @ai-sdk/vue | 4.0.130 | 已安装导出核对；本应用领域流使用原生fetch，不使用其UI流 |
| Drizzle ORM / Kit | 0.45.3 / 0.31.11 | SQLite schema、实际DB测试 |
| better-sqlite3 | 12.11.1 | Windows Node24预编译包安装成功 |
| Argon2 | 0.45.1 | 实际Argon2id哈希/恢复测试 |
| Zod | 4.6.5 | 严格联合schema与实际类型检查 |
| TypeScript / vue-tsc | 6.0.3 / 3.3.12 | ESLint parser peer兼容，strict |
| Vitest / Vue Test Utils | 5.0.3 / 2.5.1 | 测试运行器及组件工具 |
| Playwright | 1.63.0 | Chromium 153.0.8010.12（v1243） |
| MSW | 2.15.0 | Vitest mocker要求^2.4.9 |
| ESLint / Nuxt ESLint | 10.12.0 / 1.17.0 | 实际lint |
| Prettier / tsx / sharp | 3.9.9 / 4.23.15 / 0.35.5 | 格式化、CLI、图片导出 |
| h3 | 1.15.11 | Nitro2接口直接依赖 |

实际修正：better-sqlite3 13.0.3 在本机要求缺失的Visual Studio C++工具，改为12.11.1；TS7超出当前ESLint parser peer范围、MSW3超出Vitest mocker peer范围，分别降至兼容版本。最终 `pnpm peers check` 无问题。

官方资料：[Nuxt 4 安装](https://nuxt.com/docs/4.x/getting-started/installation)、[Nuxt UI](https://github.com/nuxt/ui)、[AI SDK Nuxt](https://ai-sdk.dev/docs/getting-started/nuxt)、[Drizzle SQLite](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)。在线文档用于方向核对，具体API以已安装包类型和构建为准。Nuxt页面的浏览抓取返回不支持的Markdown格式，版本与engine由npm包元数据独立核对。
