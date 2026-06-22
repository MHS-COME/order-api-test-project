import requests
import pytest
from conftest import BASE_URL
from config import APPID, APPSECRET


def test_get_token():
    resp = requests.get(f"{BASE_URL}/cgi-bin/token", params={
        "grant_type": "client_credential",
        "appid": APPID,
        "secret": APPSECRET
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert len(body["access_token"]) > 10
    assert body["expires_in"] == 7200


def test_token_wrong_appid():
    resp = requests.get(f"{BASE_URL}/cgi-bin/token", params={
        "grant_type": "client_credential",
        "appid": "wx0000000000000000",
        "secret": APPSECRET
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] == 40013


def test_token_wrong_secret():
    resp = requests.get(f"{BASE_URL}/cgi-bin/token", params={
        "grant_type": "client_credential",
        "appid": APPID,
        "secret": "wrongsecret00000000000000000"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] == 40125


def test_token_missing_appid():
    resp = requests.get(f"{BASE_URL}/cgi-bin/token", params={
        "grant_type": "client_credential",
        "secret": APPSECRET
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [41002, 40013]


def test_token_missing_secret():
    resp = requests.get(f"{BASE_URL}/cgi-bin/token", params={
        "grant_type": "client_credential",
        "appid": APPID
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] == 41004
