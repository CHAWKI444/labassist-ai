"""CSV export of findings and PDF summary report. Raw records are excluded from the PDF unless requested."""

import csv
import io
import re
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import HorizontalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.labvision import LabVisionAnalysis, LabVisionFinding
from app.services.labvision.findings import ISSUE_LABELS, METHOD_LABELS

PRIMARY = colors.HexColor("#176B87")
SECONDARY = colors.HexColor("#35B6A0")
MUTED = colors.HexColor("#64748B")
GRID = colors.HexColor("#E2E8F0")
SURFACE = colors.HexColor("#F1F5F9")
REVIEW_LABELS = {
    "pending": "Pending review",
    "confirmed": "Confirmed issue",
    "expected": "Expected observation",
    "false_positive": "False positive",
}
_NUMBER = re.compile(r"^[+-]?\d+([.,]\d+)?([eE][+-]?\d+)?$")
CSV_COLUMNS = [
    "finding_id", "row_numbers", "record_id", "column", "observed_value", "category", "issue_type", "method",
    "severity", "score", "threshold", "explanation", "suggested_action",
    "human_review_status", "human_review_note", "human_reviewed_by", "human_reviewed_at",
]


def safe_cell(value) -> str:
    """Neutralise spreadsheet formulas (CSV injection) while keeping plain numbers readable."""
    if value is None:
        return ""
    text = str(value)
    if text and text[0] in "=+-@\t\r" and not _NUMBER.match(text):
        return "'" + text
    return text


def findings_csv(findings: list[LabVisionFinding], reviewers: dict[int, str]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for f in findings:
        writer.writerow([safe_cell(v) for v in (
            f.id,
            " ".join(str(r) for r in f.row_numbers) + (" ..." if f.affected_count > len(f.row_numbers) else ""),
            f.record_id,
            f.column,
            f.observed_value,
            f.category,
            ISSUE_LABELS.get(f.issue_type, f.issue_type),
            METHOD_LABELS.get(f.method, f.method),
            f.severity,
            "" if f.score is None else f"{f.score:g}",
            f.threshold,
            f.explanation,
            f.suggested_action,
            REVIEW_LABELS.get(f.review_status, f.review_status),
            f.review_note,
            reviewers.get(f.reviewed_by) if f.reviewed_by else "",
            f.reviewed_at.isoformat() if f.reviewed_at else "",
        )])
    # BOM so that Excel opens UTF-8 correctly.
    return "\ufeff" + buffer.getvalue()


def _p(text, style) -> Paragraph:
    return Paragraph(escape(str(text)), style)


def _table(rows: list[list], widths: list[float], header: bool = True) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    commands = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), SURFACE), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8)]
    table.setStyle(TableStyle(commands))
    return table


def _bar_chart(title: str, items: list[tuple[str, float]], color, value_label: str) -> Drawing | None:
    items = [(label[:32], value) for label, value in items if value][:12]
    if not items:
        return None
    height = 30 + 16 * len(items)
    drawing = Drawing(170 * mm, height + 20)
    drawing.add(String(0, height + 8, title, fontName="Helvetica-Bold", fontSize=9, fillColor=colors.black))
    chart = HorizontalBarChart()
    chart.x, chart.y = 120, 18
    chart.width, chart.height = 340, height - 20
    chart.data = [[v for _, v in reversed(items)]]
    chart.categoryAxis.categoryNames = [label for label, _ in reversed(items)]
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.dx = -4
    chart.categoryAxis.labels.boxAnchor = "e"
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontSize = 7
    chart.bars[0].fillColor = color
    chart.bars[0].strokeColor = None
    chart.barLabelFormat = "%g"
    chart.barLabels.fontSize = 7
    chart.barLabels.boxAnchor = "w"
    chart.barLabels.dx = 3
    drawing.add(chart)
    drawing.add(String(chart.x + chart.width, 2, value_label, fontName="Helvetica", fontSize=7,
                       fillColor=MUTED, textAnchor="end"))
    return drawing


