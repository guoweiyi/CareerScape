# 按功能交付记录

日期：2026-10-08（Asia/Shanghai）。仓库初始为空，远程 HEAD 无 commit；本地初始符号分支 main，不假定已有保护策略。开发分支 `feat/h5-mvp`。未部署、未强推、未合并。

| featureId | 验收范围 | 实现/验证 | 提交与远端 |
|---|---|---|---|
| F01-foundation | Nuxt 4、严格TS、锁版本、质量门禁 | 安装/peer通过；最终build/SSR已通过，Windows修正在F04 | 9ac7c3b；已push并ls-remote核实 |
| F02-content | 1职业、3人物、1项目、14模板、8节点、DSL、组局、3路线、JSONL | 提交时25测试通过；CLI隔离SQLite生成校验14/14，mock估算764tokens/费用0；资源门禁拒绝未就绪包 | f567e21；已push并ls-remote核实，后续v2因果修正在F03b |
| F03-service | 数据库、Argon2id身份、事务/租约/幂等、恢复、分支、AI适配 | 提交时18真实DB测试；迁移/seed/备份恢复CLI实跑 | fe2f477；已push并ls-remote核实 |
| F03b-recovery | 严格归档导入、版本v2/历史v1、流容量、开局安全包回退、明确意图确认 | 提交时63项总回归通过；长中文、重签归档篡改、组局失败与冻结资产测试 | 9256978；已push并ls-remote核实 |
| F04-player | H5、聊天、手账、账号、存档、离线恢复、低流量与预取 | 最终5项浏览器测试全部通过，手账保存后刷新原文保持；手机/桌面实拍 | ef76a5d；已push并ls-remote核实 |
| F05-art | 12立绘、3头像、4独立横/竖背景、品牌、界面组件 | v1/v2哈希/透明/许可门禁通过；38WebP合计4.49MB，21母版本地保留 | 14241e0；已push并ls-remote核实 |
| F06-admin | 审核发布回退、RBAC、审计、批次预算/续跑、seed预览、自愿反馈 | 真实浏览器完整发布与回退；反馈明确同意且不附私密内容；总69项单元/服务测试通过 | ba0d37d；已push并ls-remote核实 |
| F07-acceptance | 浏览器、回归、部署准备、截图、25主题追踪与CI | 本地与GitHub Ubuntu CI全部通过，见下表与运行链接 | a24090e；已push并ls-remote核实，CI success |
| F08-endings | 本人结局回顾、冻结版本摘要、原分支链接与待确认动作恢复 | 新增9项SQLite测试；真实浏览器核对已提交记录、回溯保留、原编号IndexedDB持久化和跨分支显式恢复 | 363e73b；已push并ls-remote核实，CI success |
| F09-studio | 已有节点图形编辑、JSON互通、图诊断、脏数据保护、审核发布 | 新增15项纯函数测试；真实浏览器编辑/循环诊断/保存重读/发布回退/旧局冻结与手机无横向溢出通过 | 480c4dc；已push并ls-remote核实，CI success |
| F10-container-ci | CI/CD、贡献说明、多阶段Docker、同镜像验证后发布Docker Hub | actionlint 1.7.12、Compose、Linux/amd64实际build与完整容器smoke均通过；Secrets只用于受限发布job | 22d5468；已push并ls-remote核实；远端运行与发布另记 |
| F11-dialogue-reader | 已提交对白逐段阅读、可选自动翻段、暂停和减少动态 | 新增7项纯函数测试与1项浏览器流程；全量100项测试、8项浏览器、类型、lint、生产build通过 | a009575；已push并ls-remote核实；远端运行与发布另记 |

## CI 首次运行与验收修正

