/* ===== 상태 관리 ===== */
const state = {
  currentPage: 'home',
  prevPage: 'home',
  currentQuery: '',
  currentSort: 'sim',   // 기본 정렬: 정확도순 (네이버 API 랭킹 기준)
  homeStart: 1,
  searchStart: 1,
  homeCategory: '싸카닷컴 축구',
  wishlist: JSON.parse(localStorage.getItem('wishlist') || '[]'),
  compareList: JSON.parse(localStorage.getItem('compareList') || '[]'),
  currentDetail: null,
};

/* ===== 내부 아이템 레지스트리 (id → item 매핑, shops 보존용) ===== */
const _itemRegistry = new Map();
function _registerItem(item) {
  if (!item) return item;
  // id가 없거나 빈 문자열이면 임시 고유 id 부여
  if (!item.id) {
    item.id = 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }
  // 기존에 shops 없으면 registry에서 보완
  const existing = _itemRegistry.get(item.id);
  if (existing && existing.shops && existing.shops.length > 0 && (!item.shops || item.shops.length === 0)) {
    item.shops = existing.shops;
  }
  _itemRegistry.set(item.id, item);
  return item;
}
function _getItem(id) {
  return _itemRegistry.get(id) || null;
}

/* ===== API 베이스 URL ===== */
// GitHub Pages / price.ssakasports.com 둘 다 샌드박스 API 서버 사용 (임시)
// → 로컬:         http://localhost:5060
// → 샌드박스:     https://5060-i8633dkrgikcaiinfwstx-5c13a017.sandbox.novita.ai/
// → GitHub Pages: https://choieunsun0907.github.io/ai/  (API → 샌드박스)
// → 실제서버:     https://price.ssakasports.com/        (API → 샌드박스)
const SANDBOX_API = 'https://5060-i8633dkrgikcaiinfwstx-5c13a017.sandbox.novita.ai';

const BASE_URL = (
  window.location.hostname === 'choieunsun0907.github.io' ||
  window.location.hostname === 'price.ssakasports.com'
)
  ? SANDBOX_API          // GitHub Pages / 실제서버 → 샌드박스 API
  : window.location.origin;  // 로컬 / 샌드박스 직접 접속 → 자동 감지

/* ===== 검색 옵션 헬퍼 ===== */
function getSearchOptions() {
  // 현재 페이지에 따라 적절한 컨트롤에서 값 읽기
  const isSearchPage = state.currentPage === 'search';
  const overseasEl = isSearchPage
    ? document.getElementById('includeOverseasSearch')
    : document.getElementById('includeOverseas');
  const countEl = isSearchPage
    ? document.getElementById('searchDisplayCountSearch')
    : document.getElementById('searchDisplayCount');

  const overseas = overseasEl ? overseasEl.checked : false;
  const count = countEl ? parseInt(countEl.value, 10) : 20;
  return { overseas, count };
}

// 홈 검색 옵션 변경시 (체크박스/카운트) → 현재 카테고리 재로드
function refreshSearchOptions() {
  if (state.currentQuery) {
    triggerSearch(state.currentQuery);
  }
}

/* ===== API 호출 ===== */
async function apiSearch(query, sort = 'sim', start = 1, display = 20, overseas = false) {
  // 해외 직구 포함 옵션: query 뒤에 '해외직구' 추가 여부로 처리
  // Naver API는 filter 파라미터 없으므로 query 조작 방식 사용
  const finalQuery = overseas ? query : query;
  const excludeParam = overseas ? '' : '&exclude=used:rental:cbshop';
  const url = `${BASE_URL}/api/search?q=${encodeURIComponent(finalQuery)}&sort=${sort}&start=${start}&display=${display}&overseas=${overseas ? '1' : '0'}${excludeParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPopular(category) {
  const url = `${BASE_URL}/api/popular?category=${encodeURIComponent(category)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ===== 페이지 전환 ===== */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById(`nav-${name}`);
  if (navEl) navEl.classList.add('active');

  state.prevPage = state.currentPage;
  state.currentPage = name;

  if (name === 'wishlist') renderWishlist();
  if (name === 'compare') renderCompare();
  window.scrollTo(0, 0);
}

function goBack() {
  showPage(state.prevPage || 'home');
}

/* ===== 헤더 검색 ===== */
function doSearch() {
  const q = document.getElementById('headerSearchInput').value.trim();
  if (!q) return;
  triggerSearch(q);
}

document.getElementById('headerSearchInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') doSearch();
});

function doHeroSearch() {
  const q = document.getElementById('heroSearchInput').value.trim();
  if (!q) return;
  triggerSearch(q);
}

function searchChip(q) { triggerSearch(q); }

