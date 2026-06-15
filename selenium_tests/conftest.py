"""
pytest 公共夹具 — Selenium WebDriver 生命周期管理
"""

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


@pytest.fixture(scope="session")
def base_url():
    """前端页面地址"""
    return "http://localhost:3000"


def _make_driver(headless=True):
    """创建 Chrome WebDriver 实例"""
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-gpu")
    # 不显示 "Chrome is being controlled by automated test software" 横幅
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)
    driver.implicitly_wait(5)
    return driver


@pytest.fixture(scope="function")
def driver():
    """每个测试用例独立的浏览器实例"""
    drv = _make_driver(headless=False)  # 设为 False 可以看到浏览器操作过程
    yield drv
    drv.quit()


@pytest.fixture(scope="session")
def headless_driver():
    """无头模式，CI 用"""
    drv = _make_driver(headless=True)
    yield drv
    drv.quit()
