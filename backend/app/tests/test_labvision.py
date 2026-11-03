import io
from datetime import timedelta

import numpy as np
import pytest

from app.models import LabVisionAnalysis, LabVisionFinding
from app.models.base import utcnow
from app.schemas.labvision import AnalyzeRequest
from app.services.labvision.engine import AnalysisError, run_analysis
from app.services.labvision.parsing import DatasetError, DatasetTooLarge, parse_dataset
from app.services.labvision.report import safe_cell
from app.tests.conftest import _make_user, auth

MB = 1024 * 1024


def parse(content: bytes | str, name: str = "data.csv", **limits):
    if isinstance(content, str):
        content = content.encode("utf-8")
    options = {"max_bytes": 10 * MB, "max_rows": 10_000, "max_columns": 50} | limits
    return parse_dataset(name, content, **options)


def analyse(csv_text: str, max_findings: int = 5000, **config):
    frame = parse(csv_text).frame
    return run_analysis(frame, AnalyzeRequest(dataset_id="testdataset", **config), max_findings)


def normal_csv(n: int = 120, seed: int = 0, extra: list[str] | None = None) -> str:
    rng = np.random.default_rng(seed)
    lines = ["id,glucose,ldl,site"]
    for i in range(n):
        lines.append(f"S{i:04d},{rng.normal(5.0, 0.4):.3f},{rng.normal(3.0, 0.3):.3f},A")
    return "\n".join(lines + (extra or []))


def xlsx_bytes(sheets: dict[str, list[list]]) -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, rows in sheets.items():
        sheet = workbook.create_sheet(title)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def by_type(output, issue_type):
    return [f for f in output.findings if f.issue_type == issue_type]


# ---------- parsing & upload validation ----------


def test_parses_csv_as_text_and_keeps_original_values():
    parsed = parse("id,value\n001,1.50\n002,  2 \n")
    assert parsed.delimiter == "," and parsed.encoding == "utf-8"
    assert parsed.frame["id"].tolist() == ["001", "002"]  # leading zeros preserved
    assert parsed.frame["value"].tolist() == ["1.50", "  2 "]


def test_semicolon_and_decimal_comma_are_detected():
    output = analyse("a;b\n" + "\n".join(f"{i},5;x" for i in range(20)))
    profile = next(c for c in output.results["columns"] if c["name"] == "a")
    assert profile["inferred_type"] == "numeric" and profile["decimal_comma"] is True
    assert any("decimal commas" in note for note in output.results["notes"])


def test_non_utf8_encoding_is_reported():
    parsed = parse("name,value\nCr\u00e9atinine,80\n".encode("cp1252"))
    assert parsed.encoding == "cp1252"
    assert parsed.frame["name"].iloc[0] == "Cr\u00e9atinine"
    assert any("not UTF-8" in w for w in parsed.warnings)


def test_utf16_csv_is_supported():
    parsed = parse("a,b\n1,2\n".encode("utf-16"))
    assert parsed.frame.shape == (1, 2)


def test_duplicate_and_blank_headers_are_renamed_with_a_warning():
    parsed = parse("a,a,\n1,2,3\n")
    assert list(parsed.frame.columns) == ["a", "a (2)", "Column 3"]
    assert len(parsed.warnings) == 2


@pytest.mark.parametrize(
    ("name", "content", "message"),
    [
        ("data.txt", b"a,b\n1,2", "Only CSV, XLSX and XLS"),
        ("data.csv", b"", "empty"),
        ("data.csv", b"a,b\n1,2,3,4\n", "Malformed CSV at line 2"),
        ("data.csv", b"\x00\x01\x02binary", "binary"),
        ("data.csv", b"PK\x03\x04rest", "Excel workbook saved with a .csv"),
        ("data.xlsx", b"not a zip", "not a valid XLSX"),
        ("data.xls", b"not ole", "not a valid XLS"),
        ("../../etc/passwd.csv", b"", "empty"),
    ],
)
def test_invalid_files_are_rejected(name, content, message):
    with pytest.raises(DatasetError, match=message):
        parse(content, name)


