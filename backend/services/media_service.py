import sqlite3
from typing import List, Optional
from database import get_connection
from models import MediaItem


def sync_items(items: List[MediaItem]) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    created = updated = skipped = 0

    for item in items:
        existing = cursor.execute(
            "SELECT id FROM media WHERE douban_id = ? AND media_type = ?",
            (item.douban_id, item.media_type)
        ).fetchone()

        tags_str = ",".join(item.tags) if item.tags else ""

        if existing:
            cursor.execute("""
                UPDATE media SET title=?, alt_title=?, score=?, mark_status=?,
                mark_time=?, creator=?, comment=?, tags=?, douban_url=?,
                cover=?, intro_raw=?, updated_at=datetime('now','localtime')
                WHERE douban_id=? AND media_type=?
            """, (item.title, item.alt_title, item.score, item.mark_status,
                  item.mark_time, item.creator, item.comment, tags_str,
                  item.douban_url, item.cover, item.intro_raw,
                  item.douban_id, item.media_type))
            _sync_tags(cursor, existing["id"], item.tags, item.media_type)
            updated += 1
        else:
            cursor.execute("""
                INSERT INTO media (douban_id, media_type, title, alt_title, score,
                mark_status, mark_time, creator, comment, tags, douban_url, cover, intro_raw)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (item.douban_id, item.media_type, item.title, item.alt_title,
                  item.score, item.mark_status, item.mark_time, item.creator,
                  item.comment, tags_str, item.douban_url, item.cover, item.intro_raw))
            media_id = cursor.lastrowid
            _sync_tags(cursor, media_id, item.tags, item.media_type)
            created += 1

    conn.commit()
    conn.close()
    return {"total": len(items), "created": created, "updated": updated, "skipped": skipped}


def _sync_tags(cursor, media_id: int, tags: list, media_type: str):
    cursor.execute("DELETE FROM tag WHERE media_id = ?", (media_id,))
    for tag_name in tags:
        tag_name = tag_name.strip()
        if tag_name:
            cursor.execute(
                "INSERT OR IGNORE INTO tag (media_id, tag_name, media_type) VALUES (?,?,?)",
                (media_id, tag_name, media_type)
            )


def query_media(**kwargs) -> dict:
    conn = get_connection()
    conditions = []
    params = []

    if kwargs.get("media_type"):
        conditions.append("m.media_type = ?")
        params.append(kwargs["media_type"])
    if kwargs.get("mark_status"):
        conditions.append("m.mark_status = ?")
        params.append(kwargs["mark_status"])
    if kwargs.get("score_min") is not None:
        conditions.append("m.score >= ?")
        params.append(kwargs["score_min"])
    if kwargs.get("score_max") is not None:
        conditions.append("m.score <= ?")
        params.append(kwargs["score_max"])
    if kwargs.get("keyword"):
        kw = f"%{kwargs['keyword']}%"
        conditions.append("(m.title LIKE ? OR m.creator LIKE ? OR m.alt_title LIKE ?)")
        params.extend([kw, kw, kw])
    if kwargs.get("tag"):
        conditions.append("EXISTS (SELECT 1 FROM tag t WHERE t.media_id = m.id AND t.tag_name = ?)")
        params.append(kwargs["tag"])

    where = " AND ".join(conditions) if conditions else "1=1"
    sort_field = kwargs.get("sort", "mark_time")
    order = kwargs.get("order", "desc")
    valid_sorts = {"mark_time": "m.mark_time", "score": "m.score", "title": "m.title"}
    sort_col = valid_sorts.get(sort_field, "m.mark_time")

    page = kwargs.get("page", 1)
    page_size = kwargs.get("page_size", 30)
    offset = (page - 1) * page_size

    count_sql = f"SELECT COUNT(*) FROM media m WHERE {where}"
    total = conn.execute(count_sql, params).fetchone()[0]

    data_sql = f"""
        SELECT m.*, GROUP_CONCAT(t.tag_name) as tag_list
        FROM media m
        LEFT JOIN tag t ON t.media_id = m.id
        WHERE {where}
        GROUP BY m.id
        ORDER BY {sort_col} {order}
        LIMIT ? OFFSET ?
    """
    rows = conn.execute(data_sql, params + [page_size, offset]).fetchall()

    items = []
    for row in rows:
        item = dict(row)
        item["tags"] = [t for t in (item.get("tag_list") or "").split(",") if t]
        item.pop("tag_list", None)
        items.append(item)

    conn.close()
    return {"total": total, "page": page, "page_size": page_size, "items": items}


def get_item(item_id: int) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM media WHERE id = ?", (item_id,)).fetchone()
    if not row:
        conn.close()
        return None
    item = dict(row)
    tags = conn.execute("SELECT tag_name FROM tag WHERE media_id = ?", (item_id,)).fetchall()
    item["tags"] = [t["tag_name"] for t in tags]
    conn.close()
    return item


def update_item(item_id: int, data: dict) -> bool:
    conn = get_connection()
    allowed = {"title", "alt_title", "score", "mark_status", "mark_time",
               "creator", "comment", "douban_url", "cover", "intro_raw"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        conn.close()
        return False
    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [item_id]
    cursor = conn.execute(
        f"UPDATE media SET {sets}, updated_at=datetime('now','localtime') WHERE id=?",
        vals
    )
    if "tags" in data:
        _sync_tags(cursor, item_id, data["tags"],
                   conn.execute("SELECT media_type FROM media WHERE id=?", (item_id,)).fetchone()[0])
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def delete_item(item_id: int) -> bool:
    conn = get_connection()
    cursor = conn.execute("DELETE FROM media WHERE id = ?", (item_id,))
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def delete_by_douban_id(douban_id: str, media_type: str) -> bool:
    """通过豆瓣 ID + 媒体类型删除条目"""
    conn = get_connection()
    cursor = conn.execute(
        "DELETE FROM media WHERE douban_id = ? AND media_type = ?",
        (douban_id, media_type)
    )
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def batch_delete(data: dict) -> dict:
    """批量删除，支持两种模式：
    - {"ids": [1, 2, 3]}：按内部 ID 删除
    - {"douban_ids": [{"douban_id": "xxx", "media_type": "movie"}, ...]}：按豆瓣 ID 删除
    """
    conn = get_connection()
    deleted = 0

    if "ids" in data:
        for item_id in data["ids"]:
            cursor = conn.execute("DELETE FROM media WHERE id = ?", (item_id,))
            deleted += cursor.rowcount
    elif "douban_ids" in data:
        for entry in data["douban_ids"]:
            did = entry.get("douban_id")
            mtype = entry.get("media_type")
            if did and mtype:
                cursor = conn.execute(
                    "DELETE FROM media WHERE douban_id = ? AND media_type = ?",
                    (did, mtype)
                )
                deleted += cursor.rowcount

    conn.commit()
    conn.close()
    return {"deleted": deleted}

