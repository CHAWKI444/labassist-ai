"""LabVision AI: dataset quality and anomaly detection for laboratory staff.

Every analysis and finding belongs to the user who created it; other users (administrators included)
receive 404, as for conversations and memories.
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_services, require_staff
from app.models import User
from app.models.base import as_utc, utcnow
from app.models.labvision import LabVisionAnalysis, LabVisionFinding, ReviewStatus
from app.schemas.labvision import (
    AnalysisOut,
    AnalysisSummary,
    AnalyzeRequest,
    CategoryName,
    CleaningPreview,
    CleaningRequest,
    ColumnProfileOut,
    DatasetLimits,
    DatasetPreview,
    FindingOut,
    FindingPage,
    LabVisionConfig,
    MethodConfig,
    ReviewStatusName,
    ReviewUpdate,
    SeverityName,
)
from app.services.container import Services
from app.services.labvision.engine import QUALITY_SCORE_DOC, AnalysisError
from app.services.labvision.parsing import DatasetError, DatasetTooLarge
from app.services.labvision.profiling import MISSING_TOKENS
from app.services.labvision.report import analysis_pdf, findings_csv, safe_cell
from app.services.labvision.service import DatasetNotFound
from app.services.llm import LLMError

router = APIRouter(prefix="/labvision", tags=["labvision"])
logger = logging.getLogger(__name__)

DATASET_GONE = "The uploaded dataset has expired or does not exist. Upload the file again."
MULTIPART_OVERHEAD = 64 * 1024
TOO_LARGE = 413


def _dataset_error(exc: DatasetError) -> HTTPException:
    code = TOO_LARGE if isinstance(exc, DatasetTooLarge) else 422
    return HTTPException(code, str(exc))


def _owned_analysis(db: Session, user: User, analysis_id: int) -> LabVisionAnalysis:
    analysis = db.scalar(
        select(LabVisionAnalysis).where(LabVisionAnalysis.id == analysis_id, LabVisionAnalysis.user_id == user.id)
    )
    if analysis is None or as_utc(analysis.expires_at) < utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found")
    return analysis


def _analysis_out(db: Session, services: Services, analysis: LabVisionAnalysis) -> AnalysisOut:
    return AnalysisOut.model_validate(
        {**{c: getattr(analysis, c) for c in AnalysisOut.model_fields if c != "review_counts"},
         "review_counts": services.labvision.review_counts(db, analysis.id)}
    )


def _reviewer_names(db: Session, findings: list[LabVisionFinding]) -> dict[int, str]:
    ids = {f.reviewed_by for f in findings if f.reviewed_by}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all())


def _finding_out(finding: LabVisionFinding, names: dict[int, str]) -> FindingOut:
    return FindingOut.model_validate(
        {**{c: getattr(finding, c) for c in FindingOut.model_fields if c != "reviewer_name"},
         "reviewer_name": names.get(finding.reviewed_by) if finding.reviewed_by else None}
    )


@router.get("/config", response_model=LabVisionConfig)
def get_config(_: User = Depends(require_staff), services: Services = Depends(get_services)):
    return LabVisionConfig(
        limits=DatasetLimits(**services.labvision.limits()),
        defaults=MethodConfig(),
        missing_tokens=[t for t in MISSING_TOKENS if t],
        quality_score=QUALITY_SCORE_DOC,
        llm_model=getattr(services.llm, "model", None),
    )


# ----- datasets: parsed in memory, never written to disk -----


@router.post("/datasets/preview", response_model=DatasetPreview, status_code=status.HTTP_201_CREATED)
async def preview_dataset(
    request: Request,
    file: UploadFile = File(...),
    sheet: str | None = Form(default=None, max_length=120),
    user: User = Depends(require_staff),
    services: Services = Depends(get_services),
):
    limit = services.settings.labvision_max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + MULTIPART_OVERHEAD:
        raise HTTPException(TOO_LARGE, f"The file exceeds the {services.settings.labvision_max_upload_mb} MB limit.")
    content = await file.read(limit + 1)
    try:
        entry, profiles = await run_in_threadpool(
            services.labvision.preview, user, file.filename or "", content, sheet or None
        )
    except DatasetError as exc:
        raise _dataset_error(exc) from None
    parsed = entry.parsed
    return DatasetPreview(
        dataset_id=entry.id,
        name=entry.name,
        file_type=parsed.file_type,
        size_bytes=entry.size_bytes,
        sheet_name=parsed.sheet_name,
        sheets=parsed.sheets,
        encoding=parsed.encoding,
        delimiter=parsed.delimiter,
        row_count=int(parsed.frame.shape[0]),
        column_count=int(parsed.frame.shape[1]),
        columns=[ColumnProfileOut(**vars(p)) for p in profiles],
        preview_rows=services.labvision.preview_rows(entry),
        warnings=parsed.warnings,
        expires_at=entry.expires_at,
    )


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_dataset(dataset_id: str, user: User = Depends(require_staff), services: Services = Depends(get_services)):
    if not services.labvision.datasets.discard(user.id, dataset_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, DATASET_GONE)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/datasets/{dataset_id}/cleaning-preview", response_model=CleaningPreview)
async def cleaning_preview(
    dataset_id: str,
    payload: CleaningRequest,
    user: User = Depends(require_staff),
    services: Services = Depends(get_services),
):
    try:
        entry = services.labvision.get_dataset(user, dataset_id)
    except DatasetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, DATASET_GONE) from None
    _, preview = await run_in_threadpool(services.labvision.clean_copy, entry, payload)
    return preview


@router.post("/datasets/{dataset_id}/cleaned-copy")
async def cleaned_copy(
    dataset_id: str,
    payload: CleaningRequest,
    user: User = Depends(require_staff),
    services: Services = Depends(get_services),
):
    try:
        entry = services.labvision.get_dataset(user, dataset_id)
    except DatasetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, DATASET_GONE) from None
    frame, _ = await run_in_threadpool(services.labvision.clean_copy, entry, payload)
    text = "\ufeff" + frame.map(safe_cell).to_csv(index=False)
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="labvision-cleaned-copy.csv"'},
    )


@router.post("/datasets/analyze", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
async def analyze_dataset(
    payload: AnalyzeRequest,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    try:
        analysis = await run_in_threadpool(services.labvision.analyze, db, user, payload)
    except DatasetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, DATASET_GONE) from None
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:  # noqa: BLE001 - never echo internals; messages may contain cell values
        db.rollback()
        logger.error("LabVision analysis failed (%s)", type(exc).__name__)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            "The analysis failed unexpectedly. Nothing was stored.") from None
    return _analysis_out(db, services, analysis)


# ----- analyses and findings -----


@router.get("/analyses", response_model=list[AnalysisSummary])
def list_analyses(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    return db.scalars(
        select(LabVisionAnalysis)
        .where(LabVisionAnalysis.user_id == user.id, LabVisionAnalysis.expires_at >= utcnow())
        .order_by(LabVisionAnalysis.created_at.desc(), LabVisionAnalysis.id.desc())
        .limit(limit)
    ).all()


@router.get("/analyses/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: int,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    return _analysis_out(db, services, _owned_analysis(db, user, analysis_id))


@router.delete("/analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(analysis_id: int, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    db.delete(_owned_analysis(db, user, analysis_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _filtered_findings(
    analysis_id: int,
    column: str | None = Query(default=None, max_length=255),
    category: CategoryName | None = None,
    issue_type: str | None = Query(default=None, max_length=40),
    method: str | None = Query(default=None, max_length=40),
    severity: SeverityName | None = None,
    review_status: ReviewStatusName | None = None,
    q: str | None = Query(default=None, max_length=200),
):
    conditions = [LabVisionFinding.analysis_id == analysis_id]
    for field, value in (
        (LabVisionFinding.column, column),
        (LabVisionFinding.category, category),
        (LabVisionFinding.issue_type, issue_type),
        (LabVisionFinding.method, method),
        (LabVisionFinding.severity, severity),
        (LabVisionFinding.review_status, review_status),
    ):
        if value:
            conditions.append(field == value)
    if q and q.strip():
        literal = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{literal}%"
        conditions.append(or_(
            LabVisionFinding.column.ilike(pattern, escape="\\"),
            LabVisionFinding.record_id.ilike(pattern, escape="\\"),
            LabVisionFinding.observed_value.ilike(pattern, escape="\\"),
            LabVisionFinding.explanation.ilike(pattern, escape="\\"),
        ))
    return conditions


@router.get("/analyses/{analysis_id}/findings", response_model=FindingPage)
def list_findings(
    analysis_id: int,
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    conditions: list = Depends(_filtered_findings),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    _owned_analysis(db, user, analysis_id)
    total = db.scalar(select(func.count()).select_from(LabVisionFinding).where(*conditions)) or 0
    items = db.scalars(
        select(LabVisionFinding).where(*conditions).order_by(LabVisionFinding.id).limit(limit).offset(offset)
    ).all()
    facets = {}
    for name, field in (("column", LabVisionFinding.column), ("issue_type", LabVisionFinding.issue_type),
                        ("method", LabVisionFinding.method)):
        values = db.scalars(
            select(field).where(LabVisionFinding.analysis_id == analysis_id, field.is_not(None)).distinct()
        ).all()
        facets[name] = sorted(values)
    names = _reviewer_names(db, list(items))
    return FindingPage(total=total, items=[_finding_out(f, names) for f in items], facets=facets)


@router.get("/analyses/{analysis_id}/findings.csv")
def export_findings(
    analysis_id: int,
    conditions: list = Depends(_filtered_findings),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    _owned_analysis(db, user, analysis_id)
    findings = list(db.scalars(select(LabVisionFinding).where(*conditions).order_by(LabVisionFinding.id)).all())
    return Response(
        content=findings_csv(findings, _reviewer_names(db, findings)).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="labvision-findings-{analysis_id}.csv"'},
    )


@router.get("/analyses/{analysis_id}/report")
async def analysis_report(
    analysis_id: int,
    include_examples: bool = Query(default=False, description="Adds up to 50 findings with record values"),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    analysis = _owned_analysis(db, user, analysis_id)
    examples = None
    if include_examples:
        examples = list(db.scalars(
            select(LabVisionFinding).where(LabVisionFinding.analysis_id == analysis.id)
            .order_by(LabVisionFinding.id).limit(50)
        ).all())
    pdf = await run_in_threadpool(
        analysis_pdf, analysis, services.labvision.review_counts(db, analysis.id), user.full_name, examples
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="labvision-report-{analysis.id}.pdf"'},
    )


@router.post("/analyses/{analysis_id}/explanation", response_model=AnalysisOut)
async def explain_analysis(
    analysis_id: int,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    analysis = _owned_analysis(db, user, analysis_id)
    try:
        await services.labvision.explain(db, user, analysis)
    except LLMError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
    return _analysis_out(db, services, analysis)


@router.patch("/findings/{finding_id}/review", response_model=FindingOut)
def review_finding(
    finding_id: int,
    payload: ReviewUpdate,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    finding = db.scalar(
        select(LabVisionFinding)
        .join(LabVisionAnalysis, LabVisionAnalysis.id == LabVisionFinding.analysis_id)
        .where(LabVisionFinding.id == finding_id, LabVisionAnalysis.user_id == user.id,
               LabVisionAnalysis.expires_at >= utcnow())
    )
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")
    finding.review_status = payload.status
    finding.review_note = (payload.note or "").strip() or None
    if payload.status == ReviewStatus.PENDING:
        finding.reviewed_by, finding.reviewed_at = None, None
    else:
        finding.reviewed_by, finding.reviewed_at = user.id, utcnow()
    db.commit()
    db.refresh(finding)
    return _finding_out(finding, _reviewer_names(db, [finding]))