def analysis_pdf(
    analysis: LabVisionAnalysis,
    review_counts: dict[str, int],
    generated_by: str,
    examples: list[LabVisionFinding] | None = None,
) -> bytes:
    results = analysis.results
    metrics = results.get("metrics", {})
    score = results.get("quality_score", {})
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10, textColor=MUTED)
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=17, textColor=PRIMARY, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=PRIMARY, spaceBefore=10, spaceAfter=4)
    cell = ParagraphStyle("cell", parent=body, fontSize=8, leading=10)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=f"LabVision AI report #{analysis.id}", author="LabAssist AI")
    story: list = [
        Paragraph("LabVision AI \u2014 Data quality &amp; anomaly report", h1),
        _p(f"Analysis #{analysis.id} \u00b7 generated {datetime.now().astimezone():%Y-%m-%d %H:%M %Z} "
           f"by {generated_by}", small),
        Spacer(1, 4),
        _p(results.get("safety_notice", ""), small),
        Paragraph("Dataset", h2),
        _table([
            ["Dataset", _p(analysis.dataset_name, cell)],
            ["File type", analysis.file_type.upper() + (f" (sheet: {analysis.sheet_name})" if analysis.sheet_name else "")],
            ["Size", f"{analysis.size_bytes:,} bytes"],
            ["SHA-256", analysis.sha256[:32] + "\u2026"],
            ["Analysed at", f"{analysis.created_at:%Y-%m-%d %H:%M UTC}"],
            ["Rows / columns", f"{analysis.row_count:,} rows \u00b7 {analysis.column_count} columns "
                               f"({metrics.get('columns_analyzed', 0)} analysed)"],
        ], [40 * mm, 138 * mm], header=False),
        Paragraph("Data quality metrics", h2),
    ]
    components = score.get("components", {})
    story.append(_table([
        ["Metric", "Value", "Definition"],
        ["Quality score", "n/a" if score.get("value") is None else f"{score['value']} / 100",
         _p(score.get("formula", ""), cell)],
        ["Completeness", f"{components.get('completeness', 'n/a')}%", _p(score.get("definitions", {}).get("completeness", ""), cell)],
        ["Validity", f"{components.get('validity', 'n/a')}%", _p(score.get("definitions", {}).get("validity", ""), cell)],
        ["Uniqueness", f"{components.get('uniqueness', 'n/a')}%", _p(score.get("definitions", {}).get("uniqueness", ""), cell)],
        ["Missing values", f"{metrics.get('missing_cells', 0):,} ({metrics.get('missing_pct', 0)}%)", "Missing cells among analysed cells"],
        ["Duplicate rows", f"{metrics.get('duplicate_rows', 0):,}", "Rows identical to an earlier row"],
        ["Duplicate keys", f"{metrics.get('duplicate_key_rows', 0):,}", _p("Rows repeating a key value of: "
                                                                          + (", ".join(metrics.get("key_columns") or []) or "no key selected"), cell)],
        ["Invalid values", f"{metrics.get('invalid_cells', 0):,}", "Type errors, invalid dates, range and rule violations"],
        ["Statistical anomalies", f"{metrics.get('anomalies_flagged', 0):,}", "Observations flagged by at least one method"],
    ], [38 * mm, 32 * mm, 108 * mm]))
    story.append(_p(score.get("excluded", ""), small))

    charts = results.get("charts", {})
    missing_chart = _bar_chart("Missing values by column", [(m["column"], m["missing"]) for m in sorted(
        charts.get("missing_by_column", []), key=lambda m: -m["missing"])], PRIMARY, "missing cells")
    issue_chart = _bar_chart("Findings by type", [(i["label"], i["count"]) for i in charts.get("issue_counts", [])],
                             SECONDARY, "findings")
    for chart in (missing_chart, issue_chart):
        if chart is not None:
            story += [Spacer(1, 6), chart]

    story.append(Paragraph("Detected issues", h2))
    issue_rows = [["Issue", "Category", "Findings"]] + [
        [i["label"], "Data quality" if i["category"] == "data_quality" else "Statistical outlier", f"{i['count']:,}"]
        for i in charts.get("issue_counts", [])
    ]
    story.append(_table(issue_rows, [80 * mm, 60 * mm, 38 * mm]) if len(issue_rows) > 1 else _p("No issues found.", body))
    if results.get("truncated"):
        story.append(_p(f"{results['findings_total']:,} findings produced; {results['findings_stored']:,} stored.", small))

    story.append(Paragraph("Methods and parameters", h2))
    method_rows = [["Method", "Status", "Parameters", "Flagged", "Notes"]]
    for m in results.get("methods", []):
        params = ", ".join(f"{k}={v}" for k, v in m.get("parameters", {}).items() if k != "columns")
        notes = list(m.get("notes", []))
        skipped = m.get("columns_skipped", [])
        if m["status"] == "applied" and m.get("columns_applied"):
            notes.insert(0, "Columns: " + ", ".join(m["columns_applied"][:8]))
        if skipped:
            notes.append(f"{len(skipped)} column(s) not suitable")
        method_rows.append([_p(m["label"], cell), m["status"], _p(params, cell), str(m.get("flagged", 0)),
                            _p("; ".join(notes), cell)])
    story.append(_table(method_rows, [32 * mm, 18 * mm, 48 * mm, 16 * mm, 64 * mm]))

    story.append(Paragraph("Human review status", h2))
    total_reviews = sum(review_counts.values())
    story.append(_table([["Status", "Findings"]] + [[REVIEW_LABELS[k], f"{review_counts.get(k, 0):,}"] for k in REVIEW_LABELS],
                        [80 * mm, 40 * mm]) if total_reviews else _p("No stored findings.", body))

    story.append(Paragraph("Recommendations", h2))
    recommendations = results.get("recommendations", [])
    if not recommendations:
        story.append(_p("No recommendation was triggered.", body))
    for rec in recommendations:
        story.append(KeepTogether([
            Paragraph(f"<b>{escape(rec['title'])}</b> <font color='#64748B'>({escape(rec['severity'])} \u00b7 rule "
                      f"{escape(rec['id'])})</font>", body),
            _p(f"Reason: {rec['reason']}", cell),
            _p(f"Action: {rec['action']}", cell),
            Spacer(1, 4),
        ]))

    if analysis.explanation and analysis.explanation.get("text"):
        story.append(Paragraph("AI-generated explanation (not verified evidence)", h2))
        story.append(_p(f"Generated by {analysis.explanation.get('model', 'language model')} from the structured "
                        "results above. It may contain errors; the measured results take precedence.", small))
        for paragraph in str(analysis.explanation["text"]).split("\n"):
            if paragraph.strip():
                story.append(_p(paragraph, body))

    if examples:
        story.append(Paragraph("Example findings (includes record values)", h2))
        rows = [["Rows", "Column", "Value", "Issue", "Review"]]
        for f in examples:
            rows.append([_p(", ".join(map(str, f.row_numbers[:5])), cell), _p(f.column or "\u2014", cell),
                         _p((f.observed_value or "")[:60], cell), _p(ISSUE_LABELS.get(f.issue_type, f.issue_type), cell),
                         REVIEW_LABELS.get(f.review_status, f.review_status)])
        story.append(_table(rows, [24 * mm, 36 * mm, 40 * mm, 44 * mm, 34 * mm]))

    story.append(Paragraph("Limitations", h2))
    for item in results.get("limitations", []) + results.get("notes", []):
        story.append(_p(f"\u2022 {item}", cell))
    doc.build(story)
    return buffer.getvalue()
