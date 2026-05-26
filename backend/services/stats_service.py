from database import get_connection


def get_overview() -> dict:
    conn = get_connection()
    result = {}
    for mtype in ("movie", "book", "music"):
        row = conn.execute(
            "SELECT COUNT(*) as total, "
            "SUM(CASE WHEN mark_status='wish' THEN 1 ELSE 0 END) as wish, "
            "SUM(CASE WHEN mark_status='do' THEN 1 ELSE 0 END) as do, "
            "SUM(CASE WHEN mark_status='collect' THEN 1 ELSE 0 END) as collect "
            "FROM media WHERE media_type=?", (mtype,)
        ).fetchone()
        result[mtype] = dict(row) if row else {"total": 0, "wish": 0, "do": 0, "collect": 0}
    conn.close()
    return result


def get_by_year(media_type=None) -> list:
    conn = get_connection()
    where = "WHERE mark_time IS NOT NULL"
    params = []
    if media_type:
        where += " AND media_type = ?"
        params.append(media_type)
    rows = conn.execute(f"""
        SELECT SUBSTR(mark_time, 1, 4) as year, COUNT(*) as count,
        ROUND(AVG(score), 2) as avg_score
        FROM media {where}
        GROUP BY SUBSTR(mark_time, 1, 4)
        ORDER BY year DESC
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_by_score(media_type=None) -> list:
    conn = get_connection()
    where = "WHERE score IS NOT NULL"
    params = []
    if media_type:
        where += " AND media_type = ?"
        params.append(media_type)
    rows = conn.execute(f"""
        SELECT CAST(score AS INTEGER) as score_level, COUNT(*) as count
        FROM media {where}
        GROUP BY CAST(score AS INTEGER)
        ORDER BY score_level
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_by_month(media_type=None) -> list:
    conn = get_connection()
    where = "WHERE mark_time IS NOT NULL"
    params = []
    if media_type:
        where += " AND media_type = ?"
        params.append(media_type)
    rows = conn.execute(f"""
        SELECT SUBSTR(mark_time, 1, 7) as month, COUNT(*) as count
        FROM media {where}
        GROUP BY SUBSTR(mark_time, 1, 7)
        ORDER BY month DESC
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_by_tag(media_type=None, limit=20) -> list:
    conn = get_connection()
    where = ""
    params = []
    if media_type:
        where = "WHERE t.media_type = ?"
        params.append(media_type)
    rows = conn.execute(f"""
        SELECT t.tag_name as tag, COUNT(*) as count
        FROM tag t
        {where}
        GROUP BY t.tag_name
        ORDER BY count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_by_creator(media_type=None, limit=20) -> list:
    """统计创作者排行，将 'A / B / C' 拆分为独立的 A、B、C 分别计数"""
    conn = get_connection()
    where = "WHERE creator != ''"
    params = []
    if media_type:
        where += " AND media_type = ?"
        params.append(media_type)

    # 先查出所有带创作者的条目
    rows = conn.execute(f"""
        SELECT creator, score FROM media {where}
    """, params).fetchall()
    conn.close()

    # Python 端拆分 ' / ' 并逐人统计
    from collections import defaultdict
    creator_stats = defaultdict(lambda: {"count": 0, "scores": []})
    for row in rows:
        raw = row["creator"]
        score = row["score"]
        # 按 ' / ' 拆分为独立创作者
        individuals = [c.strip() for c in raw.split(" / ") if c.strip()]
        for name in individuals:
            creator_stats[name]["count"] += 1
            if score is not None:
                creator_stats[name]["scores"].append(score)

    # 排序 + 限制数量
    sorted_creators = sorted(creator_stats.items(), key=lambda x: x[1]["count"], reverse=True)[:limit]
    result = []
    for name, info in sorted_creators:
        avg = round(sum(info["scores"]) / len(info["scores"]), 2) if info["scores"] else None
        result.append({"creator": name, "count": info["count"], "avg_score": avg})
    return result


def get_by_day(media_type=None, year=None) -> list:
    conn = get_connection()
    where = "WHERE mark_time IS NOT NULL AND length(mark_time) >= 10"
    params = []
    if media_type:
        where += " AND media_type = ?"
        params.append(media_type)
    if year:
        where += " AND SUBSTR(mark_time, 1, 4) = ?"
        params.append(str(year))
        
    rows = conn.execute(f"""
        SELECT SUBSTR(mark_time, 1, 10) as date, COUNT(*) as count
        FROM media {where}
        GROUP BY SUBSTR(mark_time, 1, 10)
        ORDER BY date ASC
    """, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]
