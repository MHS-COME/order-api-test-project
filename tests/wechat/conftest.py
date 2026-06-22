import requests
import pytest
from config import APPID, APPSECRET, OPENID, TEMPLATE_ID

BASE_URL = "https://api.weixin.qq.com"


@pytest.fixture
def appid():
    return APPID


@pytest.fixture
def secret():
    return APPSECRET


@pytest.fixture
def openid():
    if not OPENID:
        pytest.skip("OPENID 未配置，请在 config.py 中填写")
    return OPENID


@pytest.fixture
def template_id():
    if not TEMPLATE_ID:
        pytest.skip("TEMPLATE_ID 未配置，请在 config.py 中填写")
    return TEMPLATE_ID


@pytest.fixture(scope="session")
def access_token():
    url = f"{BASE_URL}/cgi-bin/token"
    params = {"grant_type": "client_credential", "appid": APPID, "secret": APPSECRET}
    resp = requests.get(url, params=params)
    body = resp.json()
    if "access_token" in body:
        return body["access_token"]
    pytest.fail(f"获取 access_token 失败: {body}")
