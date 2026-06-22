import requests
import pytest

BASE_URL = "http://localhost:3000"


@pytest.fixture(scope="session", autouse=True)
def reset_data():
    try:
        requests.post(f"{BASE_URL}/__reset", timeout=3)
    except requests.exceptions.ConnectionError:
        pass


@pytest.fixture
def token():
    data = {"username": "testuser", "password": "Test@123456"}
    resp = requests.post(f"{BASE_URL}/login", json=data)
    body = resp.json()
    return body["data"]["token"]


@pytest.fixture
def other_token():
    data = {"username": "alice", "password": "Alice@123"}
    resp = requests.post(f"{BASE_URL}/login", json=data)
    body = resp.json()
    return body["data"]["token"]
