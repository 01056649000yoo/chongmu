#!/bin/bash
# 총무해방 배포 앱(final-pine)에 OpenAI 키를 넣어요.
# 쓰는 법:  bash ~/chongmu/key.sh
#   → "OpenAI 키 (sk-...):" 가 나오면 키를 붙여 넣고 Enter (화면에 안 보여요)
set -u
SRC="/tmp/cm_final"
URL="https://final-pine.onpod.ai"

if [ ! -f "$SRC/server.py" ]; then
  echo "배포 소스가 없어요. 내려받는 중…"
  bizcoder apps pull final-pine --dir /tmp/cm_src >/dev/null || exit 1
  SRC="$(find /tmp/cm_src -maxdepth 1 -type d -name '*' ! -path /tmp/cm_src | head -1)"
fi

read -r -s -p "OpenAI 키 (sk-...): " KEY; echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
case "$KEY" in
  sk-*) ;;
  *) echo "키가 sk- 로 시작하지 않아요. 다시 실행해 주세요."; exit 1 ;;
esac

cd "$SRC" || exit 1
echo "키 넣고 다시 올리는 중… (1~2분)"
bizcoder deploy --scope public --env "OPENAI_API_KEY=$KEY" --wait >/dev/null 2>&1
unset KEY

for i in $(seq 1 30); do
  sleep 5
  S="$(curl -s -m 10 "$URL/api/ai-status" || true)"
  case "$S" in
    *'"ai": true'*) echo "✓ 준비됐어요: $URL"; exit 0 ;;
  esac
done
echo "아직 준비 중이에요. 1~2분 뒤 $URL/api/ai-status 를 열어 \"ai\": true 인지 확인해 주세요."
