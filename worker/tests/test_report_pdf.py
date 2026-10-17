# SPDX-License-Identifier: AGPL-3.0-or-later
"""The report's PDF, printed from its Word file by LibreOffice (M7.4, ADR-078)."""

import re
import shutil
import stat
from pathlib import Path

import pytest

from clearfea_worker.report.docx import write_docx
from clearfea_worker.report.pdf import PdfError, write_pdf
from tests.test_report import build, png, static_params


def fake_soffice(tmp_path: Path, body: str) -> Path:
    """A stand-in for LibreOffice that records its arguments and then runs `body`."""
    program = tmp_path / "fake-soffice"
    program.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$@" > "{tmp_path}/args"\n'
        'while [ "$1" != "--outdir" ]; do shift; done\n'
        'out="$2"; doc="$3"; name=$(basename "$doc" .docx)\n' + body
    )
    program.chmod(program.stat().st_mode | stat.S_IXUSR)
    return program


def test_converts_with_a_private_profile_and_lossless_pictures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes = 'mkdir -p "$out"; printf "%%PDF-1.7 fake" > "$out/$name.pdf"\n'
    program = fake_soffice(tmp_path, writes)
    monkeypatch.setenv("CLEARFEA_SOFFICE", str(program))
    (tmp_path / "report.docx").write_bytes(b"docx")
    write_pdf(tmp_path / "report.docx", tmp_path / "report.pdf")
    assert (tmp_path / "report.pdf").read_bytes() == b"%PDF-1.7 fake"
    args = (tmp_path / "args").read_text().splitlines()
    assert "--headless" in args
    assert args[args.index("--convert-to") + 1].startswith("pdf:writer_pdf_Export:")
    assert '"UseLosslessCompression"' in args[args.index("--convert-to") + 1]
    profile = next(a for a in args if a.startswith("-env:UserInstallation=file://"))
    assert "clearfea-pdf-" in profile
    assert args[-1] == str(tmp_path / "report.docx")


@pytest.mark.parametrize(
    ("body", "problem"),
    [
        ('echo "source file could not be loaded" >&2; exit 1\n', "could not be loaded"),
        ("exit 0\n", "made no PDF"),
        ('mkdir -p "$out"; echo "<html>" > "$out/$name.pdf"\n', "not a PDF"),
    ],
)
def test_says_why_no_pdf_was_made(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, body: str, problem: str
) -> None:
    monkeypatch.setenv("CLEARFEA_SOFFICE", str(fake_soffice(tmp_path, body)))
    (tmp_path / "report.docx").write_bytes(b"docx")
    with pytest.raises(PdfError, match=problem):
        write_pdf(tmp_path / "report.docx", tmp_path / "report.pdf")
    assert not (tmp_path / "report.pdf").exists()


def test_a_slow_conversion_is_stopped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEARFEA_SOFFICE", str(fake_soffice(tmp_path, "sleep 5\n")))
    (tmp_path / "report.docx").write_bytes(b"docx")
    with pytest.raises(PdfError, match="longer than 0.5 s"):
        write_pdf(tmp_path / "report.docx", tmp_path / "report.pdf", timeout_s=0.5)


def test_a_missing_libreoffice_is_named(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEARFEA_SOFFICE", str(tmp_path / "no-such-soffice"))
    with pytest.raises(PdfError, match="not installed"):
        write_pdf(tmp_path / "report.docx", tmp_path / "report.pdf")


def outline(pdf: bytes) -> list[str]:
    """The PDF's bookmark titles, which LibreOffice writes from the Word headings."""
    titles = re.findall(rb"/Title<FEFF([0-9A-F]*)>", pdf)
    return [bytes.fromhex(t.decode()).decode("utf-16-be") for t in titles]


# The worker image has LibreOffice (worker/Dockerfile) and E-05 prints a PDF through it at every
# phase end; the fast tier's runner may not, so this check runs only where it is installed.
@pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice is not installed here")
def test_the_pdf_has_the_word_reports_pages_and_headings(tmp_path: Path) -> None:
    for name in ("figure-0.png", "figure-1.png", "figure-2.png", "logo"):
        (tmp_path / name).write_bytes(png())
    document = build(static_params())
    write_docx(document, tmp_path, tmp_path / "report.docx", "2026-10-17T04:10:00.000Z")
    write_pdf(tmp_path / "report.docx", tmp_path / "report.pdf")
    pdf = (tmp_path / "report.pdf").read_bytes()
    assert pdf.startswith(b"%PDF-")
    assert len(re.findall(rb"/Type\s*/Page[^s]", pdf)) >= 4  # the cover and the sections
    headings = outline(pdf)  # LibreOffice writes the heading's two spaces as one
    for number, section in enumerate(document.sections, start=1):
        assert f"{number} {section.title}" in headings
    assert b"LiberationSans" in pdf  # Arial's stand-in, embedded
