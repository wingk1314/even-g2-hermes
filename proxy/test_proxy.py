#!/usr/bin/env python3
"""Test the Even G2 Hermes proxy."""
import json
import os
import sys
import urllib.request

PROXY = "http://127.0.0.1:18790"
SECRET=os.environ.get("PROXY_SECRET", "test")


def test_models():
    req = urllib.request.Request(f"{PROXY}/", headers={"Authorization": f"Bearer {SECRET}"})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    assert "data" in data, f"Expected 'data' key, got: {data}"
    assert data["data"][0]["id"] == "openclaw", f"Expected 'openclaw', got: {data['data'][0]['id']}"
    print("Models endpoint works")


def test_chat():
    payload = json.dumps({
        "model": "openclaw",
        "messages": [{"role": "user", "content": "say exactly: test passed"}]
    }).encode()
    req = urllib.request.Request(
        PROXY + "/",
        data=payload,
        headers={
            "Authorization": f"Bearer {SECRET}",
            "Content-Type": "application/json",
        },
    )
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    assert "choices" in data, f"Expected 'choices', got: {data}"
    content = data["choices"][0]["message"]["content"]
    print(f"Chat query works - response: {content[:100]}")
    return content


def test_auth_reject():
    req = urllib.request.Request(f"{PROXY}/", headers={"Authorization": "Bearer wrong"})
    try:
        urllib.request.urlopen(req)
        print("Auth should have rejected wrong token")
    except urllib.error.HTTPError as e:
        assert e.code == 401, f"Expected 401, got {e.code}"
        print("Auth correctly rejects wrong token")


if __name__ == "__main__":
    print("=== Even G2 Hermes Proxy Tests ===\n")
    try:
        test_models()
        test_auth_reject()
        test_chat()
        print("\nAll tests passed!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)
