#!/usr/bin/env python3
"""Import a complete Seoul commercial-area snapshot from official HTTPS sheets.

The Seoul Open Data Plaza exposes the sales, footfall and area directories as
keyless HTTPS Sheet CSV downloads.  This importer deliberately does not use
the credentialed HTTP Open API: no provider key is read, transmitted or
logged.
"""

from __future__ import annotations

import argparse
import csv
import email.message
import hashlib
import io
import json
import math
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import BinaryIO, Mapping


SOURCE_ID = "seoul-commercial"
IMPORT_PATH = "/api/public-data/import/seoul-commercial"
SHEET_DOWNLOAD_URL = (
    "https://datafile.seoul.go.kr/bigfile/iot/sheet/csv/download.do"
)
SHEET_HOST = "datafile.seoul.go.kr"
SOURCE_URLS = {
    "sales": "https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do",
    "footfall": "https://data.seoul.go.kr/dataList/OA-15568/S/1/datasetView.do",
    "area": "https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do",
}
HOURS = (0, 6, 11, 14, 17, 21)
SALES_HOUR_FIELDS = (
    "시간대_00~06_매출_금액",
    "시간대_06~11_매출_금액",
    "시간대_11~14_매출_금액",
    "시간대_14~17_매출_금액",
    "시간대_17~21_매출_금액",
    "시간대_21~24_매출_금액",
)
FOOTFALL_HOUR_FIELDS = (
    "시간대_00_06_유동인구_수",
    "시간대_06_11_유동인구_수",
    "시간대_11_14_유동인구_수",
    "시간대_14_17_유동인구_수",
    "시간대_17_21_유동인구_수",
    "시간대_21_24_유동인구_수",
)
SAFE_INTEGER_MAX = 9_007_199_254_740_991
MAX_IMPORT_BODY_BYTES = 8_000_000
MAX_JSON_RESPONSE_BYTES = 64_000


@dataclass(frozen=True)
class SheetDefinition:
    key: str
    inf_id: str
    minimum_bytes: int
    maximum_bytes: int
    maximum_rows: int
    required_headers: frozenset[str]


COMMON_HEADERS = frozenset({
    "상권_구분_코드_명",
    "상권_코드",
    "상권_코드_명",
})
SHEETS = {
    "sales": SheetDefinition(
        key="sales",
        inf_id="OA-15572",
        minimum_bytes=10_000,
        maximum_bytes=96_000_000,
        maximum_rows=250_000,
        required_headers=COMMON_HEADERS | frozenset({
            "기준_년분기_코드",
            "서비스_업종_코드",
            "서비스_업종_코드_명",
            "당월_매출_금액",
            *SALES_HOUR_FIELDS,
        }),
    ),
    "footfall": SheetDefinition(
        key="footfall",
        inf_id="OA-15568",
        minimum_bytes=10_000,
        maximum_bytes=32_000_000,
        maximum_rows=100_000,
        required_headers=COMMON_HEADERS | frozenset({
            "기준_년분기_코드",
            "총_유동인구_수",
            *FOOTFALL_HOUR_FIELDS,
        }),
    ),
    "area": SheetDefinition(
        key="area",
        inf_id="OA-15560",
        minimum_bytes=1_000,
        maximum_bytes=8_000_000,
        maximum_rows=5_000,
        required_headers=COMMON_HEADERS | frozenset({
            "자치구_코드_명",
            "행정동_코드_명",
            "영역_면적",
        }),
    ),
}


@dataclass(frozen=True)
class DownloadedSheet:
    definition: SheetDefinition
    content: bytes


@dataclass(frozen=True)
class CoveragePolicy:
    minimum_area_count: int = 1_500
    minimum_sales_ratio: float = 0.90
    minimum_footfall_ratio: float = 0.95
    maximum_area_count: int = 2_000


DEFAULT_COVERAGE_POLICY = CoveragePolicy()


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Reject redirects before a secret or form body can be forwarded."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise RuntimeError("seoul_redirect_not_allowed")


def default_opener() -> urllib.request.OpenerDirector:
    context = ssl.create_default_context()
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context),
        NoRedirectHandler(),
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def import_endpoint(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path != IMPORT_PATH
    ):
        raise RuntimeError("seoul_import_endpoint_invalid")
    host = (parsed.hostname or "").lower()
    if parsed.scheme == "http":
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("seoul_import_endpoint_invalid")
    elif parsed.scheme != "https" or not host:
        raise RuntimeError("seoul_import_endpoint_invalid")
    return urllib.parse.urlunsplit(parsed)


