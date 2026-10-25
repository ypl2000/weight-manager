"""健康数据文件导入解析器(迭代1,全部标准库,无第三方依赖)。

三种来源,统一输出行结构(供 /api/import/preview 使用):
  {"at": "2026-10-20T23:30:00Z"(ISO8601 UTC), "metrics": {"weight": 77.7, ...}, "warnings": ["..."]}

  - generic_csv   通用 CSV/TSV:中英文列名同义词归一化匹配 + 时间格式自动识别链
  - apple_health  苹果健康 export.zip(内含 export.xml / 中文系统导出的 导出.xml),iterparse 流式解析
  - huawei_json   华为运动健康数据副本 JSON:递归找 type=10006 → samplePoints
                  → key=WEIGHT_BODYFAT_BROAD → value 为内嵌 JSON 字符串

口径约定(见 docs/research/body-fat-scale-csv-formats.md):
  - 体脂率 0<x≤1 视为小数口径,×100 转百分比并记 warning
  - 数值超合理范围丢弃:体重 20-400kg、体脂率 2-80%、腰围/臀围 30-200cm、内脏脂肪 1-50
  - 无时区的时间默认按 UTC+8 解析
  - 预览行数上限 MAX_ROWS=5000,超出部分计入 skipped
"""
import csv
import datetime as dt
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET

MAX_ROWS = 5000
TZ8 = dt.timezone(dt.timedelta(hours=8))

# 数值合理范围(超范围丢弃并计入 skipped)
RANGES = {
    "weight": (20.0, 400.0),
    "bodyfat": (2.0, 80.0),
    "waist": (30.0, 200.0),
    "hip": (30.0, 200.0),
    "visceral": (1.0, 50.0),
}


# ---------- 列名归一化(全半角 / 下划线 / 单位后缀) ----------

_FULLWIDTH = {ord("　"): " ", ord("（"): "(", ord("）"): ")", ord("％"): "%",
              ord("："): ":", ord("，"): ",", ord("／"): "/"}

# 注意:长后缀在前,避免 "公斤" 被 "斤" 截断
_UNIT_SUFFIXES = ("公斤", "千克", "percentage", "percent", "pct", "rate", "kg", "cm", "斤", "%")

COLUMN_SYNONYMS = {
    "weight": {"weight", "体重", "重量", "bodyweight", "bodymass", "mass", "bw"},
    "bodyfat": {"bodyfat", "fat", "体脂", "体脂率", "体脂肪", "体脂肪率", "脂肪率", "pbf", "bfr"},
    "waist": {"waist", "腰围", "waistcircumference"},
    "hip": {"hip", "臀围", "hipcircumference"},
    "visceral": {"visceralfat", "visceral", "内脏脂肪", "内脏指数", "内脂"},
}

DATE_SYNONYMS = {"date", "datetime", "time", "timestamp", "at", "startdate",
                 "日期", "时间", "日期时间", "时间戳", "测量时间", "记录时间",
                 "测量日期", "记录日期"}


def norm_col(name):
    """列名归一化:'体脂率/%'→'体脂率','weight_kg'→'weight','BodyFatRate'→'bodyfat'。"""
    s = str(name or "").strip().lower().translate(_FULLWIDTH)
    s = re.sub(r"[\s_\-()/]+", "", s)
    while s:
        before = s
        for suf in _UNIT_SUFFIXES:
            if s.endswith(suf) and len(s) > len(suf):
                s = s[: -len(suf)]
                break
        if before == s:
            break
    return s


# ---------- 时间解析(自动识别链) ----------

_STRPTIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S%z",  # 苹果健康:'2026-10-25 07:30:00 +0800'
    "%Y-%m-%d %H:%M%z",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
    "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d",  # 中文 Excel 手工整理常见
)


def parse_datetime(value):
    """把各种时间表示解析为带时区 datetime;失败抛 ValueError。无时区默认 UTC+8。"""
    if value is None:
        raise ValueError("时间为空")
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=TZ8)
    s = str(value).strip().strip('"').strip("'").strip()
    if not s:
        raise ValueError("时间为空")
    if re.fullmatch(r"\d{13}", s):  # Unix 毫秒(华为)
        return dt.datetime.fromtimestamp(int(s) / 1000, tz=dt.timezone.utc)
    if re.fullmatch(r"\d{10}", s):  # Unix 秒
        return dt.datetime.fromtimestamp(int(s), tz=dt.timezone.utc)
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00").replace("z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=TZ8)
    except ValueError:
        pass
    for fmt in _STRPTIME_FORMATS:
        try:
            d = dt.datetime.strptime(s, fmt)
            return d if d.tzinfo else d.replace(tzinfo=TZ8)
        except ValueError:
            continue
    raise ValueError(f"无法识别的时间:{s}")


def to_iso_utc(d):
    return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- 数值归一化 ----------

