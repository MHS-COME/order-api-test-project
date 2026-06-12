好的，我已经帮你整理了从项目初期到后期测试过程中遇到的主要 Bug 和解决记录。以下内容你可以保存为 `docs/项目Bug记录.md`。

```markdown
# 订单系统 API 自动化测试项目 - Bug 记录与解决方案

本文档记录了项目开发、测试运行及优化过程中遇到的主要问题、原因分析和解决方法，供后续复盘和面试准备使用。

---

## 1. Mock 服务端口占用（EADDRINUSE）

- **Bug 名称**：启动 `node server.js` 时提示 `Error: listen EADDRINUSE: address already in use :::3000`
- **出现阶段**：项目初期，每次运行测试前启动 Mock 服务时。
- **原因分析**：端口 3000 已被其他进程占用（如之前未关闭的 Node 进程、Postman Mock Server、其他应用等）。
- **解决办法**：
  1. 查找占用进程 PID：`netstat -ano | findstr :3000`
  2. 结束进程：`taskkill /PID <PID> /F`
  3. 或者修改 `server.js` 中的端口为 3001，并同步修改 Postman 环境变量 `base_url`。

---

## 2. Newman 执行时找不到 Collection 或环境文件

- **Bug 名称**：`newman: collection could not be loaded` 或 `ENOENT: no such file or directory`
- **出现阶段**：初次运行 Newman 命令时。
- **原因分析**：
  - 命令中的文件路径不正确（相对路径错误）。
  - 文件名中包含中文或空格，且未用双引号包裹。
  - 文件未被正确导出或移动。
- **解决办法**：
  - 使用绝对路径或正确的相对路径。
  - 将中文文件名改为英文（如 `order_api_collection.json`）。
  - 使用双引号包裹路径：`"postman/order_api_collection.json"`。

---

## 3. 断言失败：越权查询返回 200 而非 403

- **Bug 名称**：越权漏洞 – 用户 A 可查询用户 B 的订单详情
- **出现阶段**：首次运行订单模块测试时，`TC-GET-005` 失败。
- **原因分析**：Mock 服务的 `GET /orders/:id` 路由未校验当前用户 ID 与订单的 `userId` 是否一致。
- **解决办法**：
  - 在 `server.js` 的 `GET /orders/:id` 路由中添加权限校验：
    ```javascript
    if (order.userId !== req.currentUser.id) {
      return res.status(403).json({ code: 3002, message: '无权访问该订单' });
    }
```
  - 同步修改取消订单等路由。

---

## 4. 断言失败：重复取消订单返回 200 而非 409

- **Bug 名称**：取消订单接口未实现幂等性，重复取消返回成功
- **出现阶段**：`TC-CANCEL-008` 失败。
- **原因分析**：`PUT /orders/:id/cancel` 路由中未检查订单当前状态，允许对已取消的订单再次取消。
- **解决办法**：
  - 在取消前检查 `order.status === 'CANCELLED'`，若已取消则返回 409：
    ```javascript
    if (order.status === 'CANCELLED') {
      return res.status(409).json({ code: 4002, message: '订单已被取消，无法重复操作' });
    }
    ```

---

## 5. 数据驱动测试导致整个 Collection 重复迭代，后续模块失败

- **Bug 名称**：Newman 数据驱动作用于整个 Collection，异常登录数据导致订单模块大量失败
- **出现阶段**：实现数据驱动后，使用 `-d login_data.csv` 运行整个 Collection 时。
- **原因分析**：CSV 中包含登录失败的数据行（密码错误、用户名为空等），这些行会导致登录失败，后续依赖 token 的订单、支付等模块因无有效 token 而全部失败。
- **解决办法**：
  - **方案一（采用）**：将登录数据驱动单独拆分为一个 Collection，不与订单、支付等模块混合。
  - **方案二**：CSV 中只保留能成功登录的数据行。
  - 最终采用模块化拆分：`01-登录模块`（数据驱动）独立运行，`02-订单模块`、`04-支付模块` 使用环境变量中的 token。

---

## 6. Windows 批处理文件乱码导致命令执行失败

- **Bug 名称**：`run-tests.bat` 执行时出现 `'紅圖假默浜?CI' 不是内部或外部命令` 等乱码错误
- **出现阶段**：项目早期，运行批处理脚本时。
- **原因分析**：文件编码为 UTF‑8，而 Windows 命令提示符默认使用 GBK 编码，导致中文字符或特殊符号解析错误。
- **解决办法**：
  - 将 `.bat` 文件另存为 ANSI 编码。
  - 或删除原文件，用纯英文命令重建：
    ```bat
    @echo off
    newman run "postman/order_api_collection.json" -e "postman/dev.environment.json" -r cli
    exit /b %ERRORLEVEL%
    ```

---

## 7. TAPD API 返回 `workspace not existed`

- **Bug 名称**：缺陷自动推送脚本 `auto-create-bugs.js` 调用 TAPD API 失败
- **出现阶段**：配置缺陷管理集成时。
- **原因分析**：配置文件中 `workspace_id` 填写错误（误用了示例中的长数字而非真实项目 ID）。
- **解决办法**：
  - 登录 TAPD，进入对应项目，从浏览器 URL 中获取正确的 `workspace_id`（通常为 8~10 位数字）。
  - 更新 `tapd-config.json` 中的 `workspace_id`。

---

## 8. Newman 生成 HTML 报告时提示 `could not find "html" reporter`

- **Bug 名称**：缺少 Newman HTML 报告插件
- **出现阶段**：尝试生成 HTML 报告时。
- **原因分析**：未安装 `newman-reporter-html`。
- **解决办法**：
  - 执行 `npm install -g newman-reporter-html`。
  - 之后即可使用 `-r html` 参数。

---

## 9. 注册接口用户名已存在时仍返回成功

- **Bug 名称**：注册接口未校验用户名唯一性
- **出现阶段**：添加注册功能后的初次测试。
- **原因分析**：`/register` 路由中未检查 `db.json` 是否已存在相同 `username`。
- **解决办法**：
  - 在注册逻辑中添加唯一性检查：
    ```javascript
    const existingUser = db.get('users').find({ username }).value();
    if (existingUser) {
      return res.status(409).json({ code: 1003, message: '用户名已存在' });
    }
    ```

---

## 10. JWT 刷新令牌接口返回 `无效的刷新令牌`（用户手动测试时）

- **Bug 名称**：`/refresh` 接口未正确验证 refreshToken（测试占位符导致，非代码 bug）
- **出现阶段**：JWT 改造后手动 curl 测试。
- **原因分析**：用户未传入真实登录返回的 `refreshToken`，而是使用占位符字符串。
- **解决办法**：
  - 正确做法：在登录成功后保存 `refreshToken`，调用 `/refresh` 时传入真实值。
  - 后端代码本身正确，无需修改。此问题仅记录为“测试操作注意事项”。

---

## 总结

所有已发现的 Bug 均已被修复或通过测试用例覆盖验证。项目目前运行稳定，三个核心模块及支付、安全模块测试通过率 100%。
```

你可以将这个文件保存到 `docs/` 目录下。如果还有其他遗漏的 bug，可以继续补充。
```