def same_endpoint(expected: str, actual: str) -> bool:
    left = urllib.parse.urlsplit(expected)
    right = urllib.parse.urlsplit(actual)
    left_port = left.port or (443 if left.scheme == "https" else 80)
    right_port = right.port or (443 if right.scheme == "https" else 80)
    return (
        left.scheme.lower() == right.scheme.lower()
        and (left.hostname or "").lower() == (right.hostname or "").lower()
        and left_port == right_port
        and left.path == right.path
        and not right.query
        and not right.fragment
    )


def response_status(response: object) -> int:
    value = getattr(response, "status", None)
    if value is None and hasattr(response, "getcode"):
        value = response.getcode()
    return int(value or 0)


def bounded_read(stream: BinaryIO, maximum_bytes: int) -> bytes:
    declared = None
    headers = getattr(stream, "headers", None)
    if headers is not None:
        declared_value = headers.get("Content-Length")
        if declared_value:
            try:
                declared = int(declared_value)
            except ValueError as error:
                raise RuntimeError("seoul_content_length_invalid") from error
    if declared is not None and (declared < 0 or declared > maximum_bytes):
        raise RuntimeError("seoul_response_too_large")

    output = bytearray()
    while True:
        chunk = stream.read(min(65_536, maximum_bytes + 1 - len(output)))
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise RuntimeError("seoul_response_invalid")
        output.extend(chunk)
        if len(output) > maximum_bytes:
            raise RuntimeError("seoul_response_too_large")
    return bytes(output)


def content_type(headers: Mapping[str, str]) -> tuple[str, str | None]:
    raw = headers.get("Content-Type", "")
    message = email.message.Message()
    message["content-type"] = raw
    return message.get_content_type().lower(), message.get_content_charset()


def validate_sheet_response(
    response: object,
    definition: SheetDefinition,
) -> bytes:
    if response_status(response) != 200:
        raise RuntimeError(f"seoul_{definition.key}_http_error")
    final_url = str(getattr(response, "url", "") or response.geturl())
    parsed = urllib.parse.urlsplit(final_url)
    if (
        parsed.scheme.lower() != "https"
        or (parsed.hostname or "").lower() != SHEET_HOST
        or (parsed.port not in {None, 443})
        or parsed.path != urllib.parse.urlsplit(SHEET_DOWNLOAD_URL).path
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError(f"seoul_{definition.key}_final_url_invalid")

    headers = getattr(response, "headers", {})
    media_type, charset = content_type(headers)
    if media_type not in {
        "application/x-msdownload",
        "application/octet-stream",
        "application/csv",
        "text/csv",
    }:
        raise RuntimeError(f"seoul_{definition.key}_content_type_invalid")
    if charset and charset.lower().replace("_", "-") not in {
        "cp949",
        "euc-kr",
        "ks-c-5601-1987",
    }:
        raise RuntimeError(f"seoul_{definition.key}_charset_invalid")
    disposition = headers.get("Content-Disposition", "")
    if (
        "attachment" not in disposition.lower()
        or ".csv" not in disposition.lower()
    ):
        raise RuntimeError(f"seoul_{definition.key}_disposition_invalid")
    encoding = headers.get("Content-Encoding", "").strip().lower()
    if encoding not in {"", "identity"}:
        raise RuntimeError(f"seoul_{definition.key}_content_encoding_invalid")

    content = bounded_read(response, definition.maximum_bytes)
    if len(content) < definition.minimum_bytes:
        raise RuntimeError(f"seoul_{definition.key}_response_too_small")
    if content.lstrip().lower().startswith((b"<html", b"<!doctype")):
        raise RuntimeError(f"seoul_{definition.key}_html_response")
    validate_csv_headers(DownloadedSheet(definition, content))
    return content


def sheet_form(definition: SheetDefinition) -> bytes:
    return urllib.parse.urlencode({
        "srvType": "S",
        "infId": definition.inf_id,
        "serviceKind": "0",
        "pageNo": "1",
        "gridTotalCnt": "",
        "ssUserId": "SAMPLE_VIEW",
        "strWhere": "",
        "strOrderby": "STDR_YYQU_CD DESC",
        "filterCol": "필터선택",
        "txtFilter": "",
    }).encode("utf-8")


def download_sheet(
    definition: SheetDefinition,
    opener: urllib.request.OpenerDirector,
) -> DownloadedSheet:
    parsed = urllib.parse.urlsplit(SHEET_DOWNLOAD_URL)
    if (
        parsed.scheme != "https"
        or parsed.hostname != SHEET_HOST
        or parsed.path != "/bigfile/iot/sheet/csv/download.do"
    ):
        raise RuntimeError("seoul_sheet_endpoint_invalid")
    request = urllib.request.Request(
        SHEET_DOWNLOAD_URL,
        data=sheet_form(definition),
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BORA-Bridge/2.0",
            "Accept": "text/csv,application/x-msdownload,application/octet-stream",
        },
    )
    try:
        with opener.open(request, timeout=180) as response:
            content = validate_sheet_response(response, definition)
    except RuntimeError:
        raise
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
        raise RuntimeError(f"seoul_{definition.key}_download_failed") from error
    return DownloadedSheet(definition, content)


