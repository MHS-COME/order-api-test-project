"""
OrderAPI 前端 UI 自动化测试 (Selenium + pytest) — 适配 v2.1 多页面版

测试前请确保:
  1. Mock 服务已启动:  cd mock-server && node server.js
  2. Chrome 浏览器已安装
  3. 依赖已安装:       pip install -r requirements.txt

运行:
  pytest test_ui.py -v                      # 全部用例
  pytest test_ui.py -v -k "test_login"      # 只跑登录
  pytest test_ui.py -v --tb=short           # 简洁输出
  pytest test_ui.py -v --headless           # 无头模式 (默认有界面)
"""

import time
import random
import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException


# ── 配置 ──────────────────────────────────────────
FRONTEND_PATH = r"d:\1OrderAPITestProject\frontend\index.html"
FRONTEND_URL  = "file:///" + FRONTEND_PATH.replace("\\", "/")
BASE_API      = "http://localhost:3000"
TEST_USER     = "testuser"
TEST_PASS     = "Test@123456"

WAIT_SHORT  = 3
WAIT_MEDIUM = 6
WAIT_LONG   = 10


# ═══════════════════════════════════════════════════
#  辅助函数
# ═══════════════════════════════════════════════════

def open_app(driver):
    driver.get(FRONTEND_URL)
    time.sleep(0.5)

def nav_to(driver, page):
    """点击侧边栏导航到指定页面"""
    items = driver.find_elements(By.CSS_SELECTOR, ".nav-item")
    for item in items:
        if item.get_attribute("data-page") == page:
            item.click()
            time.sleep(0.3)
            return
    raise Exception(f"导航项未找到: {page}")

def wait_result(driver, result_id, timeout=WAIT_MEDIUM):
    """等待结果面板出现并返回 body 文本"""
    panel = WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.ID, result_id))
    )
    WebDriverWait(driver, timeout).until(
        lambda d: panel.is_displayed()
    )
    body = panel.find_element(By.CSS_SELECTOR, ".result-body")
    WebDriverWait(driver, timeout).until(
        lambda d: len(body.text.strip()) > 5
    )
    return body.text

def has_success(text):
    return '"code": 0' in text

def get_token_text(driver):
    el = driver.find_element(By.ID, "tokenDisplay")
    return el.text.strip()

def login(driver, username=TEST_USER, password=TEST_PASS):
    """导航到登录页并登录，返回 (ok, result_text)

    注意：登录成功后会跳转到仪表盘，登录页结果面板被隐藏，
    因此用顶部 token 栏的变化来判断成功，而非等待结果面板显示。
    """
    nav_to(driver, "login")
    time.sleep(0.3)

    user_input = driver.find_element(By.ID, "login-username")
    pass_input = driver.find_element(By.ID, "login-password")
    user_input.clear(); user_input.send_keys(username)
    pass_input.clear(); pass_input.send_keys(password)

    driver.find_element(By.ID, "btn-login").click()
    time.sleep(1.5)

    # 成功：token 栏更新且不为"未登录"
    token_text = get_token_text(driver)
    if token_text != "未登录" and len(token_text) > 10:
        return True, '{"code": 0, "message": "success"}'

    # 失败：结果面板仍可见，读取错误信息
    try:
        result = wait_result(driver, "login-result")
    except TimeoutException:
        result = "登录超时（无响应）"
    return False, result

def create_order(driver, product="5001", quantity="1", address="100", remark=""):
    """在创建订单页创建订单，返回 (ok, result_text)"""
    nav_to(driver, "orders")
    time.sleep(0.3)

    sel = driver.find_element(By.ID, "order-productId")
    for opt in sel.find_elements(By.TAG_NAME, "option"):
        if opt.get_attribute("value") == product:
            opt.click(); break

    driver.find_element(By.ID, "order-quantity").clear()
    driver.find_element(By.ID, "order-quantity").send_keys(quantity)
    driver.find_element(By.ID, "order-addressId").clear()
    driver.find_element(By.ID, "order-addressId").send_keys(address)
    if remark:
        driver.find_element(By.ID, "order-remark").clear()
        driver.find_element(By.ID, "order-remark").send_keys(remark)

    driver.find_element(By.ID, "btn-create-order").click()
    result = wait_result(driver, "order-result")
    return has_success(result), result

