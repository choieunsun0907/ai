#!/bin/bash
# ============================================================
# 싸카스포츠 가격비교 - AWS EC2 자동 배포 스크립트
# 사용법: chmod +x deploy.sh && sudo ./deploy.sh
# 대상OS: Ubuntu 20.04 / 22.04 LTS (Amazon Linux도 가능)
# ============================================================

set -e  # 에러 발생 시 즉시 중단

APP_NAME="ssakasports"
APP_DIR="/var/www/ssakasports"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
GITHUB_REPO="https://github.com/choieunsun0907/ai.git"

echo "======================================================"
echo "  싸카스포츠 가격비교 AWS 배포 시작"
echo "======================================================"

# 1. Python3 확인
echo "[1/7] Python3 확인..."
python3 --version || { echo "❌ Python3가 없습니다. sudo apt install python3 실행"; exit 1; }
echo "✅ Python3 OK"

# 2. 앱 디렉토리 생성
echo "[2/7] 앱 디렉토리 설정..."
mkdir -p $APP_DIR

# 3. GitHub에서 최신 코드 가져오기
echo "[3/7] GitHub 코드 다운로드..."
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull origin main
  echo "✅ 코드 업데이트 완료"
else
  git clone $GITHUB_REPO $APP_DIR
  echo "✅ 코드 클론 완료"
fi

# 4. 권한 설정
echo "[4/7] 파일 권한 설정..."
chown -R ubuntu:ubuntu $APP_DIR 2>/dev/null || chown -R ec2-user:ec2-user $APP_DIR 2>/dev/null || true
chmod +x $APP_DIR/server.py
echo "✅ 권한 설정 완료"

# 5. systemd 서비스 파일 생성
echo "[5/7] systemd 서비스 등록..."
cat > $SERVICE_FILE << EOF
[Unit]
Description=싸카스포츠 가격비교 웹서버
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/python3 ${APP_DIR}/server.py
Restart=always
RestartSec=5
Environment=PORT=80
StandardOutput=append:${APP_DIR}/server.log
StandardError=append:${APP_DIR}/server.log

[Install]
WantedBy=multi-user.target
EOF
echo "✅ 서비스 파일 생성: $SERVICE_FILE"

# 6. 방화벽 80포트 허용 (ufw 사용 시)
echo "[6/7] 방화벽 설정..."
if command -v ufw &> /dev/null; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "✅ UFW 방화벽 80, 443 포트 허용"
else
  echo "ℹ️  ufw 없음 → AWS 콘솔 Security Group에서 80포트 열어주세요"
fi

# 7. 서비스 시작
echo "[7/7] 서비스 시작..."
systemctl daemon-reload
systemctl enable $APP_NAME
systemctl restart $APP_NAME
sleep 2

# 상태 확인
if systemctl is-active --quiet $APP_NAME; then
  echo ""
  echo "======================================================"
  echo "  ✅ 배포 완료!"
  echo "======================================================"
  echo "  🌐 접속 URL  : http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
  echo "  💚 헬스체크  : http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')/health"
  echo "  📋 로그 확인 : tail -f ${APP_DIR}/server.log"
  echo "  🔄 재시작    : sudo systemctl restart ${APP_NAME}"
  echo "  🛑 중지      : sudo systemctl stop ${APP_NAME}"
  echo "======================================================"
else
  echo "❌ 서비스 시작 실패! 로그 확인:"
  journalctl -u $APP_NAME -n 20 --no-pager
  exit 1
fi
