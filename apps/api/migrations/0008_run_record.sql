-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The run record (M1.10, ADR-032). A worker reports its versions when it claims a job; a run
-- keeps the versions that produced it and the names of the files its job stored.

-- The claiming worker's WorkerSoftware (jobs.schema.json), as JSON.
ALTER TABLE jobs ADD COLUMN software TEXT;

-- RunSoftware (simulation.schema.json) as JSON: the mesh's Gmsh and OpenCASCADE versions,
-- written when the run is created, then the solving worker's versions when its job ends.
ALTER TABLE runs ADD COLUMN software TEXT;

-- The run's stored files (RunFileName values) as a JSON array, written when its job ends.
ALTER TABLE runs ADD COLUMN files TEXT;
