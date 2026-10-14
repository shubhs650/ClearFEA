# worker

Python job worker (`clearfea_worker`): claims jobs, meshes with Gmsh and solves with CalculiX. Managed with `uv`. The claim loop and Dockerfile arrive in M0.5.

```
uv sync          # create .venv with dev tools
uv run pytest    # tests
uv run ruff check .
```
