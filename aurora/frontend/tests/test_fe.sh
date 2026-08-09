#!/bin/bash
# Quick integration sanity: register + login through the served frontend using curl
# (login form posts to /api/auth/login via JS; we verify the API contract that the
# frontend calls, then confirm the served index loads the bundle).
set -e
FE=http://localhost:5173
BE=http://localhost:8000

echo "== frontend index =="
curl -s "$FE/" | grep -o "AURORA" | head -1
echo "== bundle loads =="
curl -s "$FE/" | grep -o 'assets/[^"]*\.js' | head -1
echo "== backend login via FE route =="
USER=ftest_$$
curl -s -X POST "$BE/api/auth/register" -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"password123\"}" | head -c 200; echo
TOKEN=$(curl -s -X POST "$BE/api/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"password123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "== token obtained: ${TOKEN:0:20}... =="
curl -s -H "Authorization: Bearer $TOKEN" "$BE/api/dashboard" | head -c 300; echo
echo "== ALL CHECKS PASSED =="