def test_size_row_and_column_limits():
    with pytest.raises(DatasetTooLarge, match="MB limit"):
        parse(b"a\n" + b"1\n" * 600_000, max_bytes=1 * MB)
    with pytest.raises(DatasetTooLarge, match="more than 5 data rows"):
        parse("a\n" + "1\n" * 6, max_rows=5)
    assert parse("a\n" + "1\n" * 5, max_rows=5).frame.shape == (5, 1)
    with pytest.raises(DatasetTooLarge, match="limit is 3"):
        parse("a,b,c,d\n1,2,3,4\n", max_columns=3)


def test_xlsx_is_parsed_without_evaluating_formulas_and_sheets_are_selectable():
    content = xlsx_bytes({
        "Results": [["id", "value", "formula"], ["S1", 4.5, "=1+1"], ["S2", 5, "=HYPERLINK(\"x\")"]],
        "Other": [["x"], [1]],
    })
    parsed = parse(content, "results.xlsx")
    assert parsed.sheets == ["Results", "Other"] and parsed.sheet_name == "Results"
    assert parsed.frame["value"].tolist() == ["4.5", "5"]
    # openpyxl only returns cached values; formulas written by openpyxl have none, so nothing is evaluated.
    assert "2" not in parsed.frame["formula"].tolist()
    other = parse(content, "results.xlsx", sheet="Other")
    assert other.frame.shape == (1, 1)
    with pytest.raises(DatasetError, match="sheet does not exist"):
        parse(content, "results.xlsx", sheet="Missing")


def test_macro_workbooks_are_rejected():
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", "<workbook/>")
        archive.writestr("xl/vbaProject.bin", b"macro")
    with pytest.raises(DatasetError, match="Macro-enabled"):
        parse(buffer.getvalue(), "book.xlsx")


# ---------- data quality ----------


def test_missing_values_by_column_and_row():
    output = analyse("a,b,c\n1,,x\n2,NA,\n,n/a,\n4,5,y\n")
    metrics = output.results["metrics"]
    assert metrics["missing_cells"] == 6
    assert metrics["rows_with_missing"] == 3 and metrics["complete_rows"] == 1
    missing = {f.column: f for f in by_type(output, "missing_values")}
    assert missing["b"].affected_count == 3 and missing["b"].row_numbers == [1, 2, 3]
    assert missing["b"].severity == "medium"  # 75% >= 20%
    incomplete = by_type(output, "incomplete_rows")[0]
    assert incomplete.row_numbers == [2, 3]
    assert output.results["charts"]["missing_by_row"] == [{"missing_cells": k, "rows": 1} for k in range(4)]


def test_exact_and_key_duplicates():
    output = analyse(
        "sample,date,value\nS1,2024-01-01,5\nS2,2024-01-01,6\nS1,2024-01-01,5\nS2,2024-01-02,7\n",
        key_columns=["sample"], id_column="sample",
    )
    exact = by_type(output, "duplicate_rows")
    assert len(exact) == 1 and exact[0].row_numbers == [1, 3]
    keys = by_type(output, "duplicate_keys")
    assert {tuple(f.row_numbers) for f in keys} == {(1, 3), (2, 4)}
    assert all(f.severity == "high" for f in keys)
    metrics = output.results["metrics"]
    assert metrics["duplicate_rows"] == 1 and metrics["duplicate_key_rows"] == 2
    assert metrics["duplicate_rows_total"] == 2  # row 3 counted once although it is both