def csv_reader(sheet: DownloadedSheet) -> csv.DictReader:
    try:
        text = io.TextIOWrapper(
            io.BytesIO(sheet.content),
            encoding="cp949",
            errors="strict",
            newline="",
        )
        reader = csv.DictReader(text)
        if reader.fieldnames is None:
            raise RuntimeError(f"seoul_{sheet.definition.key}_header_missing")
        fieldnames = [
            field.strip().lstrip("\ufeff") if field is not None else ""
            for field in reader.fieldnames
        ]
        if (
            any(not field for field in fieldnames)
            or len(fieldnames) != len(set(fieldnames))
            or not sheet.definition.required_headers.issubset(fieldnames)
        ):
            raise RuntimeError(f"seoul_{sheet.definition.key}_header_invalid")
        reader.fieldnames = fieldnames
        return reader
    except UnicodeDecodeError as error:
        raise RuntimeError(f"seoul_{sheet.definition.key}_encoding_invalid") from error


def validate_csv_headers(sheet: DownloadedSheet) -> None:
    csv_reader(sheet)


def rows(sheet: DownloadedSheet):
    reader = csv_reader(sheet)
    count = 0
    try:
        for row in reader:
            if not row or all(not str(value or "").strip() for value in row.values()):
                continue
            if None in row or any(value is None for value in row.values()):
                raise RuntimeError(
                    f"seoul_{sheet.definition.key}_row_width_invalid"
                )
            count += 1
            if count > sheet.definition.maximum_rows:
                raise RuntimeError(f"seoul_{sheet.definition.key}_row_limit")
            yield row
    except csv.Error as error:
        raise RuntimeError(f"seoul_{sheet.definition.key}_csv_invalid") from error


def clean_text(value: object, maximum: int, field: str) -> str:
    output = normalize_seoul_name(re.sub(r"\s+", " ", str(value or "")).strip())
    if not output or len(output) > maximum:
        raise RuntimeError(f"seoul_invalid_{field}")
    return output


def optional_text(value: object, maximum: int, field: str) -> str | None:
    output = normalize_seoul_name(re.sub(r"\s+", " ", str(value or "")).strip())
    if not output:
        return None
    if len(output) > maximum:
        raise RuntimeError(f"seoul_invalid_{field}")
    return output


def normalize_seoul_name(value: str) -> str:
    """Repair a CP949 middle-dot that the official CSV may expose as `?`."""
    return re.sub(r"(?<=[0-9A-Za-z가-힣])\?(?=[0-9A-Za-z가-힣])", "·", value)


def normalize_neighborhood(district: str | None, neighborhood: str | None) -> str | None:
    if not neighborhood:
        return None
    value = re.sub(r"^서울(?:특별시)?\s+", "", neighborhood).strip()
    if district and value.startswith(f"{district} "):
        value = value[len(district):].strip()
    return value or None


def quarter_value(row: Mapping[str, object]) -> str:
    quarter = clean_text(row.get("기준_년분기_코드"), 5, "quarter")
    if not re.fullmatch(r"20\d{2}[1-4]", quarter):
        raise RuntimeError("seoul_invalid_quarter")
    return quarter