def load_order_list(driver):
    """导航到我的订单页，等待 API 返回并渲染表格"""
    nav_to(driver, "orders-list")
    time.sleep(0.5)
    # JS loadOrderList() 是异步的：先显示"加载中…"，fetch 完成后渲染 <table>
    # 直接等 table 元素出现，避免初始状态误判导致提前退出
    try:
        WebDriverWait(driver, WAIT_MEDIUM).until(
            lambda d: d.find_element(By.ID, "order-list-container")
                       .find_elements(By.CSS_SELECTOR, "table")
        )
    except TimeoutException:
        pass
    time.sleep(0.3)

def get_order_list_rows(driver):
    """返回订单列表中的所有数据行"""
    try:
        table = driver.find_element(By.CSS_SELECTOR, "#order-list-container table")
        return table.find_elements(By.CSS_SELECTOR, "tbody tr")
    except:
        return []

def find_order_row(driver, order_id):
    """在订单列表中查找指定 orderId 的行，返回 (row, status_text, action_html) 或 (None,None,None)"""
    rows = get_order_list_rows(driver)
    for row in rows:
        cells = row.find_elements(By.TAG_NAME, "td")
        if cells and ("#" + str(order_id)) in cells[0].text:
            status_cell = cells[4]  # 状态在第5列
            action_cell = cells[6]  # 操作在第7列
            return row, status_cell.text, action_cell.get_attribute("innerHTML")
    return None, None, None

def nav_to_page_direct(driver, page_name):
    """通过 JS 直接显示指定页面 (用于不在侧边栏的隐藏页面)"""
    driver.execute_script(f"""
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-{page_name}').classList.add('active');
    """)
    time.sleep(0.3)


# ═══════════════════════════════════════════════════
#  登录模块
# ═══════════════════════════════════════════════════

class TestLoginUI:

    def test_login_success(self, driver):
        """正向登录 — token 显示在顶部栏"""
        open_app(driver)
        ok, result = login(driver)
        assert ok, f"登录失败: {result[:200]}"
        token = get_token_text(driver)
        assert token != "未登录"
        assert len(token) > 10

    def test_login_wrong_password(self, driver):
        """错误密码 — 显示业务码 1002"""
        open_app(driver)
        ok, result = login(driver, "testuser", "WrongPass99")
        assert not ok
        assert "1002" in result or "用户名或密码错误" in result

    def test_login_empty_fields(self, driver):
        """空用户名 — Toast 警告"""
        open_app(driver)
        nav_to(driver, "login")
        time.sleep(0.3)

        driver.find_element(By.ID, "login-username").clear()
        driver.find_element(By.ID, "btn-login").click()
        time.sleep(1)

        toasts = driver.find_elements(By.CSS_SELECTOR, ".toast")
        assert len(toasts) > 0, "应弹出 Toast 提示"


# ═══════════════════════════════════════════════════
#  注册模块
# ═══════════════════════════════════════════════════

class TestRegisterUI:

    def test_register_success(self, driver):
        """注册新用户"""
        open_app(driver)
        nav_to(driver, "register")
        time.sleep(0.3)

        suffix = random.randint(10000, 99999)
        driver.find_element(By.ID, "reg-username").send_keys(f"ui{suffix}")
        driver.find_element(By.ID, "reg-password").send_keys("Test@123")
        driver.find_element(By.ID, "btn-register").click()

        result = wait_result(driver, "reg-result")
        assert has_success(result), f"注册失败: {result[:200]}"

    def test_register_username_too_short(self, driver):
        """用户名过短 — Toast 警告"""
        open_app(driver)
        nav_to(driver, "register")
        time.sleep(0.3)

        driver.find_element(By.ID, "reg-username").send_keys("ab")
        driver.find_element(By.ID, "reg-password").send_keys("Test@123")
        driver.find_element(By.ID, "btn-register").click()
        time.sleep(1)

        toasts = driver.find_elements(By.CSS_SELECTOR, ".toast")
        assert len(toasts) > 0


# ═══════════════════════════════════════════════════
#  创建订单模块
# ═══════════════════════════════════════════════════

