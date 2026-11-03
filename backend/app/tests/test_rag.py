import io

import pytest

from app.models import Document
from app.services.rag.chunking import chunk_pages
from app.services.rag.extraction import PageText, extract_pages
from app.services.rag.validation import UploadValidationError, validate_upload
from app.tests.conftest import auth

GUIDE = (
    "Fasting guide. Before a lipid panel blood test the patient must fast for twelve hours. Water is allowed.\n\n"
    "Urine collection. Collect the first morning urine in a sterile container and bring it within two hours.\n\n"
    "Parking. Free parking is available behind the building for patients during opening hours."
)


def make_pdf(pages: list[str]) -> bytes:
    """Build a minimal valid PDF with one text line per page."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode()}\nendstream")
        content_id = len(objects)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            "/Resources << /Font << /F1 3 0 R >> >> >>"
        )
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def make_docx(paragraphs: list[str]) -> bytes:
    import docx

    document = docx.Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# ---------- validation / extraction / chunking ----------
@pytest.mark.parametrize(
    "name,content,message",
    [
        ("virus.exe", b"MZ...", "Only PDF"),
        ("fake.pdf", b"not a pdf", "valid PDF"),
        ("fake.docx", b"PK\x03\x04garbage", "valid DOCX"),
        ("binary.txt", b"abc\x00def", "binary"),
        ("empty.txt", b"", "empty"),
    ],
)
def test_upload_validation_rejects(name, content, message):
    with pytest.raises(UploadValidationError, match=message):
        validate_upload(name, content, 1024 * 1024)


def test_upload_validation_size_limit():
    with pytest.raises(UploadValidationError, match="limit"):
        validate_upload("big.txt", b"a" * 2048, 1024)


def test_pdf_and_docx_extraction(tmp_path):
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(make_pdf(["First page about fasting", "Second page about urine"]))
    assert validate_upload("doc.pdf", pdf.read_bytes(), 10**6) == "pdf"
    pages = extract_pages(pdf, "pdf")
    assert [p.page for p in pages] == [1, 2]
    assert "urine" in pages[1].text

    docx_path = tmp_path / "doc.docx"
    docx_path.write_bytes(make_docx(["Procédure de centrifugation", "Conserver entre 2 et 8 °C"]))
    assert validate_upload("doc.docx", docx_path.read_bytes(), 10**6) == "docx"
    assert "centrifugation" in extract_pages(docx_path, "docx")[0].text


def test_chunking_respects_size_and_pages():
    pages = [PageText(1, "Sentence one is here. " * 40), PageText(2, "Another page sentence. " * 5)]
    chunks = chunk_pages(pages, size=200, overlap=40)
    assert all(len(c.text) <= 200 for c in chunks)
    assert {c.page for c in chunks} == {1, 2}
    assert [c.index for c in chunks] == list(range(len(chunks)))


# ---------- API: upload, retrieve, update, delete ----------
def upload(client, user, name, content, visibility="public", title=None):
    data = {"visibility": visibility}
    if title:
        data["title"] = title
    return client.post("/api/documents", files={"file": (name, content)}, data=data, headers=auth(user))


def test_upload_index_and_search(client, users, services):
    response = upload(client, users["staff"], "guide.txt", GUIDE.encode(), title="Patient guide")
    assert response.status_code == 202
    doc_id = response.json()["id"]
    document = client.get(f"/api/documents/{doc_id}", headers=auth(users["staff"])).json()
    assert document["status"] == "indexed", document["error"]
    assert document["num_chunks"] >= 1
    assert services.store.size == document["num_chunks"]

    hits = client.post("/api/documents/search", json={"query": "fast before lipid panel"}, headers=auth(users["staff"]))
    assert hits.status_code == 200
    top = hits.json()[0]
    assert top["document_id"] == doc_id and "twelve hours" in top["excerpt"]


def test_upload_rejected_for_patient_and_bad_type(client, users):
    assert upload(client, users["patient"], "guide.txt", GUIDE.encode()).status_code == 403
    assert upload(client, users["staff"], "guide.exe", b"MZ").status_code == 422


def test_staff_documents_hidden_from_patients(client, users, services, db):
    upload(client, users["staff"], "internal.txt", b"Internal centrifuge rotor balancing procedure for technicians.",
           visibility="staff")
    assert services.rag.retrieve(db, "centrifuge rotor balancing", is_staff=True)
    assert services.rag.retrieve(db, "centrifuge rotor balancing", is_staff=False) == []


def test_replace_file_reindexes_new_version(client, users, services, db):
    doc_id = upload(client, users["staff"], "hours.txt", b"The laboratory opens at seven on weekdays.").json()["id"]
    response = client.put(
        f"/api/documents/{doc_id}/file",
        files={"file": ("hours.txt", b"The laboratory now opens at eight thirty on weekdays.")},
        headers=auth(users["staff"]),
    )
    assert response.status_code == 202
    document = db.get(Document, doc_id)
    db.refresh(document)
    assert document.version == 2 and document.status == "indexed"
    texts = [h.text for h in services.rag.retrieve(db, "laboratory opens weekdays", is_staff=True)]
    assert texts and all("eight thirty" in t for t in texts)


def test_delete_removes_vectors(client, users, services, db):
    doc_id = upload(client, users["staff"], "guide.txt", GUIDE.encode()).json()["id"]
    assert services.store.size > 0
    assert client.delete(f"/api/documents/{doc_id}", headers=auth(users["staff"])).status_code == 204
    assert services.store.size == 0
    assert services.rag.retrieve(db, "lipid panel fasting", is_staff=True) == []


def test_failed_extraction_marks_document_failed(client, users, db):
    doc_id = upload(client, users["staff"], "scan.pdf", make_pdf([""])).json()["id"]
    document = db.get(Document, doc_id)
    db.refresh(document)
    assert document.status == "failed"
    assert "No extractable text" in document.error
