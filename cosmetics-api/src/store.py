import os
import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = os.environ.get(
    "COSMETICS_DB", str(Path(__file__).resolve().parent.parent / "cosmetics.sqlite")
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS customizations (
                player_id INTEGER PRIMARY KEY,
                head TEXT,
                face TEXT,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )"""
        )


def get(player_id: int) -> tuple[str | None, str | None]:
    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT head, face FROM customizations WHERE player_id = ?", (player_id,)
        ).fetchone()
    return (row["head"], row["face"]) if row else (None, None)


def save(player_id: int, head: str | None, face: str | None) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute(
            """INSERT INTO customizations (player_id, head, face) VALUES (?, ?, ?)
               ON CONFLICT (player_id) DO UPDATE SET
                 head = excluded.head,
                 face = excluded.face,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')""",
            (player_id, head, face),
        )