def _to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^0-9.+\-eE]", "", str(v).strip())  # 去掉单位残留如 '77.7kg'
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _make_metrics(raw_by_code):
    """原始值 → 归一化 metrics。返回 (metrics, warnings, dropped_count)。"""
    metrics, warnings, dropped = {}, [], 0
    for code, raw in raw_by_code.items():
        f = _to_float(raw)
        if f is None:
            continue
        if code == "bodyfat" and 0 < f <= 1:  # 小数口径 → 百分比
            warnings.append(f"体脂率 {f:g} 为小数口径,已×100 转为百分比")
            f *= 100
        lo, hi = RANGES.get(code, (float("-inf"), float("inf")))
        if not lo <= f <= hi:
            warnings.append(f"{code}={f:g} 超出合理范围({lo:g}~{hi:g}),已跳过")
            dropped += 1
            continue
        metrics[code] = round(f, 2)
    return metrics, warnings, dropped


def _new_row(at_iso, metrics, warnings):
    return {"at": at_iso, "metrics": metrics, "warnings": warnings}


# ---------- 格式探测(文件名 + 魔数) ----------

def _zip_name_variants(name):
    """zip 内中文名可能是 cp437 乱码,尝试还原为 utf-8/gbk。"""
    out = {name}
    try:
        raw = name.encode("cp437")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return out
    for enc in ("utf-8", "gbk"):
        try:
            out.add(raw.decode(enc))
        except UnicodeDecodeError:
            pass
    return out


def _zip_names(raw):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            return [(info.filename, _zip_name_variants(info.filename)) for info in zf.infolist()]
    except zipfile.BadZipFile as e:
        raise ValueError(f"ZIP 文件损坏:{e}")


def detect_format(raw, filename):
    name = (filename or "").strip().lower()
    if raw[:2] == b"PK":  # zip 魔数
        flat = {v.lower() for _, vs in _zip_names(raw) for v in vs}
        if any(v == "export.xml" or v.endswith("/export.xml")
               or v == "导出.xml" or v.endswith("/导出.xml") for v in flat):
            return "apple_health"
        if any(v.endswith(".json") for v in flat):
            return "huawei_json"
        if any(v.endswith(".csv") or v.endswith(".txt") for v in flat):
            return "csv"
        raise ValueError("ZIP 内没有可识别的数据文件(需要 export.xml/导出.xml、.json 或 .csv)")
    head = raw[:64].lstrip()
    if name.endswith(".json") or head[:1] in (b"{", b"["):
        return "huawei_json"
    if name.endswith(".xml") or head.startswith(b"<?xml"):
        return "apple_health"
    return "csv"


# ---------- 通用 CSV/TSV ----------

def _decode_text(raw):
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return raw.decode("gbk")
        except UnicodeDecodeError:
            raise ValueError("文件编码无法识别,请另存为 UTF-8 或 GBK")


def parse_csv(raw, filename):
    if raw[:2] == b"PK":  # zip 里套 csv:取第一个 .csv/.txt 成员
        members = _zip_names(raw)
        target = next((n for n, vs in members
                       if any(v.lower().endswith((".csv", ".txt")) for v in vs)), None)
        if not target:
            raise ValueError("ZIP 内没有 .csv 文件")
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            raw = zf.read(target)
    text = _decode_text(raw)
    lines = text.splitlines()
    if not lines or not lines[0].strip():
        raise ValueError("CSV 为空或缺少表头")
    delim = "\t" if lines[0].count("\t") > lines[0].count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    if not reader.fieldnames:
        raise ValueError("CSV 为空或缺少表头")

    date_col, col_map, mapped = None, {}, {}
    for field in reader.fieldnames:
        n = norm_col(field)
        if not n:
            continue
        if n in DATE_SYNONYMS:
            if date_col is None:
                date_col = field
            continue
        code = next((c for c, syns in COLUMN_SYNONYMS.items() if n in syns), None)
        if code and code not in col_map.values():
            col_map[field] = code
            mapped[field] = code
    if date_col is None:
        raise ValueError("未识别到时间列(支持:时间/日期/date/time/timestamp 等)")
    if not mapped:
        raise ValueError("未识别到可导入的数值列(支持:体重/体脂率/腰围/臀围/内脏脂肪)")

    rows, skipped, overflow = [], 0, 0
    for row in reader:
        try:
            at_iso = to_iso_utc(parse_datetime(row.get(date_col)))
        except ValueError:
            skipped += 1  # 时间解析不了的整行丢弃
            continue
        raw_by_code = {code: row.get(field) for field, code in col_map.items()}
        metrics, warnings, dropped = _make_metrics(raw_by_code)
        skipped += dropped
        if not metrics:
            skipped += 1
            continue
        if len(rows) >= MAX_ROWS:
            overflow += 1
            continue
        rows.append(_new_row(at_iso, metrics, warnings))
    return rows, skipped + overflow, mapped


# ---------- 苹果健康 export.zip ----------

_RECORD_TYPES = {
    "HKQuantityTypeIdentifierBodyMass": "weight",
    "HKQuantityTypeIdentifierBodyFatPercentage": "bodyfat",
    "HKQuantityTypeIdentifierWaistCircumference": "waist",
}