class TestCreateOrderUI:

    def test_create_order_success(self, driver):
        """登录后创建订单 — 金额自动填充到支付页"""
        open_app(driver)
        login(driver)

        ok, result = create_order(driver, "5001", "1", "100")
        assert ok, f"创建失败: {result[:200]}"

        # 切换到支付页面验证自动填充
        nav_to(driver, "payment")
        time.sleep(0.3)
        oid = driver.find_element(By.ID, "pay-orderId").get_attribute("value")
        amt = driver.find_element(By.ID, "pay-amount").get_attribute("value")
        assert oid, "orderId 未自动填充"
        assert amt, "金额未自动填充"

    def test_create_order_no_login(self, driver):
        """未登录创建 — Toast 警告"""
        open_app(driver)
        nav_to(driver, "orders")
        time.sleep(0.3)

        driver.find_element(By.ID, "btn-create-order").click()
        time.sleep(1)
        toasts = driver.find_elements(By.CSS_SELECTOR, ".toast")
        assert len(toasts) > 0


# ═══════════════════════════════════════════════════
#  订单列表模块 (v2.1 核心新功能)
# ═══════════════════════════════════════════════════

class TestOrderListUI:

    def test_list_loads_after_login(self, driver):
        """登录后"我的订单"显示表格 — 包含 testuser 的 7 条订单"""
        open_app(driver)
        login(driver)
        load_order_list(driver)

        rows = get_order_list_rows(driver)
        assert len(rows) >= 7, f"testuser 应至少有 7 条订单，实际 {len(rows)}"

    def test_paid_order_no_cancel_button(self, driver):
        """PAID 订单 #20012 — 无取消按钮，显示'不可取消'"""
        open_app(driver)
        login(driver)
        load_order_list(driver)

        _, _, action_html = find_order_row(driver, 20012)
        assert action_html is not None, "未找到订单 #20012"
        assert "不可取消" in action_html, f"PAID 订单应显示'不可取消'，实际: {action_html}"
        assert "btn-danger" not in action_html, "PAID 订单不应有取消按钮"

    def test_cancelled_order_no_operation(self, driver):
        """CANCELLED 订单 #20011 — 显示'已取消，不可操作'"""
        open_app(driver)
        login(driver)
        load_order_list(driver)

        _, _, action_html = find_order_row(driver, 20011)
        assert action_html is not None, "未找到订单 #20011"
        assert "已取消" in action_html, f"CANCELLED 订单应显示'已取消'，实际: {action_html}"
        assert "btn" not in action_html, "CANCELLED 订单不应有任何按钮"

    def test_status_badges_display(self, driver):
        """验证订单列表中各类状态标签正确显示"""
        open_app(driver)
        login(driver)
        load_order_list(driver)

        # 检查页面上的状态标签
        pending_tags = driver.find_elements(By.CSS_SELECTOR, ".status-PENDING")
        paid_tags    = driver.find_elements(By.CSS_SELECTOR, ".status-PAID")
        cancelled_tags = driver.find_elements(By.CSS_SELECTOR, ".status-CANCELLED")
        shipped_tags = driver.find_elements(By.CSS_SELECTOR, ".status-SHIPPED")

        assert len(pending_tags) >= 1, "应至少有 1 条 PENDING 订单"
        assert len(paid_tags) >= 1, "应至少有 1 条 PAID 订单"
        assert len(cancelled_tags) >= 1, "应至少有 1 条 CANCELLED 订单"
        assert len(shipped_tags) >= 1, "应至少有 1 条 SHIPPED 订单"

        # 验证标签文本内容
        assert "待支付" in pending_tags[0].text
        assert "已支付" in paid_tags[0].text
        assert "已取消" in cancelled_tags[0].text
        assert "已发货" in shipped_tags[0].text

    def test_pay_button_navigates_to_payment(self, driver):
        """点击订单列表中 PENDING 订单的 [支付] → 跳转支付页并预填数据"""
        open_app(driver)
        login(driver)
        load_order_list(driver)

        # 找到 PENDING 订单 #10001，点击支付按钮
        _, _, action_html = find_order_row(driver, 10001)
        assert action_html is not None, "未找到订单 #10001"
        assert "goPayOrder" in action_html, "PENDING 订单应有支付按钮"

        # 点击支付按钮
        pay_btn = driver.find_element(By.CSS_SELECTOR, "[onclick*='goPayOrder(10001']")
        pay_btn.click()
        time.sleep(0.5)

        # 验证已跳转到支付页
        pay_section = driver.find_element(By.ID, "page-payment")
        assert pay_section.is_displayed(), "应跳转到支付页面"

        oid = driver.find_element(By.ID, "pay-orderId").get_attribute("value")
        amt = driver.find_element(By.ID, "pay-amount").get_attribute("value")
        assert oid == "10001", f"orderId 应为 10001，实际: {oid}"
        assert amt, "金额应已填充"

    def test_cancel_from_list_with_modal(self, driver):
        """列表中取消 PENDING 订单：弹窗确认 → 取消成功"""
        open_app(driver)
        login(driver)

        # 先创建一个订单，确保有可取消的订单
        ok, _ = create_order(driver, "5003", "1", "100")
        assert ok, "创建订单失败"

        # 取创建的订单号 (自动填充到支付页)
        nav_to(driver, "payment")
        time.sleep(0.3)
        new_oid = driver.find_element(By.ID, "pay-orderId").get_attribute("value")
        assert new_oid, "未获取到新订单号"

        # 到订单列表找到并取消
        load_order_list(driver)
        _, _, action_html = find_order_row(driver, new_oid)
        assert action_html and "cancelOrderFromList" in action_html, "PENDING 订单应有取消按钮"

        # 点击取消按钮
        cancel_btn = driver.find_element(By.CSS_SELECTOR, f"[onclick*='cancelOrderFromList({new_oid}']")
        cancel_btn.click()
        time.sleep(0.5)

        # 等待弹窗出现
        modal = WebDriverWait(driver, WAIT_SHORT).until(
            EC.visibility_of_element_located((By.ID, "modalConfirm"))
        )
        assert modal.is_displayed(), "应弹出确认弹窗"
        assert "取消" in driver.find_element(By.ID, "modal-title").text

        # 点击确认按钮 → 异步 cancelOrderFromList() 触发 API + 自动刷新
        driver.find_element(By.ID, "modal-confirm-btn").click()

        # 等待 toast 出现 (表示异步操作完成)
        try:
            WebDriverWait(driver, WAIT_SHORT).until(
                lambda d: d.find_elements(By.CSS_SELECTOR, ".toast")
            )
        except TimeoutException:
            pass

        # 离开再回来确保拿到最新数据
        nav_to(driver, "dashboard")
        time.sleep(0.3)
        load_order_list(driver)
        _, status_text, _ = find_order_row(driver, new_oid)
        assert status_text is not None, f"订单 {new_oid} 不再列表中"
        assert "已取消" in status_text, f"订单应为已取消状态，实际: {status_text}"


