-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Projects in folders, with a trash (M14.1, ADR-114). Every geometry and simulation belongs to a
-- project of its owner; each user's existing work moves into "My first project". Delete is soft:
-- deleted_at is set, and the storage sweep purges the item after the retention period (M14.2).

CREATE TABLE folders (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Null for a folder at the top of the user's home. A folder is purged only once it is empty.
  parent_id TEXT REFERENCES folders (id),
  name TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX folders_owner_parent ON folders (owner_id, parent_id);

-- Null folder_id: the project sits at the top of the home.
ALTER TABLE projects ADD COLUMN folder_id TEXT REFERENCES folders (id);
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN last_opened_at TEXT;
-- When the viewer last stored the project's thumbnail (owners/<owner>/projects/<id>/thumbnail.png); null for none.
ALTER TABLE projects ADD COLUMN thumbnail_at TEXT;

CREATE INDEX projects_owner_folder ON projects (owner_id, folder_id);
CREATE INDEX geometries_project_id ON geometries (project_id);
CREATE INDEX simulations_project_id ON simulations (project_id);

-- The one project each user had so far (ADR-038) becomes their first of many.
UPDATE projects SET name = 'My first project' WHERE name = 'My project';

-- A user with work but no project gets one; the id is a random version 4 UUID.
INSERT INTO projects (id, owner_id, name)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2)
         || '-' || lower(hex(randomblob(6))),
       users.id, 'My first project'
  FROM users
 WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = users.id)
   AND (EXISTS (SELECT 1 FROM geometries g WHERE g.owner_id = users.id)
        OR EXISTS (SELECT 1 FROM simulations s WHERE s.owner_id = users.id));

-- Until now nothing set project_id; the work goes into the owner's oldest project.
UPDATE geometries SET project_id = (
  SELECT p.id FROM projects p WHERE p.owner_id = geometries.owner_id ORDER BY p.created_at, p.id LIMIT 1
) WHERE project_id IS NULL;

UPDATE simulations SET project_id = (
  SELECT g.project_id FROM geometries g WHERE g.id = simulations.geometry_id
) WHERE project_id IS NULL;

-- From here on the database itself refuses work outside a project of its owner, a project in
-- another user's folder, a folder in another user's folder, and a simulation in a different
-- project from its geometry. The data-access layer never asks for any of these; the triggers
-- make a slip in it fail loudly instead of leaking across users.

CREATE TRIGGER folders_parent_owner_insert BEFORE INSERT ON folders
WHEN NEW.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.parent_id AND f.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'folder parent must be a folder of the same owner');
END;

CREATE TRIGGER folders_parent_owner_update BEFORE UPDATE OF parent_id, owner_id ON folders
WHEN NEW.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.parent_id AND f.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'folder parent must be a folder of the same owner');
END;

CREATE TRIGGER projects_folder_owner_insert BEFORE INSERT ON projects
WHEN NEW.folder_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.folder_id AND f.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'project folder must be a folder of the same owner');
END;

CREATE TRIGGER projects_folder_owner_update BEFORE UPDATE OF folder_id, owner_id ON projects
WHEN NEW.folder_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.folder_id AND f.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'project folder must be a folder of the same owner');
END;

CREATE TRIGGER geometries_project_owner_insert BEFORE INSERT ON geometries
WHEN NEW.project_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'geometry must belong to a project of the same owner');
END;

CREATE TRIGGER geometries_project_owner_update BEFORE UPDATE OF project_id, owner_id ON geometries
WHEN NEW.project_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.owner_id = NEW.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'geometry must belong to a project of the same owner');
END;

CREATE TRIGGER simulations_project_insert BEFORE INSERT ON simulations
WHEN NEW.project_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM geometries g
     WHERE g.id = NEW.geometry_id AND g.owner_id = NEW.owner_id AND g.project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'simulation must belong to the project of its geometry');
END;

CREATE TRIGGER simulations_project_update BEFORE UPDATE OF project_id, owner_id, geometry_id ON simulations
WHEN NEW.project_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM geometries g
     WHERE g.id = NEW.geometry_id AND g.owner_id = NEW.owner_id AND g.project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'simulation must belong to the project of its geometry');
END;