def area_code(row: Mapping[str, object]) -> str:
    code = clean_text(row.get("상권_코드"), 10, "area_code")
    if not re.fullmatch(r"\d{7,10}", code):
        raise RuntimeError("seoul_invalid_area_code")
    return code


def nonnegative_integer(value: object, field: str) -> int:
    raw = str(value or "").replace(",", "").strip()
    if not re.fullmatch(r"\d+", raw):
        raise RuntimeError(f"seoul_invalid_{field}")
    number = int(raw)
    if number > SAFE_INTEGER_MAX:
        raise RuntimeError(f"seoul_invalid_{field}")
    return number


def optional_positive_number(value: object, field: str) -> int | float | None:
    raw = str(value or "").replace(",", "").strip()
    if not raw:
        return None
    if not re.fullmatch(r"\d+(?:\.\d+)?", raw):
        raise RuntimeError(f"seoul_invalid_{field}")
    number = float(raw)
    if not math.isfinite(number) or number <= 0 or number > SAFE_INTEGER_MAX:
        raise RuntimeError(f"seoul_invalid_{field}")
    return int(number) if number.is_integer() else number


def safe_add(left: int, right: int) -> int:
    value = left + right
    if value > SAFE_INTEGER_MAX:
        raise RuntimeError("seoul_numeric_overflow")
    return value


def available_quarters(sheet: DownloadedSheet) -> set[str]:
    return {quarter_value(row) for row in rows(sheet)}


def latest_common_quarter(
    sales_sheet: DownloadedSheet,
    footfall_sheet: DownloadedSheet,
) -> str:
    common = available_quarters(sales_sheet) & available_quarters(footfall_sheet)
    if not common:
        raise RuntimeError("seoul_no_common_quarter")
    return max(common)


def aggregate_sales(sheet: DownloadedSheet, quarter: str):
    aggregates: dict[str, dict[str, object]] = {}
    identities: set[tuple[str, str]] = set()
    row_count = 0
    for row in rows(sheet):
        if quarter_value(row) != quarter:
            continue
        code = area_code(row)
        industry_code = clean_text(
            row.get("서비스_업종_코드"),
            40,
            "industry_code",
        )
        identity = (code, industry_code)
        if identity in identities:
            raise RuntimeError("seoul_duplicate_sales_row")
        identities.add(identity)
        row_count += 1

        name = clean_text(row.get("상권_코드_명"), 180, "area_name")
        area_type = clean_text(
            row.get("상권_구분_코드_명"),
            120,
            "area_type",
        )
        industry_name = clean_text(
            row.get("서비스_업종_코드_명"),
            120,
            "industry_name",
        )
        amount = nonnegative_integer(row.get("당월_매출_금액"), "sales")
        hourly = [
            nonnegative_integer(row.get(field), f"sales_hour_{index}")
            for index, field in enumerate(SALES_HOUR_FIELDS)
        ]
        aggregate = aggregates.get(code)
        if aggregate is None:
            aggregate = {
                "name": name,
                "areaType": area_type,
                "total": 0,
                "hours": [0] * len(HOURS),
                "industries": defaultdict(int),
            }
            aggregates[code] = aggregate
        elif (
            aggregate["name"] != name
            or aggregate["areaType"] != area_type
        ):
            raise RuntimeError("seoul_sales_area_metadata_mismatch")

        aggregate["total"] = safe_add(int(aggregate["total"]), amount)
        for index, value in enumerate(hourly):
            aggregate["hours"][index] = safe_add(
                int(aggregate["hours"][index]),
                value,
            )
        industries = aggregate["industries"]
        industries[industry_name] = safe_add(industries[industry_name], amount)
    if row_count < 1 or not aggregates:
        raise RuntimeError("seoul_sales_current_quarter_empty")
    return aggregates, row_count