# ═══════════════════════════════════════════════════
#  取消边界测试 (v2.1 新增)
# ═══════════════════════════════════════════════════

class TestCancelBoundary:

    def test_cancel_paid_order_via_page_fails(self, driver):
        """通过取消页面对已支付订单 #20012 发起取消 → 应返回错误"""
        open_app(driver)
        login(driver)

        # 直接导航到隐藏的 cancel 页面 (不在侧边栏但 DOM 中存在)
        nav_to_page_direct(driver, "cancel")
        time.sleep(0.3)

        driver.find_element(By.ID, "cancel-orderId").send_keys("20012")
        driver.find_element(By.ID, "btn-cancel").click()

        result = wait_result(driver, "cancel-result")
        assert not has_success(result), "PAID 订单不应取消成功"
        assert any(kw in result for kw in ["4005", "已支付", "不允许"]), \
            f"应返回 4005/已支付/不允许 错误，实际: {result[:200]}"

    def test_cancel_cancelled_order_via_page_fails(self, driver):
        """通过取消页面对已取消订单 #20011 再次取消 → 应返回错误"""
        open_app(driver)
        login(driver)

        nav_to_page_direct(driver, "cancel")
        time.sleep(0.3)

        driver.find_element(By.ID, "cancel-orderId").send_keys("20011")
        driver.find_element(By.ID, "btn-cancel").click()

        result = wait_result(driver, "cancel-result")
        assert not has_success(result), "CANCELLED 订单不应取消成功"
        assert any(kw in result for kw in ["4002", "已取消", "重复"]), \
            f"应返回 4002/已取消/重复操作 错误，实际: {result[:200]}"


