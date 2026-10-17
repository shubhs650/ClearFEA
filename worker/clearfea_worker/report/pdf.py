# SPDX-License-Identifier: AGPL-3.0-or-later
"""Turns the Word report into its PDF (M7.4, ADR-078).

The PDF is the DOCX printed by LibreOffice Writer, so its pages are the Word file's pages: the same
sections, tables, figures, headers and "Page n of N" footers, with nothing laid out twice. Pictures
are kept lossless, so a contour plot is not blurred by JPEG. Each conversion uses its own
LibreOffice profile in a temporary folder, so two jobs never share one.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

#: The LibreOffice program; CLEARFEA_SOFFICE names another.
SOFFICE = "soffice"
#: Longest a conversion may take. A report of a hundred figures converts in well under a minute.
TIMEOUT_S = 300
#: Writer's PDF export with pictures kept as they are (PNG figures stay PNG, not JPEG).
EXPORT_FILTER = 'pdf:writer_pdf_Export:{"UseLosslessCompression":{"type":"boolean","value":"true"}}'


class PdfError(Exception):
    """The PDF could not be made; the message says why."""


def soffice() -> str:
    return os.environ.get("CLEARFEA_SOFFICE") or SOFFICE


def write_pdf(docx: Path, path: Path, timeout_s: float = TIMEOUT_S) -> None:
    """Writes the PDF of the Word report `docx` to `path`."""
    program = shutil.which(soffice())
    if program is None:
        raise PdfError(f"LibreOffice ({soffice()}) is not installed on this worker.")
    with tempfile.TemporaryDirectory(prefix="clearfea-pdf-") as tmp:
        work = Path(tmp)
        out = work / "out"
        command = [
            program,
            f"-env:UserInstallation={(work / 'profile').as_uri()}",
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--convert-to",
            EXPORT_FILTER,
            "--outdir",
            str(out),
            str(docx),
        ]
        try:
            done = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout_s,
                env={**os.environ, "HOME": tmp},
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise PdfError(f"LibreOffice took longer than {timeout_s:g} s.") from None
        made = out / f"{docx.stem}.pdf"
        if done.returncode != 0 or not made.is_file():
            said = (done.stderr or done.stdout).strip()[-500:]
            raise PdfError(
                f"LibreOffice made no PDF (exit {done.returncode})" + (f": {said}" if said else ".")
            )
        if made.read_bytes()[:5] != b"%PDF-":
            raise PdfError("LibreOffice wrote a file that is not a PDF.")
        shutil.move(made, path)
