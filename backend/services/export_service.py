import io
import json
import csv
from database import get_connection
from models import ExportRequest


def export_data(req: ExportRequest):
    conn = get_connection()
    conditions = []
    params = []
    if req.media_type:
        conditions.append("media_type = ?")
        params.append(req.media_type)
    if req.mark_status:
        conditions.append("mark_status = ?")
        params.append(req.mark_status)
    where = " AND ".join(conditions) if conditions else "1=1"

    rows = conn.execute(f"SELECT * FROM media WHERE {where}", params).fetchall()
    conn.close()

    if req.format == "json":
        return _export_json(rows, req.fields)
    elif req.format == "csv":
        return _export_csv(rows, req.fields)
    else:
        return _export_xlsx(rows, req.fields)


def _export_json(rows, fields):
    data = [{k: dict(row).get(k, "") for k in fields} for row in rows]
    content = json.dumps(data, ensure_ascii=False, indent=2)
    stream = io.BytesIO(content.encode("utf-8"))
    return stream, "douarchive.json", "application/json"


def _export_csv(rows, fields):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: dict(row).get(k, "") for k in fields})
    stream = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return stream, "douarchive.csv", "text/csv"


def _export_xlsx(rows, fields):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "DouArchive"
    ws.append(fields)
    for row in rows:
        ws.append([dict(row).get(k, "") for k in fields])
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    return stream, "douarchive.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