# ═══════════════════════════════════════════════════
#  支付模块
# ═══════════════════════════════════════════════════

class TestPaymentUI:

    def test_payment_success(self, driver):
        """创建订单 → 支付 → 验证 PAID 状态"""
        open_app(driver)
        login(driver)
        create_order(driver, "5001", "1", "100")

        nav_to(driver, "payment")
        time.sleep(0.3)
        driver.find_element(By.ID, "btn-pay").click()

        result = wait_result(driver, "pay-result")
        assert has_success(result), f"支付失败: {result[:200]}"
        assert "PAID" in result

    def test_payment_empty_orderid(self, driver):
        """不填订单号支付 — Toast 警告"""
        open_app(driver)
        login(driver)
        nav_to(driver, "payment")
        time.sleep(0.3)

        driver.find_element(By.ID, "pay-orderId").clear()
        driver.find_element(By.ID, "btn-pay").click()
        time.sleep(1)
        toasts = driver.find_elements(By.CSS_SELECTOR, ".toast")
        assert len(toasts) > 0


# ═══════════════════════════════════════════════════
#  端到端全链路 (适配 v2.1)
# ═══════════════════════════════════════════════════

class TestFullE2E:

    def test_full_flow(self, driver):
        """登录 → 创建 → 支付 → 列表确认 PAID 完整链路"""
        open_app(driver)

        # 1. 登录
        ok, _ = login(driver)
        assert ok, "登录失败"
        assert get_token_text(driver) != "未登录"

        # 2. 创建订单 (机械键盘 ¥399)
        ok, _ = create_order(driver, "5002", "1", "100")
        assert ok, "创建订单失败"

        # 取自动填充的 orderId
        nav_to(driver, "payment")
        time.sleep(0.3)
        oid = driver.find_element(By.ID, "pay-orderId").get_attribute("value")
        assert oid, "orderId 未填充"

        # 3. 支付
        driver.find_element(By.ID, "btn-pay").click()
        pay_res = wait_result(driver, "pay-result")
        assert has_success(pay_res), f"支付失败: {pay_res[:200]}"
        assert "PAID" in pay_res

        # 4. 在订单列表中确认 PAID 状态
        load_order_list(driver)
        _, status_text, action_html = find_order_row(driver, oid)
        assert status_text is not None, f"订单 {oid} 未在列表中"
        assert "已支付" in status_text, f"状态应为 '已支付'，实际: {status_text}"
        assert "不可取消" in action_html, f"PAID 订单操作区应显示 '不可取消'"


# ═══════════════════════════════════════════════════
#  页面导航
# ═══════════════════════════════════════════════════

class TestNavigation:

    def test_nav_switch_pages(self, driver):
        """验证侧边栏导航切换所有 7 个页面"""
        open_app(driver)

        pages = ["dashboard", "login", "register", "refresh",
                 "orders-list", "orders", "payment"]
        for p in pages:
            nav_to(driver, p)
            time.sleep(0.2)
            section = driver.find_element(By.ID, f"page-{p}")
            assert section.is_displayed(), f"页面 {p} 未显示"


# ═══════════════════════════════════════════════════
#  仪表盘
# ═══════════════════════════════════════════════════

class TestDashboard:

    def test_dashboard_stats(self, driver):
        """仪表盘显示 4 个统计卡片 + 8 个接口行"""
        open_app(driver)
        nav_to(driver, "dashboard")
        time.sleep(0.3)

        cards = driver.find_elements(By.CSS_SELECTOR, ".stat-card")
        assert len(cards) == 4, f"应有 4 个统计卡片，实际 {len(cards)}"

        table = driver.find_element(By.CSS_SELECTOR, "table")
        rows = table.find_elements(By.CSS_SELECTOR, "tbody tr")
        assert len(rows) == 8, f"应有 8 个接口，实际 {len(rows)}"

    def test_health_indicator(self, driver):
        """侧边栏底部显示 API 状态"""
        open_app(driver)
        time.sleep(2)
        status_text = driver.find_element(By.ID, "sidebarStatus").text
        assert "在线" in status_text or "离线" in status_text