首次完整运行 [37778245773](https://github.com/guoweiyi/CareerScape/actions/runs/37778245773) 在类型、lint、100项单元/服务测试、美术和生产build后，通过了包括逐段阅读在内的7项浏览器流程，但原响应丢失恢复用例失败，后续Docker与发布被阻止。前一运行37778113546由同分支新提交取消；二者都不记作通过。

失败trace显示服务端动作已200完成，客户端恢复GET紧随abort发起，却没有响应时间或JS异常。证据指向测试中`times:1`自动解除最后一个拦截器与恢复请求的时序竞态。改为仅截断首个已提交动作的响应，等待恢复确认后显式解除拦截；新增服务端`turn_committed`与仅一次提交的断言，没有给产品加重试或放宽测试超时。修正后定向重复5次通过，完整8项E2E再次通过（23.5秒）。同时核对官方release和action.yml，升级固定到Node24运行时的Actions；远端最终结果以下一次运行实际返回为准。

## 逐段阅读本地验证

2026-10-08：当前回合已提交人物/旁白可手动翻段，也可显式开启3–12秒阅读计时。关闭、隐藏、回合/分支变化或读完后停止；不会选择选项、发送请求或推进状态。浏览器使用受控时钟验证播放、暂停、读完、关闭重开和已提交回合更新；页面隐藏通过Chromium中的visibility事件模拟，不冒称真机切后台验收。UI实拍`reader-390.png`、`reader-1440.png`已检查。

本轮最终本地门禁：14文件100项Vitest通过；8项E2E通过/40.1秒；Nuxt与根TypeScript、全项目lint通过；生产build34.9秒成功。CI/CD功能与阅读功能分别提交，最终远端核验以包含二者的最新提交为准。同分支新运行按工作流规则取消旧运行，不将被取消的中间运行记作通过。

## Docker 与贡献流程本地验证

2026-10-08：新增`CONTRIBUTING.md`、PR模板与`docs/ci-cd.md`。工作流分为check→docker→publish，使用固定SHA的官方Actions；先验证、打包同一个镜像，再在原仓库默认分支或v*标签按授权发布到`yunyunjuan/careerscape`。PR不登录，缺少`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`时仍提供镜像artifact并明确跳过推送。

本机Docker Desktop实际构建Linux/amd64运行镜像，ID为`sha256:9cd9d0872e3a433e015d1156d6e84561c805f697c3a3f68440a316ee5515ac69`，87,372,476 bytes。真实容器smoke验证UID1000、只读根目录、SQLite/Argon2、游客认领、已提交动作与回执、v1/v2固定清单38个WebP的hash、管理员授权审计，以及重启与重建容器后账号/存档/手账持久化。测试过程中发现随机端口在restart后可能改变，已修为重新读取映射；测试资源已清理。全项目lint、工作流actionlint、Compose配置检查通过。本地镜像验证不代表Docker Hub已经发布，远端结果另记。

## P1 本轮本地门禁

2026-10-08 继续推进：Nuxt与根TypeScript、全项目lint通过；13文件93项单元/服务测试通过；生产构建26.4秒完成；7项浏览器测试最终21.7秒全部通过。已有5项回归与新增结局/编辑器2项都实际运行；新增6张结局、节点图与表单的手机/桌面截图，并保留此次回归更新的既有截图。详情见[验收记录](verification.md)。

浏览器验收发现并修复三项问题：响应式 pending 无法写入 IndexedDB；显式回看分支与另一路线恢复竞争；移动工作台 grid 最小尺寸导致整页横向溢出。原动作编号经真实 IndexedDB 读取核对，正式发布仍经过原服务端门禁。新增/删除节点、拖拽、批量导入、自动播放与成就尚未实现；真实AI、行业审核、真机与公网部署限制沿用P0记录。

## P1 远端确认

两个独立功能依次push。结局提交完整SHA `363e73b5e70fa8a4f96bef6d7068355291092e71` 的 [CI 37722927151](https://github.com/guoweiyi/CareerScape/actions/runs/37722927151) 和编辑器提交完整SHA `480c4dc630b0d3eea2b5e7c74c6a8f21d84a36ae` 的 [CI 37723048742](https://github.com/guoweiyi/CareerScape/actions/runs/37723048742) 均已返回 `completed / success`。

最新代码在Ubuntu完成安装、Nuxt/根TS、lint、93项测试、v1/v2美术校验、生产build及7项浏览器流程，页面证据随CI artifact上传。最后仅补记本文及验收文档，未更改执行代码；按工作流规则，纯docs变更不重复触发CI。本机最终生产预览为`http://127.0.0.1:3000`，沿用预览SQLite和mock模型，不是公网部署。

## P0 本地门禁（历史基线）

| 命令 | 实际结果 |
|---|---|
| `pnpm peers check` | 无问题 |
| `pnpm typecheck` / `pnpm exec tsc --noEmit` | 均通过 |
| `pnpm lint` | 通过 |
| `pnpm test` | 11个文件，69项通过 |
| `node scripts/art/verify.mjs v1` / `v2` | 均通过，读取真实文件核对hash/尺寸/alpha/预算/制作及许可记录 |
| `pnpm build` | 最新手账修复后25.9秒成功，含少量上游依赖警告 |
| `pnpm test:e2e` | 最新5项通过，11.7秒，独立SQLite生产服务 |
| `node scripts/capture.mjs` | 两套关键界面实拍，无pageerror、无横向溢出，最终手账原文实际查看 |

远端仓库开始为空，以上每个功能提交均逐次push，未强推或合并。最终本地生产预览在loopback端口3000；不是公网部署。真实模型、行业人工审核、真机软键盘/微信与生产代理仍为条件验证，详见`verification.md`。

## 远端确认

GitHub Actions [P0 checks / 37665752230](https://github.com/guoweiyi/CareerScape/actions/runs/37665752230) 的最终 `status=completed`、`conclusion=success`，核验提交为完整SHA `a24090ea98709ea7a40789aedf34dc86e6474e70`。Linux上安装、Nuxt和根TS、lint、69项测试、两版美术、build及5项浏览器检查均成功，页面证据已作为CI artifact上传。

最后仅补记本段与验收文档；没有改动已验证代码。CI对仅docs/README变更跳过重跑，此次结果仍对应全部可执行交付。空仓库首推后，GitHub报告默认分支为`feat/h5-mvp`；没有既有main可发起PR，也没有擅自合并或改写分支策略。