async function triggerSearch(query) {
  state.currentQuery = query;
  state.searchStart = 1;
  document.getElementById('headerSearchInput').value = query;

  showPage('search');

  // 검색 페이지 옵션 동기화
  const homeCount = document.getElementById('searchDisplayCount');
  const searchCount = document.getElementById('searchDisplayCountSearch');
  if (homeCount && searchCount && state.currentPage !== 'search') {
    searchCount.value = homeCount.value;
  }
  const homeOverseas = document.getElementById('includeOverseas');
  const searchOverseas = document.getElementById('includeOverseasSearch');
  if (homeOverseas && searchOverseas && state.currentPage !== 'search') {
    searchOverseas.checked = homeOverseas.checked;
  }

  const { overseas, count } = getSearchOptions();
  const overseasLabel = overseas ? ' 🌏해외포함' : '';
  document.getElementById('searchResultTitle').textContent = `"${query}" 검색결과${overseasLabel}`;
  document.getElementById('searchLoading').style.display = 'block';
  document.getElementById('searchGrid').innerHTML = '';
  document.getElementById('searchLoadMoreWrap').style.display = 'none';

  try {
    const data = await apiSearch(query, state.currentSort, 1, count, overseas);
    renderSearchResults(data.items || [], false);
    if ((data.total || 0) > count) {
      document.getElementById('searchLoadMoreWrap').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('searchGrid').innerHTML = `<div style="padding:32px;color:#999;grid-column:1/-1;text-align:center;">⚠️ 검색 실패: ${e.message}</div>`;
  } finally {
    document.getElementById('searchLoading').style.display = 'none';
  }
}

function renderSearchResults(items, append) {
  const grid = document.getElementById('searchGrid');
  if (!append) grid.innerHTML = '';
  items.forEach(item => {
    _registerItem(item);
    grid.appendChild(createProductCard(item));
  });
  if (items.length === 0 && !append) {
    grid.innerHTML = `<div style="padding:48px;color:#999;grid-column:1/-1;text-align:center;">🔍 검색 결과가 없어요</div>`;
  }
}

async function loadMoreSearch() {
  const { overseas, count } = getSearchOptions();
  state.searchStart += count;
  try {
    const data = await apiSearch(state.currentQuery, state.currentSort, state.searchStart, count, overseas);
    renderSearchResults(data.items || [], true);
    if (state.searchStart + count > (data.total || 0)) {
      document.getElementById('searchLoadMoreWrap').style.display = 'none';
    }
  } catch (e) {
    showToast('더 불러오기 실패');
  }
}

async function changeSortAndSearch() {
  state.currentSort = document.getElementById('sortSelect').value;
  if (state.currentQuery) {
    await triggerSearch(state.currentQuery);
  }
}

function syncOverseasCheckboxes() {
  const home = document.getElementById('includeOverseas');
  const search = document.getElementById('includeOverseasSearch');
  if (home && search) search.checked = home.checked;
}

/* ===== 홈 카테고리 ===== */
async function selectCategory(category, btn) {
  state.homeCategory = category;
  state.homeStart = 1;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.getElementById('homeLoading').style.display = 'block';
  document.getElementById('homeGrid').innerHTML = '';
  document.getElementById('loadMoreWrap').style.display = 'none';

  try {
    const data = await apiSearch(category, 'sim', 1, 16);
    state.homeStart = 1;
    renderHomeGrid(data.items || [], false);
    // 상품이 16개 이상이면 더보기 표시
    if ((data.items || []).length >= 16) {
      document.getElementById('loadMoreWrap').style.display = 'block';
    }
  } catch (e) {
    document.getElementById('homeGrid').innerHTML = `<div style="padding:32px;color:#999;grid-column:1/-1;text-align:center;">⚠️ 불러오기 실패</div>`;
  } finally {
    document.getElementById('homeLoading').style.display = 'none';
  }
}

function renderHomeGrid(items, append) {
  const grid = document.getElementById('homeGrid');
  if (!append) grid.innerHTML = '';
  items.forEach(item => {
    _registerItem(item);
    grid.appendChild(createProductCard(item));
  });
}

async function loadMore() {
  state.homeStart += 16;
  try {
    const data = await apiSearch(state.homeCategory, 'sim', state.homeStart, 16);
    const items = data.items || [];
    renderHomeGrid(items, true);
    // 가져온 상품이 16개 미만이면 더보기 숨김
    if (items.length < 16) {
      document.getElementById('loadMoreWrap').style.display = 'none';
    }
  } catch (e) {
    showToast('더 불러오기 실패');
  }
}

/* ===== 상품 카드 생성 ===== */
function createProductCard(item) {
  const isWished = state.wishlist.some(w => w.id === item.id);
  const isCompared = state.compareList.some(c => c.id === item.id);
  const price = item.lprice || 0;

  const card = document.createElement('div');
  card.className = 'product-card';
  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${item.image || 'https://via.placeholder.com/300x300?text=No+Image'}" 
           alt="${escHtml(item.title)}" 
           onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
      <!-- card-badge 제거됨 -->
      <div class="card-actions">
        <button class="card-action-btn ${isWished ? 'wishlisted' : ''}" 
                onclick="toggleWishlist(event, '${escAttr(item.id)}')" 
                title="위시리스트">
          ${isWished ? '❤️' : '🤍'}
        </button>
        <button class="card-action-btn ${isCompared ? 'wishlisted' : ''}" 
                onclick="toggleCompare(event, '${escAttr(item.id)}')" 
                title="비교에 추가">
          📊
        </button>
      </div>
    </div>
    <div class="card-body">
      <div class="card-mall">${escHtml(item.mall || '')}</div>
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-price-wrap">
        <span class="card-price">${price.toLocaleString()}</span>
        <span class="card-price-unit">원</span>
        <span class="card-price-label">최저</span>
      </div>
      <button class="card-compare-btn" onclick="toggleCompare(event, '${escAttr(item.id)}')">
        ${isCompared ? '✓ 비교중' : '+ 비교하기'}
      </button>
    </div>
  `;

  // 카드 클릭 → 상세
  card.addEventListener('click', () => showDetail(item));

  // 이 카드 item 저장 (toggle에서 쓸 수 있게)
  card._item = item;
  _registerItem(item); // 레지스트리에 등록 (shops 보존)

  return card;
}

/* ===== 상세 페이지 ===== */
function _renderDetailContent(item) {
  const shops = item.shops || [];
  const bestShop = shops[0];
  const isWished = state.wishlist.some(w => w.id === item.id);
  const safeId = String(item.id || '').replace(/'/g, "\\'");

  /* ✅ URL을 HTML 속성 안에 안전하게 넣기 위해 & → &amp; 변환 */
  function safeHref(url) {
    if (!url || url === '#') return '#';
    return url.replace(/&/g, '&amp;');
  }

  return `
    <div class="detail-top">
      <div class="detail-img-section">
        <img class="detail-img" 
             src="${item.image || 'https://via.placeholder.com/400x400?text=No+Image'}" 
             alt="${escHtml(item.title)}"
             onerror="this.src='https://via.placeholder.com/400x400?text=No+Image'">
        <div class="detail-info">
          <div class="detail-mall-brand">
            ${item.mall ? `<span class="badge-mall">${escHtml(item.mall)}</span>` : ''}
            ${item.brand ? `<span class="badge-brand">${escHtml(item.brand)}</span>` : ''}
            ${item.category ? `<span class="badge-mall">${escHtml(item.category)}</span>` : ''}
          </div>
          <div class="detail-title">${escHtml(item.title)}</div>
          <div class="detail-best-price-wrap">
            <div>
              <div class="detail-best-price-label">🏆 최저가</div>
              <div class="detail-best-price"><span>₩</span>${(item.lprice || 0).toLocaleString()}</div>
            </div>
            ${bestShop ? `<div style="font-size:12px;color:#E8950E;font-weight:600;">${escHtml(bestShop.name)}</div>` : ''}
          </div>
          <div class="detail-btn-row">
            <a href="${safeHref(item.link)}" target="_blank" rel="noopener" class="btn-orange">
              🛍️ 네이버 최저가 보기
            </a>
            <button class="btn-wishlist" onclick="toggleWishlistDetail('${safeId}')" id="wishBtn">
              ${isWished ? '❤️' : '🤍'}
            </button>
          </div>
          <div class="detail-btn-row" style="margin-top:0">
            <button class="btn-primary" onclick="toggleCompareFromDetail('${safeId}')">
              📊 비교에 추가
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="shop-compare-section">
      <div class="shop-compare-title">🏪 쇼핑몰별 가격 비교</div>
      ${shops.length === 0
        ? `<div style="padding:24px;color:#999;text-align:center;">⏳ 쇼핑몰 정보를 불러오는 중...</div>`
        : shops.map((shop, idx) => `
              <a href="${safeHref(shop.url)}" target="_blank" rel="noopener" class="shop-row">
                <div class="shop-logo-wrap">${shop.logo || '🛒'}</div>
                <div class="shop-info">
                  <div class="shop-name">
                    ${escHtml(shop.name)}
                    ${shop.badge ? `<span class="shop-badge">${escHtml(shop.badge)}</span>` : ''}
                  </div>
                </div>
                <div class="shop-price-wrap">
                  <div class="shop-price ${idx === 0 ? 'best' : ''}">
                    ${(shop.price || 0).toLocaleString()}<span class="shop-price-unit">원</span>
                  </div>
                </div>
                <div class="shop-arrow">→</div>
              </a>`).join('')
      }
    </div>
  `;
}

async function showDetail(item) {
  // registry에서 shops가 있는 최신 버전 가져오기
  if (item && item.id) {
    const registered = _getItem(item.id);
    if (registered && registered.shops && registered.shops.length > 0) {
      item = registered;
    }
  }

  state.currentDetail = item;
  state.prevPage = state.currentPage;

  const content = document.getElementById('detailContent');

  // 우선 기본 UI 표시
  content.innerHTML = _renderDetailContent(item);
  showPage('detail');

  // shops 없으면 API에서 보완 후 재렌더링
  if (!item.shops || item.shops.length === 0) {
    item = await _ensureShops(item);
    state.currentDetail = item;
    content.innerHTML = _renderDetailContent(item);
  }
}

/* ===== 위시리스트 ===== */
function toggleWishlist(event, itemId) {
  event.stopPropagation();
  const item = findItemById(itemId);
  if (!item) return;

  const idx = state.wishlist.findIndex(w => w.id === itemId);
  if (idx >= 0) {
    state.wishlist.splice(idx, 1);
    showToast('위시리스트에서 제거됐어요');
  } else {
    state.wishlist.push(item);
    showToast('❤️ 위시리스트에 추가됐어요!');
  }
  localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
  refreshCards();
}

function toggleWishlistDetail(itemId) {
  const item = state.currentDetail;
  if (!item) return;
  const idx = state.wishlist.findIndex(w => w.id === itemId);
  if (idx >= 0) {
    state.wishlist.splice(idx, 1);
    document.getElementById('wishBtn').textContent = '🤍';
    showToast('위시리스트에서 제거됐어요');
  } else {
    state.wishlist.push(item);
    document.getElementById('wishBtn').textContent = '❤️';
    showToast('❤️ 위시리스트에 추가됐어요!');
  }
  localStorage.setItem('wishlist', JSON.stringify(state.wishlist));
}

function renderWishlist() {
  const grid = document.getElementById('wishlistGrid');
  const empty = document.getElementById('wishlistEmpty');

  if (state.wishlist.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = '';
  state.wishlist.forEach(item => {
    _registerItem(item); // registry에 등록
    const card = createProductCard(item);
    grid.appendChild(card);
  });
}

/* ===== 비교 ===== */
const MAX_COMPARE = 8;

// compareList 아이템들 registry에 등록 (shops가 없으면 API로 보완)
async function _ensureShops(item) {
  if (item.shops && item.shops.length > 0) {
    _registerItem(item);
    return item;
  }
  // ✅ shops가 없으면 /api/detail 엔드포인트로 빠르게 가져오기
  try {
    const q   = encodeURIComponent(item.title || '');
    const lnk = encodeURIComponent(item.link  || '');
    const prc = item.lprice || 0;
    const res = await fetch(`${BASE_URL}/api/detail?q=${q}&link=${lnk}&lprice=${prc}`);
    if (res.ok) {
      const data = await res.json();
      if (data.shops && data.shops.length > 0) {
        item.shops = data.shops;
      }
    }
  } catch (e) {
    console.warn('shops 재요청 실패:', e);
  }
  // API 실패 시 네이버 링크 하나라도 보여주기
  if (!item.shops || item.shops.length === 0) {
    item.shops = [
      { name: '네이버쇼핑', logo: '🛍️', url: item.link || '#', price: item.lprice || 0, badge: '최저가' },
      { name: '쿠팡',      logo: '🛒', url: `https://www.coupang.com/np/search?q=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.02), badge: '' },
      { name: 'G마켓',    logo: '🏪', url: `https://www.gmarket.co.kr/n/search?keyword=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.025), badge: '' },
      { name: '11번가',   logo: '🏬', url: `https://search.11st.co.kr/Search.tmall?kwd=${encodeURIComponent(item.title||'')}`, price: Math.round((item.lprice||0)*1.03), badge: '' },
    ];
  }
  _registerItem(item);
  return item;
}