def test_type_errors_invalid_dates_empty_and_constant_columns():
    rows = [f"{i},{5 + i * 0.1:.1f},2024-03-{i + 1:02d},,mmol/L" for i in range(10)]
    rows[2] = "2,<0.5,2024-02-30,,mmol/L"
    rows[3] = "3,#DIV/0!,31/12/2024,,mmol/L"
    output = analyse("id,value,date,empty,unit\n" + "\n".join(rows))
    parse_errors = {f.observed_value: f.explanation for f in by_type(output, "numeric_parse_error")}
    assert "censored value" in parse_errors["<0.5"]
    assert "spreadsheet error code" in parse_errors["#DIV/0!"]
    invalid_dates = [f.observed_value for f in by_type(output, "invalid_date")]
    assert invalid_dates == ["2024-02-30"]  # 31/12/2024 is valid day-first
    assert [f.column for f in by_type(output, "empty_column")] == ["empty"]
    assert [f.column for f in by_type(output, "constant_column")] == ["unit"]
    assert output.results["metrics"]["invalid_cells"] == 3


def test_mixed_column_reports_type_inconsistency():
    output = analyse("v\n" + "\n".join(["1", "2", "high", "low", "3", "x", "y", "4", "z", "w"]))
    finding = by_type(output, "type_inconsistency")[0]
    assert finding.column == "v" and "mixes numbers" in finding.explanation


def test_declared_type_overrides_inference():
    output = analyse("code\n1\n2\n3\n", expected_types={"code": "text"})
    assert output.results["columns"][0]["inferred_type"] == "text"
    assert not output.results["numeric_columns"]


def test_user_ranges_and_validation_rules():
    output = analyse(
        "id,sex,glucose,collected\nA,F,5,2024-01-01\nB,X,40,2999-01-01\nB,M,-1,2024-01-02\nC,,4,2024-01-03\n",
        ranges={"glucose": {"min": 0, "max": 30}},
        rules=[
            {"type": "allowed_values", "column": "sex", "values": ["F", "M"]},
            {"type": "required", "column": "sex"},
            {"type": "unique", "column": "id"},
            {"type": "no_future_dates", "column": "collected"},
        ],
    )
    ranges = sorted(f.observed_value for f in by_type(output, "out_of_range"))
    assert ranges == ["-1", "40"]
    violations = by_type(output, "rule_violation")
    explanations = " ".join(f.explanation for f in violations)
    assert "\u201cX\u201d is not one of the allowed values" in explanations
    assert "required but 1 row" in explanations
    assert "must be unique" in explanations
    assert "later than the analysis time" in explanations
    assert all(f.severity == "high" for f in violations)


def test_source_frame_is_never_modified():
    frame = parse("a,b\n 1 ,NA\n1,2\n 1 ,NA\n").frame
    before = frame.copy()
    run_analysis(frame, AnalyzeRequest(dataset_id="testdataset"), 100)
    assert frame.equals(before)


# ---------- statistical anomalies ----------


def test_iqr_flags_values_outside_the_fences():
    values = [10, 11, 12, 11, 10, 12, 11, 10, 12, 11, 30]
    output = analyse("v\n" + "\n".join(map(str, values)),
                     methods={"zscore": {"enabled": False}, "isolation_forest": {"enabled": False}})
    flagged = by_type(output, "iqr_outlier")
    assert [f.observed_value for f in flagged] == ["30"]
    assert flagged[0].category == "statistical_outlier"
    assert "upper fence" in flagged[0].explanation and "Q1 - 1.5*IQR" in flagged[0].threshold


def test_iqr_is_skipped_when_iqr_is_zero():
    output = analyse("v\n" + "\n".join(["5"] * 9 + ["6", "7"]))
    report = next(m for m in output.results["methods"] if m["method"] == "iqr")
    assert report["status"] == "skipped"
    assert "IQR is zero" in report["columns_skipped"][-1]["reason"]


def test_zscore_standard_and_modified():
    values = [10.0 + 0.1 * (i % 5) for i in range(40)] + [25.0]
    csv_text = "v\n" + "\n".join(map(str, values))
    standard = analyse(csv_text, methods={"iqr": {"enabled": False}, "isolation_forest": {"enabled": False}})
    flagged = by_type(standard, "zscore_outlier")
    assert [f.observed_value for f in flagged] == ["25.0"] and flagged[0].score > 3
    modified = analyse(csv_text, methods={"zscore": {"variant": "modified", "threshold": 3.5}})
    assert any(f.method == "modified_zscore" for f in by_type(modified, "zscore_outlier"))


