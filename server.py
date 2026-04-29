#!/usr/bin/env python3
"""
싸카스포츠 가격비교 웹서버
- Naver Shopping API 프록시
- 정적 파일 서버 (index.html, app.js, style.css)
- AWS EC2 배포용 (80포트, CORS 허용, systemd 지원)
"""
import json
import urllib.request
import urllib.parse
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
import sys
import logging
from datetime import datetime

# ──────────────────────────────────────────
# 설정
# ──────────────────────────────────────────
NAVER_CLIENT_ID     = 'y7Wm8_kejUgbXhtZXLtN'
NAVER_CLIENT_SECRET = '61YVCSDYga'

# 포트 설정: 환경변수 PORT 우선, 없으면 80 (AWS) 또는 5060 (로컬)
PORT    = int(os.environ.get('PORT', 80))
WEB_DIR = os.path.dirname(os.path.abspath(__file__))

# CORS 허용 도메인
ALLOWED_ORIGINS = [
    'http://localhost:5060',
    'http://localhost:3000',
    'https://choieunsun0907.github.io',
    'https://price.ssakasports.com',
    'https://www.ssakasports.com',
]

# ──────────────────────────────────────────
# 로깅 설정
# ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(WEB_DIR, 'server.log'), encoding='utf-8'),
    ]
)
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────
# 네이버 쇼핑 API
# ──────────────────────────────────────────
def search_naver(query, display=20, start=1, sort='sim', overseas=False, mall_type=''):
    """네이버 쇼핑 API 검색
    overseas=True: 해외직구 포함 (exclude 파라미터 미사용)
    overseas=False: 국내 위주
    mall_type: ''=전체, '1'=가격비교, '2'=백화점/홈쇼핑, '3'=오픈마켓/쇼핑원도, '4'=네이버페이
    """
    encoded_query = urllib.parse.quote(query)
    # 해외직구 탭이면 exclude 생략, 아니면 cbshop 제외
    exclude_param = '' if overseas else '&exclude=cbshop'
    # mallType 파라미터 (네이버 쇼핑 API 공식 지원)
    mall_type_param = f'&mallType={mall_type}' if mall_type else ''
    url = (
        f'https://openapi.naver.com/v1/search/shop.json'
        f'?query={encoded_query}&display={display}&start={start}&sort={sort}{exclude_param}{mall_type_param}'
    )
    req = urllib.request.Request(url)
    req.add_header('X-Naver-Client-Id',     NAVER_CLIENT_ID)
    req.add_header('X-Naver-Client-Secret', NAVER_CLIENT_SECRET)
    req.add_header('User-Agent', 'Mozilla/5.0')

    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode('utf-8'))
    return data


def build_shop_links(title, link, product_id, mall_name, lprice):
    """쇼핑몰별 링크 생성"""
    clean_title   = title.replace('<b>', '').replace('</b>', '')
    encoded_title = urllib.parse.quote(clean_title)
    base_price    = int(lprice) if lprice else 0

    # ✅ 네이버쇼핑 URL 우선순위:
    # 1순위: 실제 상품 link (가장 정확한 상품 페이지)
    # 2순위: productId로 카탈로그 페이지
    # 3순위: 검색 결과 페이지
    if link:
        naver_url = link
    elif product_id:
        naver_url = f'https://search.shopping.naver.com/catalog/{product_id}'
    else:
        naver_url = f'https://search.shopping.naver.com/search/all?query={encoded_title}'

    return [
        {'name': '네이버쇼핑', 'logo': 'https://shopv.pstatic.net/web/ads/favicon.ico',
         'url': naver_url, 'price': base_price, 'badge': '최저가'},
        {'name': '쿠팡',     'logo': 'https://www.coupang.com/favicon.ico',
         'url': f'https://www.coupang.com/np/search?q={encoded_title}',
         'price': int(base_price * 1.02),  'badge': ''},
        {'name': 'G마켓',   'logo': 'https://www.gmarket.co.kr/favicon.ico',
         'url': f'https://www.gmarket.co.kr/n/search?keyword={encoded_title}',
         'price': int(base_price * 1.025), 'badge': ''},
        {'name': '11번가',  'logo': 'https://www.11st.co.kr/favicon.ico',
         'url': f'https://search.11st.co.kr/Search.tmall?kwd={encoded_title}',
         'price': int(base_price * 1.03),  'badge': ''},
        {'name': 'SSG.COM', 'logo': 'https://www.ssg.com/favicon.ico',
         'url': f'https://www.ssg.com/search.ssg?query={encoded_title}',
         'price': int(base_price * 1.035), 'badge': ''},
        {'name': '옥션',    'logo': 'https://www.auction.co.kr/favicon.ico',
         'url': f'https://www.auction.co.kr/search?keyword={encoded_title}',
         'price': int(base_price * 1.04),  'badge': ''},
        {'name': '롯데온',  'logo': 'https://www.lotteon.com/favicon.ico',
         'url': f'https://www.lotteon.com/p/search?keyword={encoded_title}',
         'price': int(base_price * 1.045), 'badge': ''},
    ]


