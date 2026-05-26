import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from database import get_connection, get_data_dir
from models import AIAnalyzeRequest

REPORTS_DIR = get_data_dir() / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


async def generate_report(req: AIAnalyzeRequest) -> dict:
    from services.crypto_service import get_config_value
    import httpx

    api_key = get_config_value("ai_api_key")
    base_url = get_config_value("ai_base_url") or "https://api.deepseek.com"
    model = req.model or get_config_value("ai_model") or "deepseek-v4-flash"
    max_tokens = int(get_config_value("ai_max_tokens") or "4096")

    # 获取用户数据作为上下文
    context = _build_context(req.media_type)
    prompt = _build_prompt(req, context)

    if not api_key:
        return {"error": "未配置 AI API 密钥，请在设置中配置"}

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是个人影音书偏好分析专家，基于用户的豆瓣数据进行深度分析。"},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": max_tokens,
                }
            )
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            tokens = data.get("usage", {}).get("total_tokens", 0)
    except Exception as e:
        return {"error": f"AI 请求失败: {str(e)}"}

    report_id = f"rpt_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    report = {
        "report_id": report_id,
        "content": content,
        "model": model,
        "tokens_used": tokens,
        "created_at": datetime.now().isoformat(),
    }

    # 保存报告
    report_path = REPORTS_DIR / f"{report_id}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    return report


def _build_context(media_type: Optional[str]) -> str:
    conn = get_connection()
    where = ""
    params = []
    if media_type:
        where = "WHERE media_type = ?"
        params.append(media_type)

    rows = conn.execute(f"""
        SELECT media_type, title, score, mark_status, mark_time, creator, tags, comment
        FROM media {where}
        ORDER BY mark_time DESC LIMIT 500
    """, params).fetchall()
    conn.close()

    lines = []
    for r in rows:
        line = f"[{r['media_type']}] {r['title']} | 评分:{r['score'] or '-'} | 状态:{r['mark_status']} | 时间:{r['mark_time'] or '-'} | 创作者:{r['creator'] or '-'} | 标签:{r['tags'] or '-'} | 短评:{r['comment'] or '-'}"
        lines.append(line)
    return "\n".join(lines)


def _build_prompt(req: AIAnalyzeRequest, context: str) -> str:
    type_name = {"movie": "电影", "book": "图书", "music": "音乐"}.get(req.media_type, "影音书")
    
    json_format = """
请必须以严格的 JSON 格式输出，不要包含任何 markdown 标记（如 ```json）。JSON 的结构必须如下：
{
  "personality": "简短的四个字或五个字的人格定义，例如：文艺片探索者",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "radar_data": {
    "维度1": 80,
    "维度2": 90,
    "维度3": 60,
    "维度4": 75,
    "维度5": 85
  },
  "summary": "一段约200字的深度总结，分析我的核心审美倾向。",
  "details": "一段约300字的详细分析，结合我具体看过的作品进行解读。",
  "recommendations": [
    {"title": "推荐作品1", "reason": "推荐理由1"},
    {"title": "推荐作品2", "reason": "推荐理由2"}
  ]
}
注意：radar_data 必须有且仅有5个维度（根据我的偏好动态生成维度名称，分数0-100）。
"""
    
    if req.prompt_type == "preference":
        return f"以下是我的豆瓣{type_name}标记数据，请深度分析我的个人偏好、审美倾向和消费习惯：\n\n{context}\n\n{json_format}"
    elif req.prompt_type == "recommend":
        return f"以下是我的豆瓣{type_name}标记数据，请根据我的偏好推荐一些我可能喜欢的作品：\n\n{context}\n\n{json_format}"
    else:
        return f"{req.custom_prompt}\n\n数据参考：\n{context}\n\n{json_format}"


def list_reports() -> list:
    reports = []
    for f in sorted(REPORTS_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            reports.append({
                "report_id": data["report_id"],
                "model": data["model"],
                "tokens_used": data.get("tokens_used", 0),
                "created_at": data["created_at"],
                "preview": data["content"][:200],
            })
        except Exception:
            continue
    return reports


def get_report(report_id: str) -> Optional[dict]:
    path = REPORTS_DIR / f"{report_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