def test_zscore_documents_small_sample_limit():
    output = analyse("v\n" + "\n".join(map(str, [1, 2, 3, 4, 5, 6, 7, 8, 9, 50])))
    report = next(m for m in output.results["methods"] if m["method"] == "zscore")
    assert any("cannot be reached" in note for note in report["notes"])


def test_isolation_forest_is_reproducible_with_the_seed():
    csv_text = normal_csv(150, extra=["S9999,12.0,9.0,A"])
    methods = {"iqr": {"enabled": False}, "zscore": {"enabled": False},
               "isolation_forest": {"random_state": 7, "contamination": 0.02}}
    first = analyse(csv_text, id_column="id", methods=methods)
    second = analyse(csv_text, id_column="id", methods=methods)
    rows = lambda out: [(f.row_numbers, f.score) for f in by_type(out, "multivariate_outlier")]  # noqa: E731
    assert rows(first) == rows(second) and rows(first)
    extreme = next(f for f in by_type(first, "multivariate_outlier") if f.record_id == "S9999")
    assert extreme.score < 0 and "Isolation Forest" in extreme.explanation
    report = next(m for m in first.results["methods"] if m["method"] == "isolation_forest")
    assert report["parameters"]["random_state"] == 7 and report["status"] == "applied"


def test_isolation_forest_needs_two_columns_and_enough_rows():
    single = analyse("v\n" + "\n".join(str(i) for i in range(50)))
    report = next(m for m in single.results["methods"] if m["method"] == "isolation_forest")
    assert report["status"] == "skipped" and "two suitable numeric columns" in report["notes"][0]
    few = analyse(normal_csv(15))
    report = next(m for m in few.results["methods"] if m["method"] == "isolation_forest")
    assert report["status"] == "skipped" and "complete rows" in report["notes"][0]


def test_time_series_detection_requires_a_valid_time_column():
    rows = [f"2024-01-{(i % 28) + 1:02d} {i % 24:02d}:00,{10 + (i % 3) * 0.1:.1f}" for i in range(60)]
    rows[30] = rows[30].split(",")[0] + ",30"
    csv_text = "when,value\n" + "\n".join(rows)
    output = analyse(csv_text, time_column="when", methods={"time_series": {"enabled": True}})
    flagged = by_type(output, "time_series_deviation")
    assert [f.observed_value for f in flagged] == ["30"]
    assert output.results["charts"]["time_series"]["series"][0]["column"] == "value"
    without = analyse(csv_text, methods={"time_series": {"enabled": True}})
    report = next(m for m in without.results["methods"] if m["method"] == "rolling_median")
    assert report["status"] == "skipped" and without.results["charts"]["time_series"] is None


def test_time_series_even_window_still_scores_the_first_observation():
    rows = [f"2024-01-{i + 1:02d},{10 + (i % 3) * 0.1:.1f}" for i in range(28)]
    rows[0] = "2024-01-01,30"
    output = analyse("when,value\n" + "\n".join(rows), time_column="when",
                     methods={"time_series": {"enabled": True, "window": 4}})
    assert [f.row_numbers for f in by_type(output, "time_series_deviation")] == [[1]]


def test_declared_numeric_column_without_numbers_is_not_called_constant():
    output = analyse("v,w\n" + "\n".join(f"x{i},{i}" for i in range(20)), expected_types={"v": "numeric"})
    report = next(m for m in output.results["methods"] if m["method"] == "iqr")
    reasons = {s["column"]: s["reason"] for s in report["columns_skipped"]}
    assert reasons["v"] == "no valid numeric value"


def test_outlier_recommendation_counts_every_statistical_method():
    output = analyse(normal_csv(100, extra=["S9999,15.0,3.0,A"]), id_column="id",
                     methods={"iqr": {"enabled": False}})
    rec = next(r for r in output.results["recommendations"] if r["id"] == "R-OUTLIERS")
    statistical = output.results["metrics"]["statistical_findings"]
    assert rec["trigger"]["label"] == "Statistical anomalies"
    assert rec["trigger"]["count"] == statistical > 0