def aggregate_footfall(sheet: DownloadedSheet, quarter: str):
    aggregates: dict[str, dict[str, object]] = {}
    row_count = 0
    for row in rows(sheet):
        if quarter_value(row) != quarter:
            continue
        code = area_code(row)
        if code in aggregates:
            raise RuntimeError("seoul_duplicate_footfall_row")
        row_count += 1
        aggregates[code] = {
            "name": clean_text(row.get("상권_코드_명"), 180, "area_name"),
            "areaType": clean_text(
                row.get("상권_구분_코드_명"),
                120,
                "area_type",
            ),
            "total": nonnegative_integer(
                row.get("총_유동인구_수"),
                "total_footfall",
            ),
            "hours": [
                nonnegative_integer(row.get(field), f"footfall_hour_{index}")
                for index, field in enumerate(FOOTFALL_HOUR_FIELDS)
            ],
        }
    if row_count < 1 or not aggregates:
        raise RuntimeError("seoul_footfall_current_quarter_empty")
    return aggregates, row_count


def area_directory(sheet: DownloadedSheet):
    output: dict[str, dict[str, object]] = {}
    row_count = 0
    for row in rows(sheet):
        code = area_code(row)
        if code in output:
            raise RuntimeError("seoul_duplicate_area_row")
        row_count += 1
        district = optional_text(
            row.get("자치구_코드_명"),
            80,
            "district",
        )
        neighborhood = normalize_neighborhood(
            district,
            optional_text(
                row.get("행정동_코드_명"),
                80,
                "neighborhood",
            ),
        )
        output[code] = {
            "name": clean_text(row.get("상권_코드_명"), 180, "area_name"),
            "areaType": clean_text(
                row.get("상권_구분_코드_명"),
                120,
                "area_type",
            ),
            "district": district,
            "neighborhood": neighborhood,
            "areaSquareMeters": optional_positive_number(
                row.get("영역_면적"),
                "area_square_meters",
            ),
        }
    if row_count < 1 or not output:
        raise RuntimeError("seoul_area_directory_empty")
    return output, row_count


def industry_composition(
    values: Mapping[str, int],
    total: int,
) -> list[dict[str, object]]:
    if total <= 0:
        return []
    positive = [
        (name, amount)
        for name, amount in values.items()
        if amount > 0 and name != "기타"
    ]
    positive.sort(key=lambda entry: (-entry[1], entry[0]))
    existing_other = max(0, int(values.get("기타", 0)))
    selected = positive[:23]
    remainder = safe_add(
        existing_other,
        sum(amount for _, amount in positive[23:]),
    )
    if remainder > 0:
        selected.append(("기타", remainder))
    if not selected:
        return []
    if sum(amount for _, amount in selected) != total:
        raise RuntimeError("seoul_industry_total_mismatch")

    shares = [round(amount * 100 / total, 6) for _, amount in selected]
    shares[-1] = round(shares[-1] + 100 - sum(shares), 6)
    if any(share < 0 or share > 100 for share in shares):
        raise RuntimeError("seoul_industry_share_invalid")
    return [
        {
            "name": name,
            "sharePercent": share,
            "storeCount": None,
        }
        for (name, _), share in zip(selected, shares, strict=True)
    ]


def quarter_end_date(quarter: str) -> str:
    endings = ("03-31", "06-30", "09-30", "12-31")
    return f"{quarter[:4]}-{endings[int(quarter[-1]) - 1]}"


def dataset_manifest(
    sheet: DownloadedSheet,
    row_count: int,
    unique_area_count: int,
) -> dict[str, object]:
    return {
        "infId": sheet.definition.inf_id,
        "providerRowCount": row_count,
        "fetchedRowCount": row_count,
        "providerAreaCount": unique_area_count,
        "fetchedAreaCount": unique_area_count,
        "contentBytes": len(sheet.content),
        "sha256": hashlib.sha256(sheet.content).hexdigest(),
    }


