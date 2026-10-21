/**
 * Records Job Radar — Client App
 * 서울·경기 기록관리 채용 레이더 대시보드
 */

let allJobs = [];
let filteredJobs = [];
let currentRegion = "all";
let filterSpecialistOnly = false;
let includeClosed = false;
let currentSort = "dday-asc";
let searchQuery = "";

document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  loadJobsData();
});

function initEventListeners() {
  // 지역 탭
  const tabBtns = document.querySelectorAll("#region-tabs .tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRegion = btn.dataset.region;
      applyFilters();
    });
  });

  // 전문요원 체크박스
  const specChk = document.getElementById("filter-specialist");
  if (specChk) {
    specChk.addEventListener("change", (e) => {
      filterSpecialistOnly = e.target.checked;
      applyFilters();
    });
  }

  // 마감 공고 포함 체크박스
  const closedChk = document.getElementById("filter-include-closed");
  if (closedChk) {
    closedChk.addEventListener("change", (e) => {
      includeClosed = e.target.checked;
      applyFilters();
    });
  }

  // 검색창 (실시간 디바운스)
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    let timeout = null;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        searchQuery = e.target.value.trim().toLowerCase();
        applyFilters();
      }, 150);
    });
  }

  // 정렬 셀렉트
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      currentSort = e.target.value;
      applyFilters();
    });
  }
}

async function loadJobsData() {
  const grid = document.getElementById("job-grid");

  // 1. 로컬 file:// 열람 시 jobs.js 스크립트 전역 변수 우선 적용
  if (window.INITIAL_JOBS_DATA && window.INITIAL_JOBS_DATA.jobs) {
    allJobs = window.INITIAL_JOBS_DATA.jobs;
    updateHeaderStats(window.INITIAL_JOBS_DATA.meta || {});
    applyFilters();
    return;
  }

  // 2. HTTP/HTTPS 웹 서빙(GitHub Pages) 시 fetch() 적용
  try {
    const res = await fetch("data/jobs.json?t=" + Date.now());
    if (!res.ok) throw new Error("jobs.json 로드 실패");
    const data = await res.json();

    allJobs = data.jobs || [];
    updateHeaderStats(data.meta || {});
    applyFilters();
  } catch (err) {
    console.error(err);
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>공고 데이터를 불러오지 못했습니다.</h3>
          <p>새로고침을 하거나 잠시 후 다시 시도해주세요.</p>
        </div>
      `;
    }
  }
}

function updateHeaderStats(meta) {
  const elCollected = document.getElementById("collected-at");
  if (elCollected && meta.collected_at) {
    elCollected.textContent = meta.collected_at;
  }

  // 활성 공고(마감 제외) 기준 통계 계산
  const activeJobs = allJobs.filter(j => j.status !== "마감");
  const seoulJobs = activeJobs.filter(j => j.region === "서울");
  const gyeonggiJobs = activeJobs.filter(j => j.region === "경기");
  const specJobs = activeJobs.filter(j => j.is_specialist);
  const urgentJobs = activeJobs.filter(j => j.status === "오늘마감" || (j.dday && j.dday.includes("D-") && parseInt(j.dday.replace("D-", "")) <= 3));

  setText("stat-total", activeJobs.length);
  setText("stat-seoul", seoulJobs.length);
  setText("stat-gyeonggi", gyeonggiJobs.length);
  setText("stat-specialist", specJobs.length);
  setText("stat-urgent", urgentJobs.length);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function applyFilters() {
  filteredJobs = allJobs.filter(job => {
    // 1. 마감 공고 제외 여부
    if (!includeClosed && job.status === "마감") {
      return false;
    }

    // 2. 지역 필터
    if (currentRegion !== "all" && job.region !== currentRegion) {
      return false;
    }

    // 3. 기록물관리전문요원 필수 필터
    if (filterSpecialistOnly && !job.is_specialist) {
      return false;
    }

    // 4. 검색어 필터 (제목, 기관명, 직무)
    if (searchQuery) {
      const matchTitle = job.title.toLowerCase().includes(searchQuery);
      const matchOrg = job.organization.toLowerCase().includes(searchQuery);
      const matchLocation = (job.location || "").toLowerCase().includes(searchQuery);
      if (!matchTitle && !matchOrg && !matchLocation) {
        return false;
      }
    }

    return true;
  });

  // 정렬 적용
  sortJobs();
  renderGrid();
}

function sortJobs() {
  filteredJobs.sort((a, b) => {
    if (currentSort === "dday-asc") {
      // 오늘마감 > 접수중(D-Day 오름차순) > 접수예정 > 진행중 > 마감
      const order = { "오늘마감": 0, "접수중": 1, "접수예정": 2, "진행중": 3, "마감": 4 };
      const ordA = order[a.status] ?? 3;
      const ordB = order[b.status] ?? 3;
      if (ordA !== ordB) return ordA - ordB;

      // 마감일 기준 오름차순
      const deadA = a.deadline || "9999-99-99";
      const deadB = b.deadline || "9999-99-99";
      return deadA.localeCompare(deadB);
    } else if (currentSort === "deadline-desc") {
      const deadA = a.deadline || "0000-00-00";
      const deadB = b.deadline || "0000-00-00";
      return deadB.localeCompare(deadA);
    } else if (currentSort === "title-asc") {
      return a.title.localeCompare(b.title);
    }
    return 0;
  });
}

function renderGrid() {
  const grid = document.getElementById("job-grid");
  if (!grid) return;

  if (filteredJobs.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>조건에 맞는 채용공고가 없습니다.</h3>
        <p>필터 조건을 변경하거나 '마감된 공고 포함'을 체크해보세요.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredJobs.map(job => createCardHTML(job)).join("");
}

function createCardHTML(job) {
  const ddayBadge = `<span class="badge-dday ${job.badge_color || 'badge-primary'}">${job.dday || '진행중'}</span>`;
  const specTag = job.is_specialist ? `<span class="tag tag-specialist">전문요원 필수</span>` : "";
  const regionTag = `<span class="tag tag-region">${job.region || '수도권'}</span>`;
  const jobtypeTag = `<span class="tag tag-jobtype">${job.jobtype || '계약'}</span>`;

  let dateInfo = "접수일정: 원문 공고 참조";
  if (job.start_date && job.deadline) {
    dateInfo = `${job.start_date} ~ ${job.deadline}`;
  } else if (job.deadline) {
    dateInfo = `마감일: ${job.deadline}`;
  }

  return `
    <article class="job-card">
      <div class="job-card-header">
        ${ddayBadge}
        <span class="source-tag">${escapeHTML(job.source || '공고')}</span>
      </div>
      <h2 class="job-title">
        <a href="${job.url}" target="_blank" rel="noopener noreferrer">${escapeHTML(job.title)}</a>
      </h2>
      <div class="job-org">
        <span>🏢</span>
        <span>${escapeHTML(job.organization)}</span>
      </div>
      <div class="job-tags">
        ${regionTag}
        ${jobtypeTag}
        ${specTag}
      </div>
      <div class="job-dates">
        <span>📅 ${dateInfo}</span>
        <a href="${job.url}" target="_blank" rel="noopener noreferrer" class="btn-view">공고 보기</a>
      </div>
    </article>
  `;
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
