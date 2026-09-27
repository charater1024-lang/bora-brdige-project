from __future__ import annotations

import csv
import importlib.util
import io
import json
import sys
import unittest
from email.message import Message
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
IMPORTER_PATH = PROJECT_ROOT / "scripts" / "import-seoul-commercial-sales.py"
SPEC = importlib.util.spec_from_file_location("bora_seoul_importer", IMPORTER_PATH)
assert SPEC and SPEC.loader
importer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = importer
SPEC.loader.exec_module(importer)


def encoded_sheet(key: str, headers: list[str], records: list[dict[str, str]]):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    writer.writerows(records)
    return importer.DownloadedSheet(importer.SHEETS[key], stream.getvalue().encode("cp949"))


def common(code: str, name: str) -> dict[str, str]:
    return {
        "상권_구분_코드_명": "골목상권",
        "상권_코드": code,
        "상권_코드_명": name,
    }


def sales_record(
    code: str,
    quarter: str,
    industry_index: int,
    amount: int,
) -> dict[str, str]:
    return {
        **common(code, f"테스트 상권 {code}"),
        "기준_년분기_코드": quarter,
        "서비스_업종_코드": f"CS{industry_index:06d}",
        "서비스_업종_코드_명": f"업종 {industry_index:02d}",
        "당월_매출_금액": str(amount),
        **{
            field: str(amount + index)
            for index, field in enumerate(importer.SALES_HOUR_FIELDS)
        },
    }


def footfall_record(code: str, quarter: str, people: int) -> dict[str, str]:
    return {
        **common(code, f"테스트 상권 {code}"),
        "기준_년분기_코드": quarter,
        "총_유동인구_수": str(people),
        **{
            field: str(people + index)
            for index, field in enumerate(importer.FOOTFALL_HOUR_FIELDS)
        },
    }


def area_record(code: str, area: str) -> dict[str, str]:
    return {
        **common(code, f"테스트 상권 {code}"),
        "자치구_코드_명": "종로구",
        "행정동_코드_명": "청운효자동",
        "영역_면적": area,
    }


def fixtures():
    common_headers = ["상권_구분_코드_명", "상권_코드", "상권_코드_명"]
    sales_headers = [
        "기준_년분기_코드",
        *common_headers,
        "서비스_업종_코드",
        "서비스_업종_코드_명",
        "당월_매출_금액",
        *importer.SALES_HOUR_FIELDS,
    ]
    footfall_headers = [
        "기준_년분기_코드",
        *common_headers,
        "총_유동인구_수",
        *importer.FOOTFALL_HOUR_FIELDS,
    ]
    area_headers = [
        *common_headers,
        "자치구_코드_명",
        "행정동_코드_명",
        "영역_면적",
    ]
    sales = [
        sales_record("3000001", "20254", 99, 10),
        *[
            sales_record("3000001", "20261", index, index)
            for index in range(1, 25)
        ],
        sales_record("3000002", "20261", 50, 1_000),
    ]
    footfall = [
        footfall_record("3000001", "20254", 90),
        footfall_record("3000001", "20261", 100),
        footfall_record("3000003", "20261", 300),
    ]
    areas = [
        area_record("3000001", "1234.5"),
        area_record("3000002", "2000"),
        area_record("3000003", ""),
    ]
    return {
        "sales": encoded_sheet("sales", sales_headers, sales),
        "footfall": encoded_sheet("footfall", footfall_headers, footfall),
        "area": encoded_sheet("area", area_headers, areas),
    }


class FakeResponse:
    def __init__(self, url: str, body: bytes):
        self.url = url
        self.status = 200
        self.headers = Message()
        self.headers["Content-Type"] = "application/json; charset=utf-8"
        self.headers["Content-Length"] = str(len(body))
        self._stream = io.BytesIO(body)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def geturl(self):
        return self.url

    def read(self, size: int = -1):
        return self._stream.read(size)


class DisabledPreflightOpener:
    def __init__(self):
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return FakeResponse(request.full_url, b'{"enabled":false}')


class SeoulCommercialImporterTests(unittest.TestCase):
    def test_seoul_name_and_neighborhood_repairs_are_bounded(self):
        self.assertEqual(
            importer.normalize_seoul_name("종로1?2?3?4가동"),
            "종로1·2·3·4가동",
        )
        self.assertEqual(
            importer.normalize_neighborhood("동작구", "동작구 노량진1동"),
            "노량진1동",
        )

    def test_latest_common_quarter_full_union_and_official_gaps(self):
        items, manifest = importer.build_snapshot(
            fixtures(),
            now_iso="2026-07-31T00:00:00Z",
            coverage_policy=importer.CoveragePolicy(
                minimum_area_count=3,
                minimum_sales_ratio=0.5,
                minimum_footfall_ratio=0.5,
                maximum_area_count=3,
            ),
        )
        self.assertEqual(manifest["quarter"], "20261")
        self.assertEqual(manifest["unionAreaCount"], 3)
        self.assertEqual(manifest["coverage"]["salesAreaCount"], 2)
        self.assertEqual(manifest["coverage"]["footfallAreaCount"], 2)
        self.assertEqual(
            manifest["datasets"]["sales"]["providerRowCount"],
            manifest["datasets"]["sales"]["fetchedRowCount"],
        )
        self.assertEqual(
            manifest["datasets"]["footfall"]["providerAreaCount"],
            manifest["datasets"]["footfall"]["fetchedAreaCount"],
        )

        by_id = {item["id"]: item for item in items}
        first = by_id["seoul-commercial-3000001"]
        second = by_id["seoul-commercial-3000002"]
        third = by_id["seoul-commercial-3000003"]
        self.assertEqual(first["commercialArea"]["areaSquareMeters"], 1234.5)
        self.assertIsNone(third["commercialArea"]["areaSquareMeters"])
        self.assertEqual(len(first["commercialArea"]["analytics"]["salesByHour"]), 6)
        self.assertEqual(len(first["commercialArea"]["analytics"]["footfallByHour"]), 6)
        self.assertEqual(second["commercialArea"]["analytics"]["footfallByHour"], [])
        self.assertIsNone(third["commercialArea"]["analytics"]["estimatedTotalSales"])
        self.assertEqual(third["commercialArea"]["analytics"]["salesByHour"], [])

        composition = first["commercialArea"]["analytics"]["industrySalesComposition"]
        self.assertEqual(len(composition), 24)
        self.assertEqual(composition[-1]["name"], "기타")
        self.assertAlmostEqual(sum(entry["sharePercent"] for entry in composition), 100)

        body = json.dumps(
            {"sourceId": importer.SOURCE_ID, "items": items, "manifest": manifest},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
        self.assertLess(len(body), importer.MAX_IMPORT_BODY_BYTES)

    def test_disabled_preflight_performs_no_official_sheet_request(self):
        opener = DisabledPreflightOpener()
        result = importer.run_import(
            endpoint="http://127.0.0.1:3000/api/public-data/import/seoul-commercial",
            secret="x" * 32,
            dry_run=False,
            opener=opener,
        )
        self.assertEqual(result["skipped"], "disabled")
        self.assertEqual(len(opener.requests), 1)
        request, _ = opener.requests[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertTrue(request.full_url.startswith("http://127.0.0.1:3000/"))
        self.assertNotIn(importer.SHEET_HOST, request.full_url)


if __name__ == "__main__":
    unittest.main()