def test_outliers_are_flagged_by_several_methods_get_medium_priority():
    output = analyse(normal_csv(100, extra=["S9999,15.0,3.0,A"]), id_column="id")
    extreme = [f for f in output.findings if f.is_statistical and f.record_id == "S9999" and f.column == "glucose"]
    assert {f.method for f in extreme} >= {"iqr", "zscore"}
    assert all(f.severity == "medium" for f in extreme)


def test_small_and_unsuitable_datasets_do_not_crash():
    output = analyse("name,value\nA,1\nB,2\n")
    statuses = {m["method"]: m["status"] for m in output.results["methods"]}
    assert statuses["iqr"] == "skipped" and statuses["zscore"] == "skipped"
    assert statuses["isolation_forest"] == "skipped" and statuses["rolling_median"] == "disabled"
    assert output.results["charts"]["correlation"] is None and output.results["charts"]["scatter"] is None
    text_only = analyse("a,b\nx,y\nz,w\n")
    assert text_only.results["numeric_columns"] == []


def test_empty_dataset_and_unknown_columns_are_rejected():
    with pytest.raises(AnalysisError, match="no data rows"):
        analyse("a,b\n")
    with pytest.raises(AnalysisError, match="Unknown column"):
        analyse("a\n1\n", columns=["nope"])


def test_quality_score_ignores_statistical_outliers():
    output = analyse(normal_csv(80, extra=["S9999,50.0,3.0,A"]))
    assert output.results["metrics"]["anomalies_flagged"] >= 1
    assert output.quality_score == 100.0
    worse = analyse("a,b\n1,\n2,x\n2,x\n")
    components = worse.results["quality_score"]["components"]
    assert components["completeness"] < 100 and components["uniqueness"] < 100
    assert worse.quality_score < 100


def test_histogram_keeps_extreme_values_in_tail_bins():
    output = analyse(normal_csv(200, extra=["S9999,95.4,3.0,A"]))
    bins = next(d for d in output.results["charts"]["distributions"] if d["column"] == "glucose")["bins"]
    assert bins[-1]["tail"] == "high" and bins[-1]["count"] == 1 and bins[-1]["flagged"] == 1
    inner = [b for b in bins if not b["tail"]]
    assert len(inner) >= 5 and max(b["count"] for b in inner) < 200 * 0.5  # not squashed into one bar
    assert sum(b["count"] for b in bins) == 201


def test_findings_are_capped_but_counts_stay_exact():
    values = [str(i) for i in range(5)] + [f"bad{i}" for i in range(30)]
    output = analyse("v\n" + "\n".join(values), max_findings=10, expected_types={"v": "numeric"})
    assert len(output.findings) == 10
    assert output.results["truncated"] is True
    assert output.results["findings_total"] == 30
    assert output.results["metrics"]["invalid_cells"] == 30


def test_recommendations_reference_their_trigger():
    output = analyse("id,v\nA,1\nA,1\nB,\n", key_columns=["id"])
    recs = {r["id"]: r for r in output.results["recommendations"]}
    assert {"R-MISSING", "R-DUPLICATE-ROWS", "R-DUPLICATE-KEYS"} <= set(recs)
    assert recs["R-DUPLICATE-KEYS"]["trigger"]["columns"] == ["id"]
    assert all(r["reason"] and r["action"] for r in recs.values())