def parse_apple(raw, filename):
    zf = None
    if raw[:2] == b"PK":
        target = None
        for n, vs in _zip_names(raw):
            if any(v.lower().rsplit("/", 1)[-1] in ("export.xml", "导出.xml") for v in vs):
                target = n
                break
        if not target:
            raise ValueError("ZIP 内没有 export.xml / 导出.xml")
        zf = zipfile.ZipFile(io.BytesIO(raw))
        fh = zf.open(target)
    else:
        fh = io.BytesIO(raw)
    try:
        return _parse_apple_stream(fh)
    except RuntimeError:
        raise ValueError("ZIP 已加密,请先解压后再上传 export.xml")
    finally:
        if zf:
            zf.close()


def _parse_apple_stream(fh):
    rows, skipped, mapped, overflow = [], 0, {}, 0
    context = ET.iterparse(fh, events=("start", "end"))
    _, root = next(context, (None, None))
    if root is None:
        raise ValueError("XML 为空")
    for event, elem in context:
        if event != "end" or elem.tag != "Record":
            continue
        try:
            htype = elem.get("type") or ""
            code = _RECORD_TYPES.get(htype)
            if code:
                mapped.setdefault(htype, code)
                at_iso = to_iso_utc(parse_datetime(elem.get("startDate")))
                metrics, warnings, dropped = _make_metrics({code: elem.get("value")})
                skipped += dropped
                if metrics:
                    if len(rows) >= MAX_ROWS:
                        overflow += 1
                    else:
                        rows.append(_new_row(at_iso, metrics, warnings))
        except ValueError:
            skipped += 1  # 时间或数值解析不了的记录
        finally:
            elem.clear()
            root.clear()  # 丢弃已处理节点,防止大文件占内存
    return rows, skipped + overflow, mapped


# ---------- 华为运动健康 JSON ----------

def parse_huawei(raw, filename):
    payloads = []
    if raw[:2] == b"PK":
        json_members = [n for n, vs in _zip_names(raw)
                        if any(v.lower().endswith(".json") for v in vs)]
        if not json_members:
            raise ValueError("ZIP 内没有 .json 文件")
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                for m in json_members:
                    payloads.append(zf.read(m))
        except RuntimeError:
            raise ValueError("ZIP 已加密(华为数据副本默认加密),请先解压出 .json 再上传")
    else:
        payloads.append(raw)

    rows, skipped, overflow = [], 0, 0
    mapped = {"bodyWeight": "weight", "bodyFatRate": "bodyfat"}
    for payload in payloads:
        try:
            data = json.loads(_decode_text(payload))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError(f"JSON 解析失败:{e}")
        for point in _iter_huawei_points(data):
            row, dropped = _huawei_row(point)
            skipped += dropped
            if row:
                if len(rows) >= MAX_ROWS:
                    overflow += 1
                else:
                    rows.append(row)
    return rows, skipped + overflow, mapped


def _iter_huawei_points(node):
    """深度优先遍历,产出 type=10006 节点下 key=WEIGHT_BODYFAT_BROAD 的采样点。"""
    if isinstance(node, dict):
        if str(node.get("type")) == "10006" and isinstance(node.get("samplePoints"), list):
            for p in node["samplePoints"]:
                if isinstance(p, dict) and p.get("key") == "WEIGHT_BODYFAT_BROAD":
                    yield p
            return
        for v in node.values():
            yield from _iter_huawei_points(v)
    elif isinstance(node, list):
        for v in node:
            yield from _iter_huawei_points(v)


def _huawei_row(point):
    """一个采样点 → 一行;返回 (row_or_None, dropped_count)。"""
    inner = point.get("value")
    try:
        body = json.loads(inner) if isinstance(inner, str) else inner
    except json.JSONDecodeError:
        return None, 1
    if not isinstance(body, dict):
        body = {}
    try:
        at_iso = to_iso_utc(parse_datetime(point.get("startTime", body.get("startTime"))))
    except ValueError:
        return None, 1
    metrics, warnings, dropped = _make_metrics(
        {"weight": body.get("bodyWeight"), "bodyfat": body.get("bodyFatRate")})
    if not metrics:
        return None, dropped + 1
    return _new_row(at_iso, metrics, warnings), dropped


# ---------- 入口 ----------

def preview(raw, filename):
    """解析文件,返回 /api/import/preview 的响应体。解析失败抛 ValueError(→ 400)。"""
    fmt = detect_format(raw, filename)
    if fmt == "apple_health":
        rows, skipped, mapped = parse_apple(raw, filename)
    elif fmt == "huawei_json":
        rows, skipped, mapped = parse_huawei(raw, filename)
    else:
        rows, skipped, mapped = parse_csv(raw, filename)
    rows.sort(key=lambda r: r["at"])
    return {"format": fmt, "total": len(rows), "rows": rows,
            "skipped": skipped, "mapped_columns": mapped, "error": None}
