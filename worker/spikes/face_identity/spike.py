# SPDX-License-Identifier: AGPL-3.0-or-later
"""M1.1 spike: prove the face identity chain (ARCHITECTURE.md section 3) on three models.

For each model and declared unit, in separate processes as the jobs will run:

1. import:  read the STEP unit ourselves, import with Gmsh in metres, write topology.json,
            tessellate every face and write display.bin with triangles grouped by face tag.
2. mesh:    re-import the STEP file in a fresh process, compare every face with
            topology.json, mesh the volume, and map every surface triangle to the
            tetrahedron face it lies on (face_map.json).

Each step checks itself geometrically (see ``check_faces``), and the orchestrator compares
the unit variants of a model. Run from worker/:

    uv run python spikes/face_identity/spike.py run --out /tmp/face-identity

Exit status is non-zero if any check fails.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

import gmsh
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import models  # noqa: E402
from step_units import detect_length_unit  # noqa: E402

from clearfea_worker.units import to_si  # noqa: E402

UNIT_VARIANTS = ("mm", "m", "in")
#: Two faces of the same geometry match if area and centroid agree to this, relative to the
#: model size. Re-importing the same file with the same versions should be exact.
REIMPORT_TOL = 1e-9
#: Element faces lying on a planar face must be on it to rounding; on a curved face the
#: chord sits off the surface by the sag, which this bounds relative to the element size.
PLANE_TOL = 1e-9
#: The display file stores float32 positions (about 7 significant digits), so display
#: triangles are only on a plane to that precision.
DISPLAY_PLANE_TOL = 1e-6
CURVED_SAG_FRACTION = 0.25


# --------------------------------------------------------------------------- helpers


def init_gmsh() -> None:
    gmsh.initialize(interruptible=False)
    gmsh.option.setNumber("General.Terminal", 0)
    gmsh.option.setNumber("General.NumThreads", 1)


def import_step(path: Path, confirmed: str | None = None) -> dict:
    """Detect the declared unit, then import with every length converted to metres.

    ``confirmed`` is the unit the user says the file is really in, when it differs from the
    declared one. The correction is applied by OpenCASCADE at import (``OCCScaling``), which
    keeps every surface analytic; scaling after import does not (see ``job_rescale``).
    """
    detection = detect_length_unit(path.read_text(encoding="utf-8", errors="replace"))
    gmsh.model.add(path.stem)
    gmsh.option.setString("Geometry.OCCTargetUnit", "M")
    scale = 1.0
    if confirmed is not None and detection.unit is not None:
        scale = to_si(1.0, confirmed, "length") / to_si(1.0, detection.unit.symbol, "length")
    gmsh.option.setNumber("Geometry.OCCScaling", scale)
    gmsh.model.occ.importShapes(str(path))
    gmsh.model.occ.synchronize()
    unit = detection.unit
    return {
        "unit": unit.symbol if unit else None,
        "declared": unit.declared if unit else None,
        "problem": detection.problem,
        "scaling": scale,
    }


def model_size() -> float:
    x0, y0, z0, x1, y1, z1 = gmsh.model.getBoundingBox(-1, -1)
    return math.dist((x0, y0, z0), (x1, y1, z1))


def topology() -> dict:
    bodies = []
    for _, vol in gmsh.model.getEntities(3):
        _, faces = gmsh.model.getAdjacencies(3, vol)
        bodies.append(
            {
                "tag": vol,
                "volume": gmsh.model.occ.getMass(3, vol),
                "faces": sorted(int(f) for f in faces),
            }
        )
    faces = []
    for _, tag in gmsh.model.getEntities(2):
        up, _ = gmsh.model.getAdjacencies(2, tag)
        kind = gmsh.model.getType(2, tag)
        faces.append(
            {
                "tag": tag,
                "type": {"Plane": "plane", "Cylinder": "cylinder"}.get(kind, "other"),
                "gmshType": kind,
                "area": gmsh.model.occ.getMass(2, tag),
                "centroid": list(gmsh.model.occ.getCenterOfMass(2, tag)),
                "bbox": list(gmsh.model.getBoundingBox(2, tag)),
                "bodies": sorted(int(b) for b in up),
            }
        )
    return {"size": model_size(), "bodies": bodies, "faces": faces}


def triangles_by_face() -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Corner node tags of every surface triangle, per face tag, and node coordinates."""
    tags, coords, _ = gmsh.model.mesh.getNodes()
    xyz = dict(zip(tags.tolist(), coords.reshape(-1, 3), strict=True))
    tris = {}
    for _, face in gmsh.model.getEntities(2):
        types, _, nodes = gmsh.model.mesh.getElements(2, face)
        assert len(types) == 1, f"face {face}: element types {types}"
        n = gmsh.model.mesh.getElementProperties(types[0])[3]
        tris[face] = np.asarray(nodes[0], dtype=np.int64).reshape(-1, n)[:, :3]
    return tris, xyz