function toggleCompare(event, itemId) {
  event.stopPropagation();
  const item = findItemById(itemId);
  if (!item) return;

  const idx = state.compareList.findIndex(c => c.id === itemId);
  if (idx >= 0) {
    state.compareList.splice(idx, 1);
    showToast('비교 목록에서 제거됐어요');
    localStorage.setItem('compareList', JSON.stringify(state.compareList));
    refreshCards();
    updateCompareBadge();
  } else {
    if (state.compareList.length >= MAX_COMPARE) {
      // ✅ 확인 팝업: 제거할 상품 선택
      showCompareFullModal(item);
    } else {
      state.compareList.push(item);
      showToast(`📊 비교 목록에 추가됐어요! (${state.compareList.length}/${MAX_COMPARE})`);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      updateCompareBadge();
    }
  }
}

function toggleCompareFromDetail(itemId) {
  const item = state.currentDetail;
  if (!item) return;
  const idx = state.compareList.findIndex(c => c.id === itemId);
  if (idx >= 0) {
    state.compareList.splice(idx, 1);
    showToast('비교 목록에서 제거됐어요');
    localStorage.setItem('compareList', JSON.stringify(state.compareList));
    refreshCards();
    updateCompareBadge();
  } else {
    if (state.compareList.length >= MAX_COMPARE) {
      showCompareFullModal(item);
    } else {
      state.compareList.push(item);
      showToast(`📊 비교 목록에 추가됐어요! (${state.compareList.length}/${MAX_COMPARE})`);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      updateCompareBadge();
    }
  }
}