def build_snapshot(
    downloaded: Mapping[str, DownloadedSheet],
    *,
    now_iso: str | None = None,
    coverage_policy: CoveragePolicy = DEFAULT_COVERAGE_POLICY,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    if set(downloaded) != set(SHEETS):
        raise RuntimeError("seoul_sheet_set_incomplete")
    quarter = latest_common_quarter(
        downloaded["sales"],
        downloaded["footfall"],
    )
    sales, sales_row_count = aggregate_sales(downloaded["sales"], quarter)
    footfall, footfall_row_count = aggregate_footfall(
        downloaded["footfall"],
        quarter,
    )
    areas, area_row_count = area_directory(downloaded["area"])
    area_codes = set(areas)
    if set(sales) - area_codes or set(footfall) - area_codes:
        raise RuntimeError("seoul_metric_area_outside_directory")

    area_count = len(area_codes)
    if (
        area_count < coverage_policy.minimum_area_count
        or area_count > coverage_policy.maximum_area_count
    ):
        raise RuntimeError("seoul_area_coverage_invalid")
    sales_ratio = len(sales) / area_count
    footfall_ratio = len(footfall) / area_count
    if sales_ratio < coverage_policy.minimum_sales_ratio:
        raise RuntimeError("seoul_sales_coverage_too_low")
    if footfall_ratio < coverage_policy.minimum_footfall_ratio:
        raise RuntimeError("seoul_footfall_coverage_too_low")

    collected_at = now_iso or utc_now_iso()
    reference_date = quarter_end_date(quarter)
    items: list[dict[str, object]] = []
    for code in sorted(area_codes):
        area = areas[code]
        sale = sales.get(code)
        flow = footfall.get(code)
        district = area["district"]
        neighborhood = area["neighborhood"]
        label = " ".join(
            value
            for value in (district, neighborhood)
            if isinstance(value, str) and value
        ) or "서울특별시"
        estimated_sales = int(sale["total"]) if sale is not None else None
        sales_hours = (
            [
                {"hour": hour, "amount": int(sale["hours"][index])}
                for index, hour in enumerate(HOURS)
            ]
            if sale is not None
            else []
        )
        footfall_hours = (
            [
                {"hour": hour, "people": int(flow["hours"][index])}
                for index, hour in enumerate(HOURS)
            ]
            if flow is not None
            else []
        )
        composition = (
            industry_composition(sale["industries"], int(sale["total"]))
            if sale is not None
            else []
        )
        availability = []
        if sale is not None:
            availability.append("추정매출·업종구성·시간대별 매출")
        if flow is not None:
            availability.append("시간대별 유동인구")
        missing = []
        if sale is None:
            missing.append("매출")
        if flow is None:
            missing.append("유동인구")
        summary = (
            f"{quarter[:4]}년 {quarter[-1]}분기 공식 "
            f"{' 및 '.join(availability)} 정보를 제공합니다."
        )
        if missing:
            summary += (
                f" 공식 원천에 행이 없는 {', '.join(missing)} 지표는 "
                "값을 추정하지 않고 제공하지 않습니다."
            )

        tags = [
            "서울",
            "상권",
            f"{quarter[:4]}년 {quarter[-1]}분기",
            str(area["areaType"]),
        ]
        if sale is not None:
            tags.append("추정매출")
        if flow is not None:
            tags.append("유동인구")
        tags.extend(
            value
            for value in (district, neighborhood)
            if isinstance(value, str) and value
        )
        items.append({
            "id": f"seoul-commercial-{code}",
            "category": "startup",
            "title": str(area["name"]),
            "summary": summary,
            "source": "서울시 상권분석서비스 공식 Sheet CSV",
            "sourceUrl": SOURCE_URLS["sales"],
            "sourceLinkKind": "dataset",
            "publishedAt": reference_date,
            "discoveredAt": collected_at,
            "lastVerifiedAt": collected_at,
            "tags": tags,
            "location": {
                "label": label,
                "province": "서울특별시",
                "city": district or "서울특별시",
                **({"neighborhood": neighborhood} if neighborhood else {}),
                "precision": "administrative",
            },
            "commercialArea": {
                "areaSquareMeters": area["areaSquareMeters"],
                "referenceDate": reference_date,
                "coordinateCount": None,
                "analytics": {
                    "officialCode": code,
                    "referenceQuarter": quarter,
                    "areaType": area["areaType"],
                    "estimatedTotalSales": estimated_sales,
                    "industrySalesComposition": composition,
                    "salesByHour": sales_hours,
                    "footfallByHour": footfall_hours,
                    "sourceUrl": SOURCE_URLS["sales"],
                },
            },
        })

    manifest = {
        "schemaVersion": 1,
        "fullSnapshot": True,
        "quarter": quarter,
        "collectedAt": collected_at,
        "unionAreaCount": area_count,
        "itemCount": len(items),
        "datasets": {
            "sales": dataset_manifest(
                downloaded["sales"],
                sales_row_count,
                len(sales),
            ),
            "footfall": dataset_manifest(
                downloaded["footfall"],
                footfall_row_count,
                len(footfall),
            ),
            "area": dataset_manifest(
                downloaded["area"],
                area_row_count,
                area_count,
            ),
        },
        "coverage": {
            "salesAreaCount": len(sales),
            "footfallAreaCount": len(footfall),
            "areaCount": area_count,
            "salesRatio": round(sales_ratio, 6),
            "footfallRatio": round(footfall_ratio, 6),
        },
    }
    return items, manifest


def read_json_response(
    response: object,
    *,
    expected_url: str,
    error_code: str,
) -> dict[str, object]:
    if response_status(response) != 200:
        raise RuntimeError(error_code)
    actual = str(getattr(response, "url", "") or response.geturl())
    if not same_endpoint(expected_url, actual):
        raise RuntimeError(f"{error_code}_final_url")
    headers = getattr(response, "headers", {})
    media_type, _ = content_type(headers)
    if media_type != "application/json":
        raise RuntimeError(f"{error_code}_content_type")
    try:
        value = json.loads(
            bounded_read(response, MAX_JSON_RESPONSE_BYTES).decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{error_code}_invalid_json") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{error_code}_invalid_json")
    return value


def preflight_enabled(
    endpoint: str,
    secret: str,
    opener: urllib.request.OpenerDirector,
) -> bool:
    request = urllib.request.Request(
        endpoint,
        method="GET",
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
            "User-Agent": "BORA-Bridge/2.0",
        },
    )
    try:
        with opener.open(request, timeout=30) as response:
            value = read_json_response(
                response,
                expected_url=endpoint,
                error_code="seoul_import_preflight_failed",
            )
    except RuntimeError:
        raise
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
        raise RuntimeError("seoul_import_preflight_failed") from error
    if not isinstance(value.get("enabled"), bool):
        raise RuntimeError("seoul_import_preflight_invalid")
    return bool(value["enabled"])


