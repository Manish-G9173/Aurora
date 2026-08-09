"""Smoke test for the live interview WebSocket flow."""
import asyncio
import json

import httpx
import websockets

API = "http://localhost:8000"


async def get_token(username: str, password: str) -> str:
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{API}/api/auth/login",
                         json={"username": username, "password": password})
        r.raise_for_status()
        return r.json()["token"]


async def run():
    token = await get_token("tester3", "secret123")
    ws_url = (f"ws://localhost:8000/api/interview/ws?ws_token={token}"
              f"&mode=practice")
    async with websockets.connect(ws_url) as ws:
        events = []
        # expect session_start
        start = json.loads(await ws.recv())
        events.append(start["type"])
        print("session started:", start.get("token", "")[:8] + "...")
        # consume any events until an interviewer turn or audio arrives
        got_audio = False
        while True:
            msg = json.loads(await ws.recv())
            t = msg.get("type")
            events.append(t)
            if t == "turn" and msg.get("role") == "interviewer":
                print("interviewer:", msg.get("text", "")[:120])
                print("model:", msg.get("model_used"))
                break
            if t == "audio":
                got_audio = True
            if t == "session_ended":
                break
        # send a candidate answer
        await ws.send(json.dumps({
            "type": "candidate",
            "text": "I've spent 5 years building distributed systems with "
                    "Kubernetes and PostgreSQL. My biggest lesson is that "
                    "operational simplicity beats clever design.",
            "eye": 0.9, "posture": 0.85,
        }))
        # consume events until the next interviewer turn (may include thinking/audio)
        deadline = asyncio.get_event_loop().time() + 90
        while asyncio.get_event_loop().time() < deadline:
            msg = json.loads(await ws.recv())
            t = msg.get("type")
            events.append(t)
            print("received:", t, (msg.get("text") or "")[:80])
            if t == "turn" and msg.get("role") == "interviewer":
                print("model:", msg.get("model_used"),
                      "fallback:", msg.get("fallback_used"))
                break
        # end interview
        await ws.send(json.dumps({"type": "end_interview"}))
        end = json.loads(await ws.recv())
        events.append(end["type"])
        print("ended:", end.get("type"))
    print("event sequence:", events)


asyncio.run(run())