/* ===== 비교 목록 꽉 찼을 때 교체 확인 모달 ===== */
function showCompareFullModal(newItem) {
  // 기존 모달 제거
  const existing = document.getElementById('compareFullModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'compareFullModal';
  modal.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.55);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  const newTitle = (newItem.title || '').slice(0, 20);
  const listHTML = state.compareList.map((item, i) => `
    <div class="cmp-modal-row" onclick="replaceCompareItem(${i}, '${String(newItem.id).replace(/'/g,"\'")}')">
      <img src="${item.image || ''}" onerror="this.style.display='none'" 
           style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex-shrink:0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${(item.title || '').slice(0, 28)}
        </div>
        <div style="font-size:12px;color:#E8950E;font-weight:700;margin-top:2px;">
          ${(item.lprice || 0).toLocaleString()}원
        </div>
      </div>
      <span style="font-size:12px;color:#fff;background:#1976D2;border-radius:6px;padding:4px 10px;flex-shrink:0;font-weight:600;">교체</span>
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:420px;
                box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1976D2,#42A5F5);padding:18px 20px;">
        <div style="font-size:16px;font-weight:700;color:#fff;">📊 비교 목록이 가득 찼어요</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">
          <strong style="color:#FFD54F;">"${newTitle}..."</strong> 추가를 위해<br>교체할 상품을 선택해주세요
        </div>
      </div>
      <div style="padding:12px 16px;max-height:340px;overflow-y:auto;">
        <div style="font-size:12px;color:#888;margin-bottom:8px;">👇 아래 상품 중 하나를 선택하면 교체됩니다</div>
        <div id="cmpModalList" style="display:flex;flex-direction:column;gap:8px;">
          ${listHTML}
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('compareFullModal').remove()"
          style="padding:9px 20px;border:1.5px solid #ddd;border-radius:8px;
                 background:#fff;color:#666;font-size:13px;font-weight:600;cursor:pointer;">
          취소
        </button>
      </div>
    </div>
  `;

  // 배경 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);

  // 모달 행 hover 스타일 동적 적용
  modal.querySelectorAll('.cmp-modal-row').forEach(row => {
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;
      border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;transition:all 0.15s;`;
    row.addEventListener('mouseenter', () => {
      row.style.background = '#EBF5FF';
      row.style.borderColor = '#1976D2';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
      row.style.borderColor = '#e8e8e8';
    });
  });

  // 새 아이템을 임시 저장 (replaceCompareItem에서 사용)
  window._pendingCompareItem = newItem;
}

function replaceCompareItem(removeIdx, newItemId) {
  const newItem = window._pendingCompareItem;
  if (!newItem) return;

  const removedTitle = (state.compareList[removeIdx]?.title || '').slice(0, 14);
  state.compareList.splice(removeIdx, 1);
  state.compareList.push(newItem);

  localStorage.setItem('compareList', JSON.stringify(state.compareList));
  refreshCards();
  updateCompareBadge();

  document.getElementById('compareFullModal')?.remove();
  window._pendingCompareItem = null;

  showToast(`🔄 "${removedTitle}.." 제거 → 새 상품 추가됐어요!`);
  if (state.currentPage === 'compare') renderCompare();
}

function updateCompareBadge() {
  const badge = document.getElementById('compareCountBadge');
  if (badge) badge.textContent = `${state.compareList.length} / ${MAX_COMPARE}`;
}

/* =========================================================
   비교 페이지 – 체크박스 + 저장 (완전 재작성)
   체크 상태: Set<number> (인덱스 기반 – id 특수문자 무관)
   ========================================================= */
let checkedIndexes = new Set();   // 현재 체크된 카드 인덱스 모음

/* ─────────────────────────────────────────
   renderCompare : 그리드 전체 재렌더링
───────────────────────────────────────── */
function renderCompare() {
  const grid    = document.getElementById('compareItems');
  const empty   = document.getElementById('compareEmpty');
  const toolbar = document.getElementById('compareToolbar');

  updateCompareBadge();
  checkedIndexes.clear();          // 렌더할 때마다 선택 초기화

  /* ── 비어있을 때 ── */
  if (state.compareList.length === 0) {
    grid.innerHTML    = '';
    empty.style.display   = 'block';
    toolbar.style.display = 'none';
    _syncCheckAllUI();
    return;
  }

  empty.style.display   = 'none';
  toolbar.style.display = 'flex';
  grid.innerHTML        = '';

  state.compareList.forEach((item, idx) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '#');
    const shortLink = naverLink.length > 46
      ? naverLink.substring(0, 46) + '…'
      : naverLink;

    /* ── 카드 DOM ── */
    const card = document.createElement('div');
    card.className    = 'compare-card';
    card.dataset.idx  = String(idx);

    card.innerHTML = `
      <div class="cmp-card-top">
        <label class="cmp-card-chk-label">
          <input type="checkbox" class="cmp-card-chk-input">
          <span class="cmp-card-chk-box"></span>
          <span class="cmp-card-chk-text">선택</span>
        </label>
        <button class="cmp-card-remove" type="button" title="이 상품 제거">✕</button>
      </div>
      <div class="cmp-card-overlay"></div>

      <img class="cmp-card-img"
           src="${item.image ? escHtml(item.image) : ''}"
           alt="${escHtml(item.title)}"
           onerror="this.src='https://via.placeholder.com/400x400?text=No+Image'">

      <div class="cmp-card-body">
        <div class="cmp-card-num">상품 #${idx + 1}</div>
        <div class="cmp-card-title">${escHtml(item.title)}</div>

        <div class="cmp-info-table">
          <div class="cmp-info-row">
            <div class="cmp-info-key">상품코드</div>
            <div class="cmp-info-val">${escHtml(String(item.id || '-'))}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">브랜드</div>
            <div class="cmp-info-val">${escHtml(item.brand || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">카테고리</div>
            <div class="cmp-info-val">${escHtml(item.category || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">최저가</div>
            <div class="cmp-info-val v-price">${(item.lprice || 0).toLocaleString()}원</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">판매몰</div>
            <div class="cmp-info-val">${escHtml(item.mall || '-')}</div>
          </div>
          <div class="cmp-info-row">
            <div class="cmp-info-key">링크</div>
            <div class="cmp-info-val v-link">
              <a href="${escHtml(naverLink)}" target="_blank" rel="noopener">${escHtml(shortLink)}</a>
            </div>
          </div>
        </div>

        <button class="cmp-detail-btn" type="button">🔍 쇼핑몰별 가격 비교 →</button>
      </div>
    `;

    /* ── 체크 레이블 클릭 ── */
    card.querySelector('.cmp-card-chk-label').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleCardCheck(card, idx);
    });

    /* ── 카드 본문 클릭 → 체크 토글 (버튼·링크 제외) ── */
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cmp-card-remove')  ||
          e.target.closest('.cmp-detail-btn')    ||
          e.target.closest('.cmp-card-chk-label')||
          e.target.tagName === 'A') return;
      _toggleCardCheck(card, idx);
    });

    /* ── 삭제(✕) 버튼 ── */
    card.querySelector('.cmp-card-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(card.dataset.idx, 10);
      state.compareList.splice(i, 1);
      localStorage.setItem('compareList', JSON.stringify(state.compareList));
      refreshCards();
      renderCompare();
      showToast('비교 목록에서 제거됐어요');
    });

    /* ── 쇼핑몰별 가격 비교 버튼 ── */
    card.querySelector('.cmp-detail-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showDetail(item);
    });

    grid.appendChild(card);
  });

  _updateSelCount();
  _syncCheckAllUI();
}

/* ─────────────────────────────────────────
   내부 헬퍼
───────────────────────────────────────── */

/** 카드 하나의 체크 상태를 토글 */
function _toggleCardCheck(card, idx) {
  const nowChecked = card.classList.contains('is-checked');
  _setCardCheck(card, idx, !nowChecked);
}

/** 카드 체크 상태 강제 설정 */
function _setCardCheck(card, idx, checked) {
  const inp = card.querySelector('.cmp-card-chk-input');
  if (checked) {
    checkedIndexes.add(idx);
    card.classList.add('is-checked');
    if (inp) inp.checked = true;
  } else {
    checkedIndexes.delete(idx);
    card.classList.remove('is-checked');
    if (inp) inp.checked = false;
  }
  _updateSelCount();
  _syncCheckAllUI();
}

/** 선택 카운트 텍스트 갱신 */
function _updateSelCount() {
  const el = document.getElementById('selectedCount');
  if (el) el.textContent = `${checkedIndexes.size}개 선택됨`;
}

/** 전체선택 체크박스 UI 동기화 */
function _syncCheckAllUI() {
  const total = state.compareList.length;
  const label = document.getElementById('checkAllLabel');
  const inp   = document.getElementById('checkAll');
  const allChecked = total > 0 && checkedIndexes.size === total;
  if (label) label.classList.toggle('is-checked', allChecked);
  if (inp)   inp.checked = allChecked;
}

/** 체크된 아이템 배열 반환 (없으면 전체) */
function _getTargets() {
  if (checkedIndexes.size > 0) {
    return Array.from(checkedIndexes)
      .sort((a, b) => a - b)
      .map(i => state.compareList[i])
      .filter(Boolean);
  }
  return [...state.compareList];
}

/* ─────────────────────────────────────────
   전체선택 토글 (툴바 체크박스)
───────────────────────────────────────── */
function toggleCheckAll(el) {
  /* el = hidden checkbox – checked 상태를 먼저 토글한 뒤 처리 */
  el.checked = !el.checked;          // 레이블 클릭이므로 직접 토글
  const shouldCheck = el.checked;
  checkedIndexes.clear();

  document.querySelectorAll('#compareItems .compare-card').forEach((card, idx) => {
    _setCardCheck(card, idx, shouldCheck);
  });
  _updateSelCount();
  _syncCheckAllUI();
}

/* ─────────────────────────────────────────
   선택 삭제
───────────────────────────────────────── */
function deleteSelected() {
  if (checkedIndexes.size === 0) {
    showToast('⚠️ 삭제할 상품을 먼저 체크해주세요');
    return;
  }
  const sortedIdxs = Array.from(checkedIndexes).sort((a, b) => b - a);
  const cnt = sortedIdxs.length;
  sortedIdxs.forEach(i => state.compareList.splice(i, 1));
  localStorage.setItem('compareList', JSON.stringify(state.compareList));
  refreshCards();
  renderCompare();
  showToast(`🗑️ ${cnt}개 상품이 삭제됐어요`);
}

/* ─────────────────────────────────────────
   📄 텍스트(.txt) 저장
   저장 내용: 상품코드 · 최저가 · 링크
───────────────────────────────────────── */
function exportSelectedText() {
  const targets = _getTargets();
  if (targets.length === 0) {
    showToast('⚠️ 비교 목록이 비어있어요');
    return;
  }

  const now  = new Date().toLocaleString('ko-KR');
  const BAR1 = '='.repeat(62);
  const BAR2 = '-'.repeat(62);
  const sel  = checkedIndexes.size > 0 ? `선택 ${checkedIndexes.size}개` : `전체 ${targets.length}개`;

  let txt = '';
  txt += `${BAR1}\n`;
  txt += `  싸카스포츠 가격비교 결과\n`;
  txt += `  저장일시 : ${now}\n`;
  txt += `  저장범위 : ${sel}\n`;
  txt += `${BAR1}\n\n`;

  targets.forEach((item, i) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '-');

    txt += `[${i + 1}] ${item.title || '(상품명 없음)'}\n`;
    txt += `${BAR2}\n`;
    txt += `  상품코드  : ${item.id || '-'}\n`;
    txt += `  브랜드    : ${item.brand || '-'}\n`;
    txt += `  카테고리  : ${item.category || '-'}\n`;
    txt += `  최저가    : ${(item.lprice || 0).toLocaleString()} 원\n`;
    txt += `  판매몰    : ${item.mall || '-'}\n`;
    txt += `  상품링크  : ${naverLink}\n`;

    /* 쇼핑몰별 가격 목록 */
    if (item.shops && item.shops.length > 0) {
      txt += `  ─ 쇼핑몰별 가격\n`;
      item.shops.forEach(shop => {
        const badge = shop.badge ? ` [${shop.badge}]` : '';
        txt += `    · ${shop.name}${badge} : ${(shop.price || 0).toLocaleString()} 원\n`;
        txt += `      링크 : ${shop.url || '-'}\n`;
      });
    }
    txt += '\n';
  });

  txt += `${BAR1}\n`;
  txt += `※ 싸카스포츠 가격비교 사이트 (네이버 쇼핑 API 연동)\n`;

  _downloadFile(txt, `싸카스포츠_가격비교_${_nowStr()}.txt`, 'text/plain;charset=utf-8');
  showToast(`📄 텍스트 저장 완료! (${targets.length}개 상품)`);
}

/* ─────────────────────────────────────────
   📊 엑셀(.csv) 저장
   저장 내용: 상품코드 · 최저가 · 링크 + 전체 필드
───────────────────────────────────────── */
function exportSelectedCSV() {
  const targets = _getTargets();
  if (targets.length === 0) {
    showToast('⚠️ 비교 목록이 비어있어요');
    return;
  }

  const BOM     = '\uFEFF';  // UTF-8 BOM – 엑셀 한글 깨짐 방지
  const headers = ['번호', '상품코드', '상품명', '브랜드', '카테고리',
                   '최저가(원)', '판매몰', '상품링크'];

  const q = (v) => `"${String(v || '').replace(/"/g, '""')}"`;  // CSV 안전 감싸기

  const rows = targets.map((item, i) => {
    const naverLink = (item.shops && item.shops[0])
      ? item.shops[0].url
      : (item.link || '');
    return [
      i + 1,
      q(item.id),
      q(item.title),
      q(item.brand),
      q(item.category),
      item.lprice || 0,
      q(item.mall),
      q(naverLink)
    ].join(',');
  });

  const csv = BOM + [headers.join(','), ...rows].join('\n');
  _downloadFile(csv, `싸카스포츠_가격비교_${_nowStr()}.csv`, 'text/csv;charset=utf-8');
  showToast(`📊 엑셀(CSV) 저장 완료! (${targets.length}개 상품)`);
}

/* ─────────────────────────────────────────
   하위 호환: 구 함수명 → 새 함수명 매핑
───────────────────────────────────────── */
function exportExcel()  { exportSelectedCSV(); }
function exportText()   { exportSelectedText(); }
function updateSelectedCount() { _updateSelCount(); }
function syncCheckAll()        { _syncCheckAllUI(); }

/* ─────────────────────────────────────────
   파일 다운로드 공통 헬퍼
───────────────────────────────────────── */
function _downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _nowStr() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`
       + `_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;
}

/* 하위호환 별칭 */
function getNowStr() { return _nowStr(); }
function downloadFile(c, f, m) { _downloadFile(c, f, m); }

/* ===== 유틸 ===== */
function findItemById(id) {
  // 1순위: 내부 레지스트리 (shops 완전 보존)
  const regItem = _getItem(id);
  if (regItem) return regItem;

  // 2순위: DOM 카드에서 직접 참조
  const grids = ['homeGrid', 'searchGrid', 'wishlistGrid'];
  for (const gid of grids) {
    const grid = document.getElementById(gid);
    if (grid) {
      const cards = grid.querySelectorAll('.product-card');
      for (const card of cards) {
        if (card._item && card._item.id === id) {
          _registerItem(card._item); // 레지스트리에 등록
          return card._item;
        }
      }
    }
  }
  // 3순위: wishlist/compare에서도 찾기
  let found = state.wishlist.find(w => w.id === id);
  if (found) return found;
  found = state.compareList.find(c => c.id === id);
  return found || null;
}

function refreshCards() {
  // 모든 카드 위시/비교 버튼 상태 갱신
  document.querySelectorAll('.product-card').forEach(card => {
    if (!card._item) return;
    const id = card._item.id;
    const isWished = state.wishlist.some(w => w.id === id);
    const isCompared = state.compareList.some(c => c.id === id);

    const wishBtn = card.querySelector('.card-action-btn:nth-child(1)');
    const compareBtn = card.querySelector('.card-action-btn:nth-child(2)');
    const compareFooterBtn = card.querySelector('.card-compare-btn');

    if (wishBtn) {
      wishBtn.textContent = isWished ? '❤️' : '🤍';
      wishBtn.classList.toggle('wishlisted', isWished);
    }
    if (compareBtn) {
      compareBtn.classList.toggle('wishlisted', isCompared);
    }
    if (compareFooterBtn) {
      compareFooterBtn.textContent = isCompared ? '✓ 비교중' : '+ 비교하기';
    }
  });
}

function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/* ===== 초기 로드 ===== */
window.addEventListener('DOMContentLoaded', () => {
  // localStorage에서 불러온 아이템을 registry에 등록
  state.wishlist.forEach(item => _registerItem(item));
  state.compareList.forEach(item => _registerItem(item));

  selectCategory('싸카닷컴 축구', document.querySelector('.tab-btn.active'));
});