def post_snapshot(
    endpoint: str,
    secret: str,
    items: list[dict[str, object]],
    manifest: dict[str, object],
    opener: urllib.request.OpenerDirector,
) -> dict[str, object]:
    body = json.dumps(
        {
            "sourceId": SOURCE_ID,
            "items": items,
            "manifest": manifest,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(body) > MAX_IMPORT_BODY_BYTES:
        raise RuntimeError("seoul_import_body_too_large")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BORA-Bridge/2.0",
        },
    )
    try:
        with opener.open(request, timeout=180) as response:
            return read_json_response(
                response,
                expected_url=endpoint,
                error_code="seoul_import_post_failed",
            )
    except RuntimeError:
        raise
    except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
        raise RuntimeError("seoul_import_post_failed") from error


def run_import(
    *,
    endpoint: str,
    secret: str,
    dry_run: bool,
    opener: urllib.request.OpenerDirector | None = None,
) -> dict[str, object]:
    if len(secret) < 32:
        raise RuntimeError("scheduler_secret_missing_or_short")
    endpoint = import_endpoint(endpoint)
    client = opener or default_opener()
    if not preflight_enabled(endpoint, secret, client):
        return {
            "ok": True,
            "sourceId": SOURCE_ID,
            "skipped": "disabled",
        }

    downloaded = {
        key: download_sheet(definition, client)
        for key, definition in SHEETS.items()
    }
    items, manifest = build_snapshot(downloaded)
    if dry_run:
        return {
            "ok": True,
            "sourceId": SOURCE_ID,
            "dryRun": True,
            "itemCount": len(items),
            "manifest": manifest,
        }
    result = post_snapshot(endpoint, secret, items, manifest, client)
    return {
        "ok": result.get("ok") is True,
        "sourceId": SOURCE_ID,
        "itemCount": len(items),
        "quarter": manifest["quarter"],
        "coverage": manifest["coverage"],
        **(
            {"updatedAt": result["updatedAt"]}
            if isinstance(result.get("updatedAt"), str)
            else {}
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--endpoint",
        default="http://127.0.0.1:3000/api/public-data/import/seoul-commercial",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run_import(
        endpoint=args.endpoint,
        secret=os.environ.get("SCHEDULER_SECRET", ""),
        dry_run=args.dry_run,
    )
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(
            str(error) if isinstance(error, RuntimeError) else "seoul_import_failed",
            file=sys.stderr,
        )
        raise SystemExit(1)
