import sqlite3
import sys
from pathlib import Path


def get_data_dir() -> Path:
    """获取数据目录：打包后为 ~/.douarchive/，开发环境为 ./data/"""
    if getattr(sys, 'frozen', False):
        p = Path.home() / ".douarchive"
    else:
        p = Path(__file__).parent / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p


DB_PATH = get_data_dir() / "douarchive.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS media (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        douban_id     TEXT    NOT NULL,
        media_type    TEXT    NOT NULL,
        title         TEXT    NOT NULL DEFAULT '',
        alt_title     TEXT    DEFAULT '',
        score         REAL,
        mark_status   TEXT    NOT NULL,
        mark_time     TEXT,
        creator       TEXT    DEFAULT '',
        comment       TEXT    DEFAULT '',
        tags          TEXT    DEFAULT '',
        douban_url    TEXT    NOT NULL,
        cover         TEXT    DEFAULT '',
        intro_raw     TEXT    DEFAULT '',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        UNIQUE(douban_id, media_type)
    );

    CREATE INDEX IF NOT EXISTS idx_media_type       ON media(media_type);
    CREATE INDEX IF NOT EXISTS idx_media_status     ON media(mark_status);
    CREATE INDEX IF NOT EXISTS idx_media_score      ON media(score);
    CREATE INDEX IF NOT EXISTS idx_media_mark_time  ON media(mark_time);

    CREATE TABLE IF NOT EXISTS tag (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id      INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_name      TEXT    NOT NULL,
        media_type    TEXT    NOT NULL,
        UNIQUE(media_id, tag_name)
    );

    CREATE INDEX IF NOT EXISTS idx_tag_name      ON tag(tag_name);
    CREATE INDEX IF NOT EXISTS idx_tag_media_id  ON tag(media_id);
    CREATE INDEX IF NOT EXISTS idx_tag_type      ON tag(media_type);

    CREATE TABLE IF NOT EXISTS config (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL,
        encrypted     INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    """)

    conn.commit()
    conn.close()