# ──────────────────────────────────────────
# HTTP 핸들러
# ──────────────────────────────────────────
class PriceHubHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    # ── CORS 헤더 ──
    def end_headers(self):
        origin = self.headers.get('Origin', '')
        # 허용된 도메인이면 해당 도메인 명시, 아니면 * 허용
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('X-Frame-Options', 'ALLOWALL')
        self.send_header('Content-Security-Policy', 'frame-ancestors *')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # ✅ 한글 URL 인코딩 문제 해결: raw_path를 UTF-8로 명시 디코딩
        raw_path = self.path
        try:
            raw_path = raw_path.encode('latin-1').decode('utf-8')
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
        parsed = urllib.parse.urlparse(raw_path)
        path   = parsed.path
        params = urllib.parse.parse_qs(parsed.query, encoding='utf-8')

        if path == '/api/search':
            self.handle_search(params)
        elif path == '/api/popular':
            self.handle_popular(params)
        elif path == '/api/detail':
            self.handle_detail(params)
        elif path == '/health':
            # AWS 헬스체크 엔드포인트
            self.send_json({'status': 'ok', 'time': datetime.now().isoformat()})
        else:
            # SPA 라우팅: 파일 없으면 index.html 반환
            file_path = os.path.join(WEB_DIR, path.lstrip('/'))
            if not os.path.exists(file_path) and not path.startswith('/api'):
                self.path = '/index.html'
            super().do_GET()

    # ── 검색 API ──
    def handle_search(self, params):
        query    = params.get('q', [''])[0]
        sort     = params.get('sort', ['sim'])[0]
        display  = int(params.get('display', ['20'])[0])
        start    = int(params.get('start', ['1'])[0])
        mall_tab = params.get('mall_type', [''])[0]
        # mall_tab: '' = 전체, 'price' = 가격비교(productType=1),
        #           'npay' = 네이버페이/스마트스토어(productType=2),
        #           'open' = 쇼핑원도(productType=2 중 스마트스토어 외),
        #           'overseas' = 해외직구(cbshop 포함)

        display  = max(1, min(100, display))
        overseas = (mall_tab == 'overseas')

        if not query:
            self.send_json({'error': '검색어를 입력하세요', 'items': []})
            return

        try:
            # 탭 필터 시 100개 가져와서 클라이언트 필터링 (API 제약으로 최대 100)
            fetch_display = 100 if mall_tab in ('price', 'npay', 'open') else display
            data  = search_naver(query, display=fetch_display, start=start,
                                 sort=sort, overseas=overseas)
            raw_items = data.get('items', [])
            total     = data.get('total', 0)

            def classify(item):
                """productType 기반 탭 분류
                productType=1 → 네이버 카탈로그(가격비교 페이지)
                productType=2 → 개별 판매자 상품
                  - 링크가 smartstore.naver.com → 네이버페이(스마트스토어)
                  - 그 외 → 쇼핑원도(외부 몰)
                """
                pt   = str(item.get('productType', ''))
                link = item.get('link', '')
                if pt == '1':
                    return 'price'
                if 'smartstore.naver.com' in link or 'brand.naver.com' in link:
                    return 'npay'
                return 'open'

            results = []
            for item in raw_items:
                title       = item.get('title', '')
                clean_title = title.replace('<b>', '').replace('</b>', '')
                lprice      = item.get('lprice', '0')
                hprice      = item.get('hprice', '0') or lprice
                link        = item.get('link', '')
                tab_cls     = classify(item)

                shops = build_shop_links(
                    title, link,
                    item.get('productId', ''),
                    item.get('mallName', ''),
                    lprice
                )
                results.append({
                    'id':          item.get('productId', ''),
                    'title':       clean_title,
                    'image':       item.get('image', ''),
                    'lprice':      int(lprice) if lprice else 0,
                    'hprice':      int(hprice) if hprice else 0,
                    'mall':        item.get('mallName', ''),
                    'brand':       item.get('brand', ''),
                    'category':    item.get('category1', ''),
                    'link':        link,
                    'shops':       shops,
                    'productType': item.get('productType', ''),
                    'tabClass':    tab_cls,
                })

            # 탭별 카운트
            tab_counts = {
                'all':   len(results),
                'price': sum(1 for r in results if r['tabClass'] == 'price'),
                'npay':  sum(1 for r in results if r['tabClass'] == 'npay'),
                'open':  sum(1 for r in results if r['tabClass'] == 'open'),
            }

            # 탭 필터 적용
            if mall_tab == 'price':
                filtered = [r for r in results if r['tabClass'] == 'price']
            elif mall_tab == 'npay':
                filtered = [r for r in results if r['tabClass'] == 'npay']
            elif mall_tab == 'open':
                filtered = [r for r in results if r['tabClass'] == 'open']
            else:
                filtered = results  # 전체 or 해외직구

            filtered = filtered[:display]

            logger.info(f'검색: "{query}" tab={mall_tab!r} → {len(filtered)}개 (총 {total}개) '
                        f'[price={tab_counts["price"]} npay={tab_counts["npay"]} open={tab_counts["open"]}]')
            self.send_json({
                'query':      query,
                'total':      total,
                'tab_counts': tab_counts,
                'items':      filtered,
            })

        except urllib.error.HTTPError as e:
            logger.error(f'Naver API Error: {e.code} / query={query}')
            self.send_json({'error': f'API 오류: {e.code}', 'items': [], 'fallback': True})
        except Exception as e:
            logger.error(f'Search Error: {e}')
            self.send_json({'error': str(e), 'items': [], 'fallback': True})

    # ── 인기상품 API ──
    def handle_popular(self, params):
        category = params.get('category', ['축구화'])[0]
        try:
            data    = search_naver(category, display=12, sort='sim')
            items   = data.get('items', [])
            results = []
            for item in items:
                title  = item.get('title', '').replace('<b>', '').replace('</b>', '')
                lprice = item.get('lprice', '0')
                shops  = build_shop_links(
                    item.get('title', ''),
                    item.get('link', ''),
                    item.get('productId', ''),
                    item.get('mallName', ''),
                    lprice
                )
                results.append({
                    'id':     item.get('productId', ''),
                    'title':  title,
                    'image':  item.get('image', ''),
                    'lprice': int(lprice) if lprice else 0,
                    'mall':   item.get('mallName', ''),
                    'brand':  item.get('brand', ''),
                    'link':   item.get('link', ''),
                    'shops':  shops,
                })
            self.send_json({'category': category, 'items': results, 'total': len(results)})
        except Exception as e:
            logger.error(f'Popular Error: {e}')
            self.send_json({'error': str(e), 'items': []})

    # ── 상세 API ──
    def handle_detail(self, params):
        query  = params.get('q', [''])[0]
        link   = params.get('link', [''])[0]
        lprice = params.get('lprice', ['0'])[0]
        try:
            shops = build_shop_links(query, link, '', '', lprice)
            self.send_json({'shops': shops})
        except Exception as e:
            self.send_json({'error': str(e), 'shops': []})

    # ── JSON 응답 ──
    def send_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        logger.info(f'[{self.address_string()}] {format % args}')


# ──────────────────────────────────────────
# 서버 시작
# ──────────────────────────────────────────
if __name__ == '__main__':
    os.chdir(WEB_DIR)
    try:
        server = HTTPServer(('0.0.0.0', PORT), PriceHubHandler)
        logger.info(f'🚀 싸카스포츠 가격비교 서버 시작')
        logger.info(f'📡 포트     : {PORT}')
        logger.info(f'📁 디렉토리: {WEB_DIR}')
        logger.info(f'🌐 접속URL  : http://0.0.0.0:{PORT}')
        logger.info(f'💚 헬스체크 : http://0.0.0.0:{PORT}/health')
        server.serve_forever()
    except PermissionError:
        logger.error(f'포트 {PORT} 권한 없음 → sudo python3 server.py 로 실행하세요')
        sys.exit(1)
    except OSError as e:
        logger.error(f'포트 {PORT} 사용 중 → 다른 프로세스 종료 후 재시작하세요: {e}')
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info('서버 종료')
        server.server_close()
