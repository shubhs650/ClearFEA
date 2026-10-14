# SPDX-License-Identifier: AGPL-3.0-or-later
"""Small STEP texts written for these tests, with only the entities the unit reader looks at."""


def step(data: str) -> str:
    return (
        "ISO-10303-21;\nHEADER;\nFILE_NAME('t.step','',(''),(''),'','','');\nENDSEC;\n"
        f"DATA;\n{data}\nENDSEC;\nEND-ISO-10303-21;\n"
    )


def context(*units: str) -> str:
    """A geometric context whose unit list is the given entity references."""
    refs = ",".join(units)
    return (
        "#10 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#13)) "
        f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({refs})) REPRESENTATION_CONTEXT('Context #1','3D') );\n"
        "#12 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );\n"
        "#13 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#11,'distance','');\n"
    )


def si_length(prefix: str = "$", ref: int = 11) -> str:
    return f"#{ref} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT({prefix},.METRE.) );\n"


def conversion(name: str, factor: float, base_prefix: str = ".MILLI.", ref: int = 11) -> str:
    """A conversion-based length unit defined as ``factor`` units of an SI length unit."""
    return (
        f"#{ref} = ( CONVERSION_BASED_UNIT('{name}',#20) LENGTH_UNIT() NAMED_UNIT(#22) );\n"
        f"#20 = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE({factor}),#21);\n"
        f"#21 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT({base_prefix},.METRE.) );\n"
        "#22 = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
    )
