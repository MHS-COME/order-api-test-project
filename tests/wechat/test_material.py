import requests
import io
import pytest
from conftest import BASE_URL


@pytest.fixture
def test_image():
    return ("test.png", io.BytesIO(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"), "image/png")


def test_upload_image(access_token, test_image):
    name, data, mime = test_image
    resp = requests.post(f"{BASE_URL}/cgi-bin/media/upload", params={"access_token": access_token, "type": "image"}, files={"media": (name, data, mime)})
    assert resp.status_code == 200
    body = resp.json()
    assert "media_id" in body
    assert body["type"] == "image"
    assert body["created_at"] is not None


def test_upload_invalid_type(access_token, test_image):
    name, data, mime = test_image
    resp = requests.post(f"{BASE_URL}/cgi-bin/media/upload", params={"access_token": access_token, "type": "invalid"}, files={"media": (name, data, mime)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_get_media_invalid_id(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/media/get", params={"access_token": access_token, "media_id": "invalid_media_id_123"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0


def test_upload_image_no_token(test_image):
    name, data, mime = test_image
    resp = requests.post(f"{BASE_URL}/cgi-bin/media/upload", params={"type": "image"}, files={"media": (name, data, mime)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] in [40001, 41001]


def test_get_media_no_id(access_token):
    resp = requests.get(f"{BASE_URL}/cgi-bin/media/get", params={"access_token": access_token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["errcode"] != 0
