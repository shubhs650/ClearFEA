-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Supports on edges (ADR-105): how many edges a mesh's mesh.bin keeps the segments of, as its
-- mesh job reported. Meshes made before edge supports have none (NULL) and are made again
-- before a run whose setup holds an edge.
ALTER TABLE meshes ADD COLUMN edge_count INTEGER;