def tri_geometry(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Centroids, areas and longest edge of triangles given as (n, 3, 3) corner coordinates."""
    a, b, c = pts[:, 0], pts[:, 1], pts[:, 2]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    edge = np.max(
        [
            np.linalg.norm(b - a, axis=1),
            np.linalg.norm(c - b, axis=1),
            np.linalg.norm(a - c, axis=1),
        ],
        axis=0,
    )
    return pts.mean(axis=1), area, edge


def check_faces(groups: dict[int, np.ndarray], topo: dict, plane_tol: float = PLANE_TOL) -> dict:
    """Check that every triangle filed under a face tag lies on that face and on no other.

    ``groups`` maps a face tag to triangle corner coordinates (n, 3, 3). For each triangle
    centroid we project onto every face of the model; the triangle is right if its own face
    contains the projection (trimmed, not just the underlying surface), is within the
    tolerance, and no other face contains a projection that is closer.
    """
    faces = {f["tag"]: f for f in topo["faces"]}
    size = topo["size"]
    wrong = ambiguous = off_surface = 0
    worst_area = {"plane": 0.0, "cylinder": 0.0, "other": 0.0}
    for tag, pts in groups.items():
        cen, area, edge = tri_geometry(pts)
        own = project(tag, cen)
        tol = plane_tol * size if faces[tag]["type"] == "plane" else CURVED_SAG_FRACTION * edge
        bad = (~own["inside"]) | (own["dist"] > tol)
        off_surface += int(bad.sum())
        for other in faces:
            if other == tag:
                continue
            o = project(other, cen)
            closer = o["inside"] & (o["dist"] < own["dist"] - plane_tol * size)
            tie = o["inside"] & (np.abs(o["dist"] - own["dist"]) <= plane_tol * size)
            wrong += int(closer.sum())
            ambiguous += int((tie & ~closer).sum())
        rel = abs(area.sum() - faces[tag]["area"]) / faces[tag]["area"]
        kind = faces[tag]["type"]
        worst_area[kind] = max(worst_area[kind], rel)
    missing = [t for t in faces if t not in groups or len(groups[t]) == 0]
    return {
        "triangles": int(sum(len(g) for g in groups.values())),
        "offSurface": off_surface,
        "closerToAnotherFace": wrong,
        "tiedWithAnotherFace": ambiguous,
        "facesWithoutTriangles": missing,
        "worstAreaError": worst_area,
    }


def project(tag: int, points: np.ndarray) -> dict:
    flat = points.reshape(-1).tolist()
    closest, uv = gmsh.model.getClosestPoint(2, tag, flat)
    closest = np.asarray(closest).reshape(-1, 3)
    uv = np.asarray(uv).reshape(-1, 2)
    inside = np.array([gmsh.model.isInside(2, tag, list(p), True) > 0 for p in uv])
    return {"dist": np.linalg.norm(closest - points, axis=1), "inside": inside}


# --------------------------------------------------------------------------- import job


def write_display(path: Path, tris: dict[int, np.ndarray], xyz: dict) -> None:
    """One binary: header, float32 positions, uint32 indices, then (faceTag, first, count)."""
    node_ids = sorted({int(n) for t in tris.values() for n in t.reshape(-1)})
    index = {n: i for i, n in enumerate(node_ids)}
    positions = np.array([xyz[n] for n in node_ids], dtype="<f4")
    ranges, indices, first = [], [], 0
    for face in sorted(tris):
        idx = np.vectorize(index.__getitem__)(tris[face]).astype("<u4")
        indices.append(idx)
        ranges.append((face, first, len(idx)))
        first += len(idx)
    with path.open("wb") as f:
        f.write(b"CFDM" + struct.pack("<IIII", 1, len(node_ids), first, len(ranges)))
        f.write(positions.tobytes())
        f.write(np.concatenate(indices).tobytes())
        for r in ranges:
            f.write(struct.pack("<iII", *r))


def read_display(path: Path) -> dict[int, np.ndarray]:
    data = path.read_bytes()
    assert data[:4] == b"CFDM"
    _, nv, nt, nf = struct.unpack_from("<IIII", data, 4)
    off = 20
    pos = np.frombuffer(data, "<f4", nv * 3, off).reshape(-1, 3).astype(float)
    off += nv * 12
    idx = np.frombuffer(data, "<u4", nt * 3, off).reshape(-1, 3)
    off += nt * 12
    out = {}
    for k in range(nf):
        face, first, count = struct.unpack_from("<iII", data, off + 12 * k)
        out[face] = pos[idx[first : first + count]]
    return out


def job_import(step: Path, out: Path) -> dict:
    init_gmsh()
    unit = import_step(step)
    topo = topology()
    topo["unit"] = unit
    (out / "topology.json").write_text(json.dumps(topo, indent=1))
    # Display tessellation: a surface mesh sized by curvature, independent of the FE mesh.
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 16)
    gmsh.option.setNumber("Mesh.MeshSizeMax", topo["size"] / 20)
    gmsh.model.mesh.generate(2)
    tris, xyz = triangles_by_face()
    write_display(out / "display.bin", tris, xyz)
    gmsh.finalize()
    # The check reads the file back, as the viewer would, so the format is tested too.
    init_gmsh()
    import_step(step)
    report = check_faces(read_display(out / "display.bin"), topo, DISPLAY_PLANE_TOL)
    gmsh.finalize()
    return {"unit": unit, "faces": len(topo["faces"]), "bbox": None, "display": report}


# --------------------------------------------------------------------------- mesh job

# Gmsh's local node numbering of a tetrahedron's faces (corner nodes 0..3).
TET_FACES = ((0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3))


def compare_topology(reference: dict, current: dict) -> dict:
    ref = {f["tag"]: f for f in reference["faces"]}
    cur = {f["tag"]: f for f in current["faces"]}
    size = reference["size"]
    worst = 0.0
    mismatched = sorted(set(ref) ^ set(cur))
    for tag in set(ref) & set(cur):
        a, b = ref[tag], cur[tag]
        d = max(
            abs(a["area"] - b["area"]) / a["area"],
            math.dist(a["centroid"], b["centroid"]) / size,
        )
        worst = max(worst, d)
        if d > REIMPORT_TOL or a["bodies"] != b["bodies"] or a["gmshType"] != b["gmshType"]:
            mismatched.append(tag)
    return {"mismatchedFaces": sorted(mismatched), "worstRelativeDifference": worst}


def job_mesh(step: Path, out: Path, order: int, divisions: int) -> dict:
    init_gmsh()
    import_step(step)
    reference = json.loads((out / "topology.json").read_text())
    reimport = compare_topology(reference, topology())
    gmsh.option.setNumber("Mesh.MeshSizeMax", reference["size"] / divisions)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 12)
    gmsh.model.mesh.generate(3)
    if order > 1:
        gmsh.model.mesh.setOrder(order)

    # Every tetrahedron face, keyed by its sorted corner nodes.
    tet_faces: dict[tuple[int, ...], list[tuple[int, int, int]]] = {}
    tets = 0
    for _, vol in gmsh.model.getEntities(3):
        types, elems, nodes = gmsh.model.mesh.getElements(3, vol)
        assert len(types) == 1, f"volume {vol}: element types {types}"
        n = gmsh.model.mesh.getElementProperties(types[0])[3]
        conn = np.asarray(nodes[0], dtype=np.int64).reshape(-1, n)[:, :4]
        tets += len(conn)
        for e, c in zip(elems[0].tolist(), conn.tolist(), strict=True):
            for k, f in enumerate(TET_FACES):
                key = tuple(sorted(c[i] for i in f))
                tet_faces.setdefault(key, []).append((vol, e, k))
    boundary = {k: v[0] for k, v in tet_faces.items() if len(v) == 1}

    tris, xyz = triangles_by_face()
    face_map: dict[int, list[list[int]]] = {}
    unmatched = 0
    used: set[tuple[int, ...]] = set()
    groups = {}
    for face, conn in tris.items():
        rows = []
        for tri in conn.tolist():
            key = tuple(sorted(tri))
            hit = boundary.get(key)
            if hit is None:
                unmatched += 1
                continue
            used.add(key)
            rows.append([hit[1], hit[2]])
        face_map[face] = rows
        # Check the element faces themselves, not the surface triangles: rebuild each
        # mapped tetrahedron face from the tetrahedron's own nodes.
        groups[face] = np.array(
            [
                [xyz[n] for n in key]
                for key in (tuple(sorted(t)) for t in conn.tolist())
                if key in boundary
            ]
        )
    (out / f"face_map_p{order}.json").write_text(json.dumps(face_map))
    report = check_faces(groups, reference)
    gmsh.finalize()
    return {
        "reimport": reimport,
        "tets": tets,
        "boundaryTetFaces": len(boundary),
        "surfaceTrianglesWithoutTetFace": unmatched,
        "tetFacesWithoutFaceTag": len(boundary) - len(used),
        "check": report,
    }


# --------------------------------------------------------------------------- unit override


def job_rescale(step: Path, out: Path, confirmed: str) -> dict:
    """The user overrides the detected unit. Compare two ways of applying the correction.

    ``import``: re-import with ``Geometry.OCCScaling`` (what the jobs would do).
    ``dilate``: import as declared, then ``occ.dilate``. Recorded because it looks like the
    obvious way and is wrong: OpenCASCADE's general transform turns every face into a
    B-spline approximation, so areas and face types change.
    """
    init_gmsh()
    unit = import_step(step)
    before = topology()
    s = to_si(1.0, confirmed, "length") / to_si(1.0, unit["unit"], "length")
    gmsh.model.occ.dilate(gmsh.model.getEntities(3), 0, 0, 0, s, s, s)
    gmsh.model.occ.synchronize()
    dilated = topology()
    gmsh.finalize()
    init_gmsh()
    import_step(step, confirmed)
    reimported = topology()
    gmsh.finalize()
    return {
        "scale": s,
        "import": scaled_difference(before, reimported, s),
        "dilate": scaled_difference(before, dilated, s),
    }


def scaled_difference(before: dict, after: dict, s: float) -> dict:
    """How far ``after`` is from ``before`` scaled by ``s``: same tags, types, areas, centroids."""
    worst = 0.0
    same_tags = [f["tag"] for f in before["faces"]] == [f["tag"] for f in after["faces"]]
    same_types = same_tags and all(
        a["gmshType"] == b["gmshType"] for a, b in zip(before["faces"], after["faces"], strict=True)
    )
    for a, b in zip(before["faces"], after["faces"], strict=False):
        worst = max(
            worst,
            abs(b["area"] - a["area"] * s * s) / (a["area"] * s * s),
            math.dist([c * s for c in a["centroid"]], b["centroid"]) / (before["size"] * s),
        )
    return {"sameTags": same_tags, "sameTypes": same_types, "worstRelativeDifference": worst}


# --------------------------------------------------------------------------- orchestration


def sub(*args: str) -> dict:
    proc = subprocess.run(
        [sys.executable, __file__, *args], capture_output=True, text=True, check=False
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{args[0]} failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def run(out: Path, divisions: int) -> int:
    out.mkdir(parents=True, exist_ok=True)
    init_gmsh()
    for name in models.MODELS:
        step = out / f"{name}.step"
        models.write_step(name, step)
        text = step.read_text()
        for unit in UNIT_VARIANTS[1:]:
            (out / f"{name}_{unit}.step").write_text(models.with_length_unit(text, unit))
    gmsh.finalize()

    rows, failures, results = [], [], {}
    for name in models.MODELS:
        base = None
        for unit in UNIT_VARIANTS:
            stem = name if unit == "mm" else f"{name}_{unit}"
            work = out / stem
            work.mkdir(exist_ok=True)
            step = out / f"{stem}.step"
            imp = sub("import", str(step), str(work))
            topo = json.loads((work / "topology.json").read_text())
            # The same coordinates were declared in different units, so every face must
            # scale by exactly the units table's factor ratio, keeping its tag and type.
            if base is None:
                base = topo
            ratio = to_si(1.0, unit, "length") / to_si(1.0, "mm", "length")
            scaled = scaled_difference(base, topo, ratio)
            scale_err = scaled["worstRelativeDifference"]
            if not scaled["sameTypes"]:
                scale_err = math.inf
            mesh = {p: sub("mesh", str(step), str(work), str(p), str(divisions)) for p in (1, 2)}
            rescale = sub("rescale", str(step), str(work), "mm") if unit == "in" else None
            results[stem] = {"import": imp, "mesh": mesh, "rescale": rescale}
            row, problems = summarise(stem, unit, imp, scale_err, mesh, rescale)
            rows.append(row)
            failures += problems
    (out / "results.json").write_text(json.dumps(results, indent=1))
    print_table(rows)
    if failures:
        print("\nFAILED CHECKS:\n  " + "\n  ".join(failures))
        return 1
    print("\nAll checks passed.")
    return 0


def summarise(stem, unit, imp, scale_err, mesh, rescale):
    problems = []
    if imp["unit"]["unit"] != unit:
        problems.append(f"{stem}: detected unit {imp['unit']} instead of {unit}")
    if scale_err > 1e-9:
        problems.append(f"{stem}: imported extent off by {scale_err:.2e} relative")
    d = imp["display"]
    if d["offSurface"] or d["closerToAnotherFace"] or d["facesWithoutTriangles"]:
        problems.append(f"{stem}: display check {d}")
    for p, m in mesh.items():
        c = m["check"]
        if (
            m["reimport"]["mismatchedFaces"]
            or m["surfaceTrianglesWithoutTetFace"]
            or m["tetFacesWithoutFaceTag"]
            or c["offSurface"]
            or c["closerToAnotherFace"]
            or c["facesWithoutTriangles"]
        ):
            problems.append(f"{stem} order {p}: {m}")
    if rescale:
        r = rescale["import"]
        if not (r["sameTypes"] and r["worstRelativeDifference"] < REIMPORT_TOL):
            problems.append(f"{stem}: unit override by re-import {rescale}")
    m1, m2 = mesh[1], mesh[2]
    row = [
        stem,
        imp["unit"]["declared"] or "-",
        imp["unit"]["unit"] or "-",
        f"{scale_err:.0e}",
        str(imp["faces"]),
        f"{d['triangles']}",
        f"{m1['reimport']['worstRelativeDifference']:.0e}",
        f"{m1['tets']}/{m2['tets']}",
        f"{m1['check']['triangles']}/{m2['check']['triangles']}",
        f"{m1['surfaceTrianglesWithoutTetFace'] + m2['surfaceTrianglesWithoutTetFace']}"
        f"/{m1['tetFacesWithoutFaceTag'] + m2['tetFacesWithoutFaceTag']}",
        f"{d['offSurface'] + m1['check']['offSurface'] + m2['check']['offSurface']}"
        f"/{d['closerToAnotherFace'] + m1['check']['closerToAnotherFace']}"
        f"+{m2['check']['closerToAnotherFace']}",
        "{:.1e}/{:.1e}".format(
            max(m1["check"]["worstAreaError"]["plane"], d["worstAreaError"]["plane"]),
            max(m1["check"]["worstAreaError"]["cylinder"], m1["check"]["worstAreaError"]["other"]),
        ),
        "-"
        if rescale is None
        else "{:.0e} / {:.0e}{}".format(
            rescale["import"]["worstRelativeDifference"],
            rescale["dilate"]["worstRelativeDifference"],
            "" if rescale["dilate"]["sameTypes"] else " B-spline",
        ),
    ]
    return row, problems


HEADER = [
    "model",
    "declared",
    "unit",
    "scale err",
    "faces",
    "display tris",
    "reimport diff",
    "tets p1/p2",
    "mapped p1/p2",
    "unmapped/orphan",
    "off/wrong",
    "area err plane/curved (p1)",
    "in→mm re-import / dilate",
]


def print_table(rows):
    widths = [max(len(r[i]) for r in [HEADER, *rows]) for i in range(len(HEADER))]
    line = lambda r: "| " + " | ".join(c.ljust(w) for c, w in zip(r, widths, strict=True)) + " |"  # noqa: E731
    print(line(HEADER))
    print("| " + " | ".join("-" * w for w in widths) + " |")
    for r in rows:
        print(line(r))


def main() -> int:
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    r = sp.add_parser("run")
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--divisions", type=int, default=12, help="model size / max element size")
    for name in ("import", "mesh", "rescale"):
        p = sp.add_parser(name)
        p.add_argument("step", type=Path)
        p.add_argument("work", type=Path)
        if name == "mesh":
            p.add_argument("order", type=int)
            p.add_argument("divisions", type=int)
        if name == "rescale":
            p.add_argument("confirmed")
    a = ap.parse_args()
    if a.cmd == "run":
        return run(a.out, a.divisions)
    if a.cmd == "import":
        result = job_import(a.step, a.work)
    elif a.cmd == "mesh":
        result = job_mesh(a.step, a.work, a.order, a.divisions)
    else:
        result = job_rescale(a.step, a.work, a.confirmed)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
