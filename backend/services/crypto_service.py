from database import get_connection
from cryptography.fernet import Fernet
import hashlib
import base64


def _derive_key(master_password: str) -> bytes:
    key = hashlib.sha256(master_password.encode()).digest()
    return base64.urlsafe_b64encode(key)


def encrypt_value(value: str, master_password: str) -> str:
    key = _derive_key(master_password)
    return Fernet(key).encrypt(value.encode()).decode()


def decrypt_value(encrypted: str, master_password: str) -> str:
    key = _derive_key(master_password)
    return Fernet(key).decrypt(encrypted.encode()).decode()


def get_config_value(key: str) -> str:
    conn = get_connection()
    row = conn.execute("SELECT value, encrypted FROM config WHERE key = ?", (key,)).fetchone()
    conn.close()
    if not row:
        return ""
    # 既然没有实现主密码逻辑，这里直接返回 value（它实际上也是明文存储的）
    return row["value"]


def set_config_value(key: str, value: str, encrypted: bool = False, master_password: str = ""):
    conn = get_connection()
    store_value = encrypt_value(value, master_password) if encrypted and master_password else value
    conn.execute("""
        INSERT INTO config (key, value, encrypted, updated_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted,
        updated_at=excluded.updated_at
    """, (key, store_value, 1 if encrypted else 0))
    conn.commit()
    conn.close()


def get_all_config() -> dict:
    conn = get_connection()
    rows = conn.execute("SELECT key, value, encrypted FROM config").fetchall()
    conn.close()
    result = {}
    for row in rows:
        if row["encrypted"]:
            result[row["key"]] = "******" if row["value"] else ""
        else:
            result[row["key"]] = row["value"]
    return result


def update_config(data: dict):
    encrypted_keys = {"ai_api_key"}
    for key, value in data.items():
        if key in encrypted_keys and value == "******":
            continue  # 不要用占位符覆盖真实的密钥
        if key in encrypted_keys:
            set_config_value(key, value, encrypted=True)
        else:
            set_config_value(key, str(value))
