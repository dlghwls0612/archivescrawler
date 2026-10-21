"""main.py — 서울·경기 기록관리 채용 레이더 메인 오케스트레이터."""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import yaml

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from . import karma
from . import alio
from . import saramin
from . import classify

ROOT = Path(__file__).resolve().parent.parent
SOURCES_FILE = ROOT / "sources.yaml"
OUT_FILE = ROOT / "docs" / "data" / "jobs.json"
KST = timezone(timedelta(hours=9))


def load_config():
    with open(SOURCES_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def now_str():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def deduplicate_jobs(raw_jobs):
    """제목 및 기관명이 중복되는 공고를 1건으로 통합 (KARMA > 잡알리오 > 사람인 우선순위)."""
    unique_jobs = []
    seen_keys = set()

    # 우선순위: KARMA(협회 공식) > 잡알리오(공공기관) > 사람인(민간/재단)
    source_priority = {"한국기록전문가협회": 1, "잡알리오": 2, "사람인": 3}
    sorted_raw = sorted(raw_jobs, key=lambda x: source_priority.get(x.get("source"), 99))

    for job in sorted_raw:
        # 정규화된 키 생성 (공백 제거, 특수문자 제거)
        norm_title = "".join(c for c in job["title"] if c.isalnum())[:25]
        norm_org = "".join(c for c in job["organization"] if c.isalnum())[:10]
        key = f"{norm_org}:{norm_title}"

        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique_jobs.append(job)

    return unique_jobs


def sort_jobs(jobs):
    """마감임박순(D-0, D-1, ...) -> 마감일 미지정/접수예정순 정렬."""
    def sort_key(j):
        deadline = j.get("deadline")
        status = j.get("status")
        # 오늘마감, 접수중 최우선
        if status == "오늘마감":
            return (0, deadline or "9999-99-99")
        elif status == "접수중":
            return (1, deadline or "9999-99-99")
        elif status == "접수예정":
            return (2, deadline or "9999-99-99")
        elif status == "진행중":
            return (3, deadline or "9999-99-99")
        else:
            return (4, deadline or "9999-99-99")

    return sorted(jobs, key=sort_key)


def run_crawl(cfg):
    settings = cfg.get("settings", {})
    all_jobs = []

    print("\n" + "=" * 50)
    print("  [기록관리 채용 레이더] 서울·경기 공고 수집 시작")
    print("=" * 50)

    # 1. 한국기록전문가협회 (KARMA) 수집
    print("\n[1/3] 한국기록전문가협회(KARMA) 수집 중...")
    try:
        karma_jobs = karma.crawl_karma(settings, max_pages=3)
        print(f"      -> {len(karma_jobs)}건 유효 공고 수집 완료")
        all_jobs.extend(karma_jobs)
    except Exception as e:
        print(f"      [오류] KARMA 수집 실패: {e}")

    # 2. 잡알리오(ALIO) 수집
    print("\n[2/3] 잡알리오(ALIO) 공공기관 채용 수집 중...")
    try:
        alio_jobs = alio.crawl_alio(settings)
        print(f"      -> {len(alio_jobs)}건 유효 공고 수집 완료")
        all_jobs.extend(alio_jobs)
    except Exception as e:
        print(f"      [오류] 잡알리오 수집 실패: {e}")

    # 3. 사람인(Saramin) 수집
    print("\n[3/3] 사람인(Saramin) 서울·경기 기록관리 채용 수집 중...")
    try:
        saramin_jobs = saramin.crawl_saramin(settings)
        print(f"      -> {len(saramin_jobs)}건 유효 공고 수집 완료")
        all_jobs.extend(saramin_jobs)
    except Exception as e:
        print(f"      [오류] 사람인 수집 실패: {e}")

    # 중복 제거 및 정렬
    unique = deduplicate_jobs(all_jobs)
    final_jobs = sort_jobs(unique)

    # 통계 계산
    by_source = {}
    by_region = {"서울": 0, "경기": 0}
    by_jobtype = {}
    specialist_cnt = 0

    for j in final_jobs:
        by_source[j["source"]] = by_source.get(j["source"], 0) + 1
        reg = j.get("region")
        if reg in by_region:
            by_region[reg] += 1
        jt = j.get("jobtype")
        by_jobtype[jt] = by_jobtype.get(jt, 0) + 1
        if j.get("is_specialist"):
            specialist_cnt += 1

    # jobs.json 작성
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "project": cfg.get("meta", {}).get("project", "기록관리 채용 레이더"),
            "collected_at": now_str(),
            "job_count": len(final_jobs),
            "stats": {
                "by_source": by_source,
                "by_region": by_region,
                "by_jobtype": by_jobtype,
                "specialist_required_count": specialist_cnt,
            }
        },
        "jobs": final_jobs,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    # 로컬 탐색기 더블클릭(file:// CORS 차단 방지용) JS 폴백 파일 생성
    js_out = OUT_FILE.parent / "jobs.js"
    with open(js_out, "w", encoding="utf-8") as f:
        f.write(f"window.INITIAL_JOBS_DATA = {json.dumps(payload, ensure_ascii=False, indent=2)};\n")

    print("\n" + "=" * 50)
    print(f"  [수집 완료] 총 {len(final_jobs)}건의 활성 공고 저장")
    print(f"  저장 위치: {OUT_FILE}")
    print(f"  출처별: {by_source}")
    print(f"  지역별: {by_region}")
    print(f"  전문요원 필수 공고: {specialist_cnt}건")
    print("=" * 50 + "\n")

    return final_jobs


def main():
    parser = argparse.ArgumentParser(description="기록관리 채용 레이더 수집기")
    parser.add_argument("--crawl", action="store_true", help="전체 수집 실행")
    args = parser.parse_args()

    cfg = load_config()

    if args.crawl or len(sys.argv) == 1:
        run_crawl(cfg)


if __name__ == "__main__":
    main()