def test_csv_cells_are_protected_against_formula_injection():
    assert safe_cell("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("-3.5") == "-3.5"
    assert safe_cell("+33 1 23") == "'+33 1 23"


# ---------- API ----------


def upload(client, user, content: bytes | str, name: str = "results.csv", sheet: str | None = None):
    if isinstance(content, str):
        content = content.encode("utf-8")
    data = {"sheet": sheet} if sheet else {}
    return client.post("/api/labvision/datasets/preview", files={"file": (name, content, "text/csv")}, data=data,
                       headers=auth(user))


def analyze(client, user, dataset_id: str, **config):
    return client.post("/api/labvision/datasets/analyze", json={"dataset_id": dataset_id, **config}, headers=auth(user))


@pytest.fixture()
def staff2(db):
    return _make_user(db, "staff2@test.local", "staff")


@pytest.fixture()
def analysis(client, users):
    preview = upload(client, users["staff"], normal_csv(60, extra=["S9999,=1+2,3.0,A", "S9998,40,3.0,A", ""]))
    assert preview.status_code == 201, preview.text
    response = analyze(client, users["staff"], preview.json()["dataset_id"], id_column="id",
                       ranges={"glucose": {"min": 0, "max": 30}})
    assert response.status_code == 201, response.text
    return response.json()


def test_labvision_requires_staff(client, users):
    assert client.get("/api/labvision/config").status_code == 401
    assert client.get("/api/labvision/config", headers=auth(users["patient"])).status_code == 403
    assert upload(client, users["patient"], "a\n1\n").status_code == 403
    config = client.get("/api/labvision/config", headers=auth(users["staff"])).json()
    assert config["limits"]["max_rows"] > 0 and "formula" in config["quality_score"]


def test_preview_returns_profile_and_server_side_identifier(client, users):
    response = upload(client, users["staff"], "id,value\nA,1\nB,2\n", name="..\\..\\secret<script>.csv")
    assert response.status_code == 201
    body = response.json()
    assert body["name"].endswith("secretscript.csv") and not set(body["name"]) & set("\\/<>")
    assert len(body["dataset_id"]) >= 20 and body["dataset_id"] not in body["name"]
    assert body["row_count"] == 2 and body["column_count"] == 2
    assert [c["inferred_type"] for c in body["columns"]] == ["text", "integer"]
    assert body["preview_rows"] == [["A", "1"], ["B", "2"]]


def test_preview_excel_upload(client, users):
    content = xlsx_bytes({"Data": [["id", "value"], ["A", 1.5], ["B", 2.5]]})
    response = upload(client, users["staff"], content, name="book.xlsx")
    assert response.status_code == 201
    assert response.json()["file_type"] == "xlsx" and response.json()["sheets"] == ["Data"]


def test_invalid_and_oversized_uploads(client, users, services):
    bad = upload(client, users["staff"], "a,b\n1,2,3\n")
    assert bad.status_code == 422 and "Malformed CSV" in bad.json()["detail"]
    assert "Traceback" not in bad.text
    assert upload(client, users["staff"], "a\n1\n", name="data.exe").status_code == 422
    services.settings.labvision_max_upload_mb = 1
    big = upload(client, users["staff"], b"a\n" + b"1\n" * 700_000)
    assert big.status_code == 413
    services.settings.labvision_max_rows = 3
    assert upload(client, users["staff"], "a\n1\n2\n3\n4\n").status_code == 413


def test_analysis_flow_findings_and_review(client, users, analysis):
    assert analysis["row_count"] == 62 and analysis["finding_count"] > 0
    assert analysis["results"]["metrics"]["invalid_cells"] >= 2
    assert analysis["review_counts"]["pending"] == analysis["finding_count"]
    assert "dataset_id" not in analysis["config"]
    base = f"/api/labvision/analyses/{analysis['id']}"

    page = client.get(f"{base}/findings", params={"issue_type": "out_of_range"}, headers=auth(users["staff"])).json()
    assert page["total"] == 1
    finding = page["items"][0]
    assert finding["observed_value"] == "40" and finding["record_id"] == "S9998"
    assert "glucose" in page["facets"]["column"]

    search = client.get(f"{base}/findings", params={"q": "S9999"}, headers=auth(users["staff"])).json()
    assert search["total"] >= 1

    reviewed = client.patch(f"/api/labvision/findings/{finding['id']}/review",
                            json={"status": "confirmed", "note": "Transcription error"}, headers=auth(users["staff"]))
    assert reviewed.status_code == 200
    body = reviewed.json()
    assert body["review_status"] == "confirmed" and body["reviewer_name"] == "staff"
    assert body["observed_value"] == "40"  # machine finding preserved
    confirmed = client.get(f"{base}/findings", params={"review_status": "confirmed"}, headers=auth(users["staff"]))
    assert confirmed.json()["total"] == 1
    undone = client.patch(f"/api/labvision/findings/{finding['id']}/review", json={"status": "pending"},
                          headers=auth(users["staff"])).json()
    assert undone["reviewed_by"] is None and undone["reviewed_at"] is None

    invalid = client.patch(f"/api/labvision/findings/{finding['id']}/review", json={"status": "approved"},
                           headers=auth(users["staff"]))
    assert invalid.status_code == 422


def test_users_cannot_access_each_others_data(client, users, staff2, analysis):
    base = f"/api/labvision/analyses/{analysis['id']}"
    for other in (staff2, users["admin"]):
        headers = auth(other)
        assert client.get(base, headers=headers).status_code == 404
        assert client.get(f"{base}/findings", headers=headers).status_code == 404
        assert client.get(f"{base}/findings.csv", headers=headers).status_code == 404
        assert client.get(f"{base}/report", headers=headers).status_code == 404
        assert client.delete(base, headers=headers).status_code == 404
        assert client.get("/api/labvision/analyses", headers=headers).json() == []
    finding_id = client.get(f"{base}/findings", headers=auth(users["staff"])).json()["items"][0]["id"]
    assert client.patch(f"/api/labvision/findings/{finding_id}/review", json={"status": "confirmed"},
                        headers=auth(staff2)).status_code == 404

    dataset_id = upload(client, users["staff"], "a\n1\n").json()["dataset_id"]
    assert analyze(client, staff2, dataset_id).status_code == 404
    assert client.delete(f"/api/labvision/datasets/{dataset_id}", headers=auth(staff2)).status_code == 404
    assert analyze(client, users["staff"], dataset_id).status_code == 201


def test_analyze_validation_errors(client, users):
    dataset_id = upload(client, users["staff"], "a,b\n1,2\n").json()["dataset_id"]
    assert analyze(client, users["staff"], "unknown-dataset-id").status_code == 404
    assert analyze(client, users["staff"], dataset_id, columns=["zzz"]).status_code == 422
    assert analyze(client, users["staff"], dataset_id, methods={"iqr": {"k": 0}}).status_code == 422
    assert analyze(client, users["staff"], dataset_id,
                   methods={"isolation_forest": {"contamination": 0.9}}).status_code == 422
    assert analyze(client, users["staff"], dataset_id, ranges={"a": {"min": 5, "max": 1}}).status_code == 422
    assert analyze(client, users["staff"], "../../etc").status_code == 422
    header_only = upload(client, users["staff"], "a,b\n").json()
    assert header_only["row_count"] == 0 and header_only["warnings"]
    response = analyze(client, users["staff"], header_only["dataset_id"])
    assert response.status_code == 422 and "no data rows" in response.json()["detail"]


def test_discarded_or_expired_dataset_cannot_be_analysed(client, users, services):
    dataset_id = upload(client, users["staff"], "a\n1\n").json()["dataset_id"]
    assert client.delete(f"/api/labvision/datasets/{dataset_id}", headers=auth(users["staff"])).status_code == 204
    assert analyze(client, users["staff"], dataset_id).status_code == 404
    dataset_id = upload(client, users["staff"], "a\n1\n").json()["dataset_id"]
    services.labvision.datasets._items[dataset_id].expires_at = utcnow() - timedelta(seconds=1)
    assert analyze(client, users["staff"], dataset_id).status_code == 404
    assert len(services.labvision.datasets) == 0


def test_dataset_store_keeps_a_bounded_number_per_user(client, users, services):
    ids = [upload(client, users["staff"], "a\n1\n").json()["dataset_id"] for _ in range(5)]
    limit = services.settings.labvision_max_datasets_per_user
    assert len(services.labvision.datasets) == limit
    assert analyze(client, users["staff"], ids[0]).status_code == 404
    assert analyze(client, users["staff"], ids[-1]).status_code == 201


def test_reports_and_exports(client, users, analysis):
    base = f"/api/labvision/analyses/{analysis['id']}"
    pdf = client.get(f"{base}/report", headers=auth(users["staff"]))
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF") and len(pdf.content) > 2000
    assert f"labvision-report-{analysis['id']}.pdf" in pdf.headers["content-disposition"]
    with_examples = client.get(f"{base}/report", params={"include_examples": True}, headers=auth(users["staff"]))
    assert len(with_examples.content) > len(pdf.content)

    csv_response = client.get(f"{base}/findings.csv", params={"category": "data_quality"}, headers=auth(users["staff"]))
    assert csv_response.status_code == 200 and "text/csv" in csv_response.headers["content-type"]
    text = csv_response.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("finding_id,row_numbers,record_id")
    assert "human_review_status" in text.splitlines()[0]
    assert "'=1+2" in text and ",=1+2" not in text
    assert "Statistical" not in text and "statistical_outlier" not in text


def test_history_delete_and_retention(client, users, analysis, services, db):
    history = client.get("/api/labvision/analyses", headers=auth(users["staff"])).json()
    assert [a["id"] for a in history] == [analysis["id"]]
    record = db.get(LabVisionAnalysis, analysis["id"])
    record.expires_at = utcnow() - timedelta(days=1)
    db.commit()
    assert client.get(f"/api/labvision/analyses/{analysis['id']}", headers=auth(users["staff"])).status_code == 404
    assert services.labvision.purge_expired(db) == 1
    assert db.query(LabVisionFinding).count() == 0

    dataset_id = upload(client, users["staff"], "a\n1\n").json()["dataset_id"]
    second = analyze(client, users["staff"], dataset_id).json()
    assert client.delete(f"/api/labvision/analyses/{second['id']}", headers=auth(users["staff"])).status_code == 204
    assert client.get(f"/api/labvision/analyses/{second['id']}", headers=auth(users["staff"])).status_code == 404


def test_cleaning_preview_never_changes_the_dataset(client, users):
    dataset_id = upload(client, users["staff"], "a,b,c\n 1 ,NA,\n 1 ,NA,\n2,3,\n").json()["dataset_id"]
    ops = {"trim_whitespace": True, "normalise_missing_tokens": True, "drop_exact_duplicates": True,
           "drop_empty_columns": True}
    preview = client.post(f"/api/labvision/datasets/{dataset_id}/cleaning-preview", json=ops,
                          headers=auth(users["staff"])).json()
    assert preview["rows_before"] == 3 and preview["rows_after"] == 2
    assert preview["removed_rows"] == [2] and preview["removed_columns"] == ["c"]
    assert preview["cells_changed"] == 4
    copy = client.post(f"/api/labvision/datasets/{dataset_id}/cleaned-copy", json=ops, headers=auth(users["staff"]))
    assert copy.status_code == 200 and copy.content.decode("utf-8-sig").splitlines() == ["a,b", "1,", "2,3"]
    analysis = analyze(client, users["staff"], dataset_id).json()
    assert analysis["results"]["metrics"]["duplicate_rows"] == 1  # original data still analysed


def test_llm_explanation_is_labelled_and_uses_aggregates_only(client, users, analysis, llm):
    response = client.post(f"/api/labvision/analyses/{analysis['id']}/explanation", headers=auth(users["staff"]))
    assert response.status_code == 200
    explanation = response.json()["explanation"]
    assert explanation["text"].startswith("Test answer") and explanation["model"] == "test-llm"
    prompt = "\n".join(m["content"] for m in llm.calls[-1])
    assert "S9998" not in prompt and "=1+2" not in prompt  # no record identifiers or raw values
    assert "Use ONLY the facts" in prompt

    llm.fail_next = True
    failed = client.post(f"/api/labvision/analyses/{analysis['id']}/explanation", headers=auth(users["staff"]))
    assert failed.status_code == 503
