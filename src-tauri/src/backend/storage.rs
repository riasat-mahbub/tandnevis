use super::domain::*;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::{fs::OpenOptions, path::Path, time::Duration};

const APPLICATION_ID: i32 = 0x53485752;
const SCHEMA_VERSION: i32 = 8;

/// Each native project is one SQLite database. DELETE journaling and FULL synchronous
/// commits retain SQLite's crash recovery without an application-level sidecar journal.
pub struct Database {
    connection: Connection,
    persisted: Option<PersistedProject>,
    starter_initialization_pending: bool,
}

struct PersistedProject {
    connection: Connection,
    project_id: String,
    revision: u64,
    data_version: i64,
    saved_changes: u64,
}

// Parent tables precede their children. This list includes every persisted
// feature, including undo history and generated drafts, for a full project save.
const SAVE_TABLES: &[&str] = &[
    "project",
    "chapters",
    "scenes",
    "beats",
    "characters",
    "trash",
    "import_sources",
    "history",
    "generation_jobs",
    "accepted_prose_revisions",
    "project_extensions",
];

fn sql(error: rusqlite::Error) -> String {
    format!("Project database: {error}")
}
fn encode<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}
fn decode<T: serde::de::DeserializeOwned>(value: String) -> Result<T> {
    serde_json::from_str(&value).map_err(|e| format!("Invalid project data: {e}"))
}

fn validate_path(path: &str) -> Result<&Path> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("shorthand"))
    {
        return Err("Choose an absolute path ending in .shorthand.".into());
    }
    Ok(path)
}
fn connect(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(sql)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sql)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA synchronous = FULL;",
        )
        .map_err(sql)?;
    Ok(connection)
}

impl Database {
    pub fn create(path: &str, title: String) -> Result<Self> {
        let path = validate_path(path)?;
        let mut snapshot = ProjectSnapshot::empty(title)?;
        snapshot.add_starters(PresetKind::Tone);
        snapshot.add_starters(PresetKind::Emotion);
        // Atomic create_new means even a race with another process cannot overwrite a project.
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| {
                format!("Could not create project (existing files are never overwritten): {e}")
            })?;
        drop(file);
        let result = (|| {
            let mut connection = connect(path)?;
            connection
                .execute_batch("PRAGMA journal_mode = DELETE;")
                .map_err(sql)?;
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql)?;
            tx.execute_batch(&format!("PRAGMA application_id = {APPLICATION_ID}; PRAGMA user_version = {SCHEMA_VERSION};
                CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), project_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), history_cursor INTEGER NOT NULL CHECK(history_cursor>=0));
                CREATE TABLE chapters (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE scenes (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), title TEXT NOT NULL, summary TEXT NOT NULL, tone TEXT NOT NULL, prose TEXT NOT NULL DEFAULT '', narration TEXT NOT NULL CHECK(json_valid(narration)), position INTEGER NOT NULL CHECK(position>=0), UNIQUE(chapter_id,position));
                CREATE TABLE beats (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES scenes(id), document TEXT NOT NULL CHECK(json_valid(document) AND json_type(document)='object'), text TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0), UNIQUE(scene_id,position));
                CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, background TEXT NOT NULL, voice TEXT NOT NULL, personality TEXT NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1)), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE trash (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('chapter','scene','beat','character','tone','emotion')), title TEXT NOT NULL, deleted_at_revision INTEGER NOT NULL CHECK(deleted_at_revision>=0), payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE project_extensions (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL CHECK(json_valid(data)));
                CREATE TABLE import_sources (id TEXT PRIMARY KEY, markdown TEXT NOT NULL, imported_at_revision INTEGER NOT NULL CHECK(imported_at_revision>=0), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE history (sequence INTEGER PRIMARY KEY CHECK(sequence>0), before_state TEXT NOT NULL CHECK(json_valid(before_state)), after_state TEXT NOT NULL CHECK(json_valid(after_state)));
                CREATE TABLE generation_jobs (
                    id TEXT PRIMARY KEY,
                    scene_id TEXT NOT NULL,
                    scene_revision INTEGER NOT NULL CHECK(scene_revision>=0),
                    connection_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    request_snapshot TEXT NOT NULL CHECK(json_valid(request_snapshot) AND json_type(request_snapshot)='object'),
                    input_fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','streaming','completed','stopped','failed','interrupted','accepted','discarded')),
                    draft_text TEXT NOT NULL DEFAULT '',
                    error_message TEXT,
                    created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
                    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0)
                );
                CREATE INDEX generation_jobs_scene_updated ON generation_jobs(scene_id,updated_at_ms DESC);
                CREATE TABLE accepted_prose_revisions (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    scene_id TEXT NOT NULL,
                    previous_prose TEXT NOT NULL,
                    accepted_prose TEXT NOT NULL,
                    accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms>=0)
                );
                CREATE INDEX accepted_prose_scene_time ON accepted_prose_revisions(scene_id,accepted_at_ms DESC);") ).map_err(sql)?;
            tx.execute(
                "INSERT INTO project VALUES (1,?1,?2,0,0)",
                params![snapshot.project_id, snapshot.title],
            )
            .map_err(sql)?;
            persist(&tx, &snapshot, 0)?;
            tx.commit().map_err(sql)?;
            Ok(Self {
                connection,
                persisted: None,
                starter_initialization_pending: false,
            })
        })();
        // Only this call's exclusively-created file is removed when initialization fails.
        if result.is_err() {
            let _ = std::fs::remove_file(path);
        }
        result
    }
    pub fn open(path: &str) -> Result<Self> {
        let path = validate_path(path)?;
        if !std::fs::metadata(path)
            .map_err(|e| format!("Could not open project: {e}"))?
            .is_file()
        {
            return Err("Project path is not a file.".into());
        }
        let connection = connect(path)?;
        let application: i32 = connection
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(sql)?;
        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(sql)?;
        if application != APPLICATION_ID {
            return Err("This file is not a Shorthand Writer project.".into());
        }
        if version < 1 || version > SCHEMA_VERSION {
            return Err(format!(
                "Unsupported project schema {version}; this app supports {SCHEMA_VERSION}."
            ));
        }
        let database = Self {
            connection,
            persisted: None,
            starter_initialization_pending: version < SCHEMA_VERSION,
        };
        // Migrations run in the private working copy. Merely opening an older project
        // must leave its selected source file byte-for-byte unchanged until Save.
        if version < SCHEMA_VERSION {
            database.copy_to_working_copy(false)
        } else {
            Ok(database)
        }
    }
    /// Edit in a private SQLite database. A normal authoring operation never
    /// changes the chosen project file until an explicit save is requested.
    pub fn working_copy(self) -> Result<Self> {
        if self.persisted.is_some() {
            if !self.starter_initialization_pending {
                return Ok(self);
            }
            let mut working = self;
            working.initialize_starters()?;
            return Ok(working);
        }
        self.copy_to_working_copy(true)
    }

    fn copy_to_working_copy(self, initialize_starters: bool) -> Result<Self> {
        let data_version = self
            .connection
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(sql)?;
        let mut connection = Connection::open_in_memory().map_err(sql)?;
        {
            let backup =
                rusqlite::backup::Backup::new(&self.connection, &mut connection).map_err(sql)?;
            backup
                .run_to_completion(128, Duration::from_millis(5), None)
                .map_err(sql)?;
        }
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;")
            .map_err(sql)?;
        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sql)?;
        if version < 1 || version > SCHEMA_VERSION {
            return Err(format!(
                "Unsupported project schema {version}; this app supports {SCHEMA_VERSION}."
            ));
        }
        if version < SCHEMA_VERSION {
            migrate(&mut connection, version)?;
        }
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(sql)?;
        if integrity != "ok" {
            return Err(format!(
                "Project integrity check failed: {integrity}. Preserve this file for recovery."
            ));
        }
        let foreign_key_error: Option<String> = connection
            .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
            .optional()
            .map_err(sql)?;
        if foreign_key_error.is_some() {
            return Err(
                "Project contains broken entity references. Preserve this file for recovery."
                    .into(),
            );
        }
        let (project_id, revision) = connection
            .query_row(
                "SELECT project_id,revision FROM project WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(sql)?;
        let saved_changes = connection.total_changes();
        let mut working = Self {
            connection,
            persisted: Some(PersistedProject {
                connection: self.connection,
                project_id,
                revision,
                data_version,
                saved_changes,
            }),
            starter_initialization_pending: self.starter_initialization_pending
                && !initialize_starters,
        };
        working.read()?.validate()?;
        if initialize_starters {
            working.initialize_starters()?;
        }
        Ok(working)
    }

    fn initialize_starters(&mut self) -> Result<()> {
        let mut snapshot = self.read()?;
        let before = snapshot.clone();
        snapshot.initialize_starters(None);
        if snapshot != before {
            snapshot.validate()?;
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql)?;
            let cursor: i64 = tx
                .query_row(
                    "SELECT history_cursor FROM project WHERE singleton=1",
                    [],
                    |row| row.get(0),
                )
                .map_err(sql)?;
            persist(&tx, &snapshot, cursor)?;
            tx.commit().map_err(sql)?;
        }
        self.starter_initialization_pending = false;
        Ok(())
    }

    pub fn has_unsaved_changes(&self) -> bool {
        self.persisted
            .as_ref()
            .is_some_and(|persisted| self.connection.total_changes() != persisted.saved_changes)
    }

    /// Save all tables in one SQLite transaction. Validate the saved file while
    /// holding the write lock so another app window cannot be overwritten.
    pub fn save(&mut self) -> Result<ProjectSnapshot> {
        if !self.has_unsaved_changes() {
            return self.read();
        }
        let snapshot = self.read()?;
        let persisted = self
            .persisted
            .as_mut()
            .ok_or("This project has no save destination.")?;
        let tx = persisted
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let version: i64 = tx
            .query_row("PRAGMA data_version", [], |r| r.get(0))
            .map_err(sql)?;
        let identity: (String, u64) = tx
            .query_row(
                "SELECT project_id,revision FROM project WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(sql)?;
        if identity != (persisted.project_id.clone(), persisted.revision)
            || version != persisted.data_version
        {
            return Err("The project file changed in another window. Your edits remain in this window; save a recovery copy before reopening the changed file.".into());
        }
        let schema_version: i32 = tx
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sql)?;
        migrate_in_transaction(&tx, schema_version)?;
        for table in SAVE_TABLES.iter().rev() {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(sql)?;
        }
        for table in SAVE_TABLES {
            let mut source = self
                .connection
                .prepare(&format!("SELECT * FROM {table}"))
                .map_err(sql)?;
            let columns = source.column_count();
            let placeholders = vec!["?"; columns].join(",");
            let mut insert = tx
                .prepare(&format!("INSERT INTO {table} VALUES ({placeholders})"))
                .map_err(sql)?;
            let mut rows = source.query([]).map_err(sql)?;
            while let Some(row) = rows.next().map_err(sql)? {
                let values = (0..columns)
                    .map(|column| row.get::<_, rusqlite::types::Value>(column))
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(sql)?;
                insert
                    .execute(rusqlite::params_from_iter(values))
                    .map_err(sql)?;
            }
        }
        tx.commit().map_err(sql)?;
        persisted.revision = snapshot.revision;
        persisted.saved_changes = self.connection.total_changes();
        Ok(snapshot)
    }
    pub fn read(&mut self) -> Result<ProjectSnapshot> {
        let tx = self.connection.transaction().map_err(sql)?;
        let snapshot = load(&tx)?;
        tx.commit().map_err(sql)?;
        Ok(snapshot)
    }
    pub fn apply(
        &mut self,
        expected_revision: u64,
        operation: Operation,
    ) -> Result<ProjectSnapshot> {
        self.change(expected_revision, Some(operation), None, None, None)
    }
    pub fn import(&mut self, expected_revision: u64, markdown: &str) -> Result<ProjectSnapshot> {
        self.change(expected_revision, None, Some(markdown), None, None)
    }
    pub fn accept_generated_prose(
        &mut self,
        expected_revision: u64,
        revision: AcceptedProseRevision,
    ) -> Result<ProjectSnapshot> {
        let scene_id = revision.scene_id.clone();
        let prose = revision.accepted_prose.clone();
        self.change(
            expected_revision,
            Some(Operation::UpdateScene {
                scene_id,
                title: None,
                summary: None,
                summary_document: None,
                tone: None,
                tone_id: None,
                prose: Some(prose),
                narration: None,
            }),
            None,
            Some(revision),
            None,
        )
    }
    pub fn accept_generated_beats(
        &mut self,
        expected_revision: u64,
        job_id: &str,
        scene_id: &str,
        documents: Vec<serde_json::Value>,
        accepted_at_ms: u64,
    ) -> Result<ProjectSnapshot> {
        self.change(
            expected_revision,
            None,
            None,
            None,
            Some((
                job_id.to_owned(),
                scene_id.to_owned(),
                documents,
                accepted_at_ms,
            )),
        )
    }
    fn change(
        &mut self,
        expected_revision: u64,
        operation: Option<Operation>,
        markdown: Option<&str>,
        accepted_revision: Option<AcceptedProseRevision>,
        accepted_beats: Option<(String, String, Vec<serde_json::Value>, u64)>,
    ) -> Result<ProjectSnapshot> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let before = load(&tx)?;
        if before.revision != expected_revision {
            return Err(format!("Project changed: expected revision {expected_revision}, found {}. Reload before saving.", before.revision));
        }
        if let Some((job_id, scene_id, documents, _)) = &accepted_beats {
            let job = load_generation_job(&tx, job_id)?.ok_or("Generation job does not exist.")?;
            if job.scene_id != *scene_id
                || job.status != GenerationJobStatus::Completed
                || job.request_snapshot["purpose"] != "beats"
            {
                return Err(
                    "Only a completed generated scene for these beats can be accepted.".into(),
                );
            }
            if documents.is_empty() || documents.len() > 40 {
                return Err("A generated scene must contain between 1 and 40 beats.".into());
            }
        }
        if let Some(revision) = &accepted_revision {
            validate_accepted_revision(revision)?;
            let scene = before
                .scenes
                .iter()
                .find(|scene| scene.id == revision.scene_id)
                .ok_or("The scene for this accepted draft no longer exists.")?;
            if scene.prose != revision.previous_prose {
                return Err("The scene prose changed while this draft was being reviewed. Reload and review it again.".into());
            }
            let job = load_generation_job(&tx, &revision.job_id)?
                .ok_or("Generation job does not exist.")?;
            if job.scene_id != revision.scene_id {
                return Err("The generation job belongs to a different scene.".into());
            }
            if !matches!(
                job.status,
                GenerationJobStatus::Completed | GenerationJobStatus::Stopped
            ) {
                return Err(
                    "Only a completed or stopped draft for this scene can be accepted.".into(),
                );
            }
            if job.draft_text != revision.accepted_prose {
                return Err("Accepted prose must match the saved generation draft.".into());
            }
        }
        let revision = before
            .revision
            .checked_add(1)
            .filter(|v| *v <= i64::MAX as u64)
            .ok_or("Project revision limit reached.")?;
        let cursor: i64 = tx
            .query_row(
                "SELECT history_cursor FROM project WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let mut after: ProjectSnapshot;
        let new_cursor;
        match operation {
            Some(Operation::Undo) => {
                if cursor == 0 {
                    return Err("Nothing to undo.".into());
                }
                after = decode(
                    tx.query_row(
                        "SELECT before_state FROM history WHERE sequence=?1",
                        [cursor],
                        |r| r.get(0),
                    )
                    .map_err(sql)?,
                )?;
                after.initialize_starters(Some(&before));
                new_cursor = cursor - 1;
            }
            Some(Operation::Redo) => {
                let serialized: Option<String> = tx
                    .query_row(
                        "SELECT after_state FROM history WHERE sequence=?1",
                        [cursor + 1],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(sql)?;
                after = decode(serialized.ok_or("Nothing to redo.")?)?;
                after.initialize_starters(Some(&before));
                new_cursor = cursor + 1;
            }
            operation => {
                after = before.clone();
                if let Some(operation) = operation {
                    after.apply(operation)?;
                }
                if let Some(markdown) = markdown {
                    after.import_markdown(markdown)?;
                }
                if let Some((_, scene_id, documents, _)) = &accepted_beats {
                    for document in documents {
                        after.apply(Operation::CreateBeat {
                            scene_id: scene_id.clone(),
                            document: document.clone(),
                            text: String::new(),
                        })?;
                    }
                }
                after.revision = revision;
                new_cursor = cursor + 1;
                tx.execute("DELETE FROM history WHERE sequence>?1", [cursor])
                    .map_err(sql)?;
                tx.execute(
                    "INSERT INTO history (sequence,before_state,after_state) VALUES (?1,?2,?3)",
                    params![new_cursor, encode(&before)?, encode(&after)?],
                )
                .map_err(sql)?;
            }
        }
        if before.project_id != after.project_id {
            return Err("Project history identity does not match.".into());
        }
        if let Some(revision) = &accepted_revision {
            let accepted_scene = after
                .scenes
                .iter()
                .find(|scene| scene.id == revision.scene_id)
                .ok_or("The accepted draft scene is no longer present.")?;
            if accepted_scene.prose != revision.accepted_prose {
                return Err("Accepted scene prose does not match the reviewed draft.".into());
            }
            tx.execute(
                "INSERT INTO accepted_prose_revisions (id,job_id,scene_id,previous_prose,accepted_prose,accepted_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    revision.id,
                    revision.job_id,
                    revision.scene_id,
                    revision.previous_prose,
                    revision.accepted_prose,
                    revision.accepted_at_ms
                ],
            )
            .map_err(sql)?;
            let changed = tx.execute(
                "UPDATE generation_jobs SET status='accepted',updated_at_ms=?2 WHERE id=?1 AND status IN ('completed','stopped')",
                params![revision.job_id, revision.accepted_at_ms],
            )
            .map_err(sql)?;
            if changed != 1 {
                return Err(
                    "The generation job changed before its draft could be accepted.".into(),
                );
            }
        }
        after.revision = revision;
        if let Some((job_id, _, _, accepted_at_ms)) = &accepted_beats {
            let changed = tx.execute("UPDATE generation_jobs SET status='accepted',updated_at_ms=?2 WHERE id=?1 AND status='completed'", params![job_id, accepted_at_ms]).map_err(sql)?;
            if changed != 1 {
                return Err("The generated scene changed before it could be accepted.".into());
            }
        }
        after.validate()?;
        persist(&tx, &after, new_cursor)?;
        let result = load(&tx)?;
        tx.commit().map_err(sql)?;
        Ok(result)
    }

    /// Insert an immutable, scene-scoped request snapshot before any provider work starts.
    pub fn create_generation_job(&self, job: &GenerationJob) -> Result<()> {
        validate_generation_job(job)?;
        if job.status != GenerationJobStatus::Pending || !job.draft_text.is_empty() {
            return Err("A new generation job must start pending with an empty draft.".into());
        }
        self.connection
            .execute(
                "INSERT INTO generation_jobs (id,scene_id,scene_revision,connection_id,model,request_snapshot,input_fingerprint,status,draft_text,error_message,created_at_ms,updated_at_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    job.id,
                    job.scene_id,
                    job.scene_revision,
                    job.connection_id,
                    job.model,
                    encode(&job.request_snapshot)?,
                    job.input_fingerprint,
                    job.status.as_str(),
                    job.draft_text,
                    job.error_message,
                    job.created_at_ms,
                    job.updated_at_ms
                ],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub fn generation_job(&self, id: &str) -> Result<Option<GenerationJob>> {
        load_generation_job(&self.connection, id)
    }

    pub fn generation_jobs_for_scene(&self, scene_id: &str) -> Result<Vec<GenerationJob>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id FROM generation_jobs WHERE scene_id=?1 ORDER BY created_at_ms DESC,id",
            )
            .map_err(sql)?;
        let ids = statement
            .query_map([scene_id], |row| row.get::<_, String>(0))
            .map_err(sql)?;
        let ids = ids.map(|id| id.map_err(sql)).collect::<Result<Vec<_>>>()?;
        drop(statement);
        let mut jobs = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(job) = load_generation_job(&self.connection, &id)? {
                jobs.push(job);
            }
        }
        Ok(jobs)
    }

    /// Persist a full draft checkpoint and state transition in one transaction.
    pub fn checkpoint_generation_job(
        &mut self,
        id: &str,
        status: GenerationJobStatus,
        draft_text: String,
        error_message: Option<String>,
        updated_at_ms: u64,
    ) -> Result<GenerationJob> {
        if draft_text.len() > 10_000_000 || error_message.as_ref().is_some_and(|v| v.len() > 20_000)
        {
            return Err("Generation checkpoint exceeds the supported size.".into());
        }
        if updated_at_ms > i64::MAX as u64 {
            return Err("Generation checkpoint timestamp is outside the supported range.".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let previous = load_generation_job(&tx, id)?.ok_or("Generation job does not exist.")?;
        if !previous.status.can_transition_to(status) {
            return Err(format!(
                "Generation job cannot transition from {} to {}.",
                previous.status.as_str(),
                status.as_str()
            ));
        }
        tx.execute(
            "UPDATE generation_jobs SET status=?2,draft_text=?3,error_message=?4,updated_at_ms=?5 WHERE id=?1",
            params![id, status.as_str(), draft_text, error_message, updated_at_ms],
        )
        .map_err(sql)?;
        let updated = load_generation_job(&tx, id)?.ok_or("Generation job disappeared.")?;
        tx.commit().map_err(sql)?;
        Ok(updated)
    }

    pub fn accepted_prose_revisions_for_scene(
        &self,
        scene_id: &str,
    ) -> Result<Vec<AcceptedProseRevision>> {
        let mut statement = self.connection.prepare(
            "SELECT id,job_id,scene_id,previous_prose,accepted_prose,accepted_at_ms FROM accepted_prose_revisions WHERE scene_id=?1 ORDER BY accepted_at_ms DESC,id",
        ).map_err(sql)?;
        let revisions = statement
            .query_map([scene_id], |row| {
                Ok(AcceptedProseRevision {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    scene_id: row.get(2)?,
                    previous_prose: row.get(3)?,
                    accepted_prose: row.get(4)?,
                    accepted_at_ms: row.get(5)?,
                })
            })
            .map_err(sql)?;
        revisions.map(|revision| revision.map_err(sql)).collect()
    }

    /// Call once when a project is attached after app startup; remote work is never replayed.
    pub fn interrupt_unfinished_generation_jobs(&mut self, updated_at_ms: u64) -> Result<usize> {
        if updated_at_ms > i64::MAX as u64 {
            return Err("Generation checkpoint timestamp is outside the supported range.".into());
        }
        self.connection
            .execute(
                "UPDATE generation_jobs SET status='interrupted',updated_at_ms=?1 WHERE status IN ('pending','streaming')",
                [updated_at_ms],
            )
            .map_err(sql)
    }
}

fn migrate(connection: &mut Connection, version: i32) -> Result<()> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    migrate_in_transaction(&tx, version)?;
    tx.commit().map_err(sql)
}

fn migrate_in_transaction(tx: &rusqlite::Transaction<'_>, mut version: i32) -> Result<()> {
    if version < 1 || version > SCHEMA_VERSION {
        return Err(format!(
            "Unsupported project schema {version}; this app supports {SCHEMA_VERSION}."
        ));
    }
    while version < SCHEMA_VERSION {
        version = match version {
            1 => {
                tx.execute_batch(
                "ALTER TABLE scenes ADD COLUMN prose TEXT NOT NULL DEFAULT '';
                 CREATE TABLE generation_jobs (
                    id TEXT PRIMARY KEY,
                    scene_id TEXT NOT NULL,
                    scene_revision INTEGER NOT NULL CHECK(scene_revision>=0),
                    connection_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    request_snapshot TEXT NOT NULL CHECK(json_valid(request_snapshot) AND json_type(request_snapshot)='object'),
                    input_fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','streaming','completed','stopped','failed','interrupted','accepted','discarded')),
                    draft_text TEXT NOT NULL DEFAULT '',
                    error_message TEXT,
                    created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
                    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=0)
                 );
                 CREATE INDEX generation_jobs_scene_updated ON generation_jobs(scene_id,updated_at_ms DESC);
                 CREATE TABLE accepted_prose_revisions (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    scene_id TEXT NOT NULL,
                    previous_prose TEXT NOT NULL,
                    accepted_prose TEXT NOT NULL,
                    accepted_at_ms INTEGER NOT NULL CHECK(accepted_at_ms>=0)
                 );
                 CREATE INDEX accepted_prose_scene_time ON accepted_prose_revisions(scene_id,accepted_at_ms DESC);
                 PRAGMA user_version=2;",
                )
                .map_err(sql)?;
                2
            }
            2 => {
                tx.execute_batch("CREATE TABLE project_extensions (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL CHECK(json_valid(data)));
              ALTER TABLE trash RENAME TO trash_v2;
              CREATE TABLE trash (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('chapter','scene','beat','character','tone','emotion')), title TEXT NOT NULL, deleted_at_revision INTEGER NOT NULL CHECK(deleted_at_revision>=0), payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
              INSERT INTO trash SELECT * FROM trash_v2; DROP TABLE trash_v2; PRAGMA user_version=3;").map_err(sql)?;
                3
            }
            3 => {
                // No table rewrite: the existing extension row now owns rich summaries.
                // Version 4 is the schema with rich summaries, tone/emotion libraries,
                // and defaults in the extension row.
                tx.pragma_update(None, "user_version", 4).map_err(sql)?;
                4
            }
            4 => {
                // Freeform inline references do not require a table rewrite. Bumping the
                // gate prevents older binaries from reinterpreting the new document rules.
                tx.pragma_update(None, "user_version", 5).map_err(sql)?;
                5
            }
            5 => {
                // Preset colors live in project-extension JSON; no table rewrite is needed.
                tx.pragma_update(None, "user_version", 6).map_err(sql)?;
                6
            }
            6 => {
                // Character icons live in project-extension JSON; no table rewrite is needed.
                // This gate keeps older binaries from discarding the new optional field.
                tx.pragma_update(None, "user_version", 7)
                    .map_err(sql)?;
                7
            }
            7 => {
                // Relationship history is stored in extensions. Older binaries must not discard it.
                tx.pragma_update(None, "user_version", 8).map_err(sql)?;
                8
            }
            _ => {
                return Err(format!(
                    "Unsupported project schema {version}; this app supports {SCHEMA_VERSION}."
                ));
            }
        };
    }
    Ok(())
}

fn generation_status(value: String) -> Result<GenerationJobStatus> {
    serde_json::from_value(serde_json::Value::String(value))
        .map_err(|_| "Project database contains an unknown generation status.".into())
}

fn load_generation_job(connection: &Connection, id: &str) -> Result<Option<GenerationJob>> {
    let row = connection
        .query_row(
            "SELECT id,scene_id,scene_revision,connection_id,model,request_snapshot,input_fingerprint,status,draft_text,error_message,created_at_ms,updated_at_ms FROM generation_jobs WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, u64>(10)?,
                    row.get::<_, u64>(11)?,
                ))
            },
        )
        .optional()
        .map_err(sql)?;
    row.map(
        |(
            id,
            scene_id,
            scene_revision,
            connection_id,
            model,
            request_snapshot,
            input_fingerprint,
            status,
            draft_text,
            error_message,
            created_at_ms,
            updated_at_ms,
        )| {
            Ok(GenerationJob {
                id,
                scene_id,
                scene_revision,
                connection_id,
                model,
                request_snapshot: decode(request_snapshot)?,
                input_fingerprint,
                status: generation_status(status)?,
                draft_text,
                error_message,
                created_at_ms,
                updated_at_ms,
            })
        },
    )
    .transpose()
}

fn validate_generation_job(job: &GenerationJob) -> Result<()> {
    if job.id.trim().is_empty()
        || job.scene_id.trim().is_empty()
        || job.connection_id.trim().is_empty()
        || job.model.trim().is_empty()
        || job.input_fingerprint.trim().is_empty()
    {
        return Err("Generation job identifiers, model, and fingerprint are required.".into());
    }
    if !job.request_snapshot.is_object() {
        return Err("Generation request snapshots must be JSON objects.".into());
    }
    if job.scene_revision > i64::MAX as u64
        || job.created_at_ms > i64::MAX as u64
        || job.updated_at_ms > i64::MAX as u64
    {
        return Err("Generation job revision or timestamp is outside the supported range.".into());
    }
    if job.model.len() > 1000
        || job.connection_id.len() > 1000
        || job.input_fingerprint.len() > 4000
        || job.draft_text.len() > 10_000_000
        || job.error_message.as_ref().is_some_and(|v| v.len() > 20_000)
    {
        return Err("Generation job exceeds the supported size.".into());
    }
    if encode(&job.request_snapshot)?.len() > 10_000_000 {
        return Err("Generation request snapshot exceeds the supported size.".into());
    }
    Ok(())
}

fn validate_accepted_revision(revision: &AcceptedProseRevision) -> Result<()> {
    if revision.id.trim().is_empty()
        || revision.job_id.trim().is_empty()
        || revision.scene_id.trim().is_empty()
    {
        return Err("Accepted prose revision identifiers are required.".into());
    }
    if revision.accepted_at_ms > i64::MAX as u64
        || revision.previous_prose.len() > 10_000_000
        || revision.accepted_prose.len() > 10_000_000
    {
        return Err("Accepted prose revision exceeds the supported size.".into());
    }
    Ok(())
}

fn load(connection: &Connection) -> Result<ProjectSnapshot> {
    let (project_id, title, revision, cursor): (String, String, u64, i64) = connection
        .query_row(
            "SELECT project_id,title,revision,history_cursor FROM project WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(sql)?;
    let mut project = ProjectSnapshot {
        relationship_changes: vec![],
        relationship_cast: std::collections::HashMap::new(),
        project_id,
        title,
        revision,
        chapters: vec![],
        scenes: vec![],
        characters: vec![],
        tones: vec![],
        emotions: vec![],
        starter_types: vec![],
        trash: vec![],
        import_sources: vec![],
        can_undo: cursor > 0,
        can_redo: false,
    };
    project.can_redo = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM history WHERE sequence=?1)",
            [cursor + 1],
            |r| r.get(0),
        )
        .map_err(sql)?;
    let mut chapters = connection
        .prepare("SELECT id,title FROM chapters ORDER BY position")
        .map_err(sql)?;
    for row in chapters
        .query_map([], |r| {
            Ok(Chapter {
                id: r.get(0)?,
                title: r.get(1)?,
                scene_ids: vec![],
            })
        })
        .map_err(sql)?
    {
        project.chapters.push(row.map_err(sql)?);
    }
    let mut scenes = connection.prepare("SELECT s.id,s.chapter_id,s.title,s.summary,s.tone,s.prose,s.narration FROM scenes s JOIN chapters c ON c.id=s.chapter_id ORDER BY c.position,s.position").map_err(sql)?;
    let rows = scenes
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(sql)?;
    for row in rows {
        let (id, chapter_id, title, summary, tone, prose, narration) = row.map_err(sql)?;
        project
            .chapters
            .iter_mut()
            .find(|c| c.id == chapter_id)
            .ok_or("Invalid scene chapter.")?
            .scene_ids
            .push(id.clone());
        project.scenes.push(Scene {
            id,
            chapter_id,
            title,
            summary,
            summary_document: None,
            tone,
            tone_id: String::new(),
            prose,
            narration: decode(narration)?,
            beats: vec![],
        });
    }
    let mut beats = connection
        .prepare("SELECT id,scene_id,document,text FROM beats ORDER BY position")
        .map_err(sql)?;
    for row in beats
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(sql)?
    {
        let (id, scene_id, document, text) = row.map_err(sql)?;
        project
            .scenes
            .iter_mut()
            .find(|s| s.id == scene_id)
            .ok_or("Invalid beat scene.")?
            .beats
            .push(Beat {
                id,
                document: decode(document)?,
                text,
            });
    }
    let mut characters = connection.prepare("SELECT id,name,background,voice,personality,archived FROM characters ORDER BY position").map_err(sql)?;
    for row in characters
        .query_map([], |r| {
            Ok(Character {
                id: r.get(0)?,
                name: r.get(1)?,
                background: r.get(2)?,
                voice: r.get(3)?,
                personality: r.get(4)?,
                archived: r.get(5)?,
                icon: String::new(),
                default_tone_id: String::new(),
                default_emotion_id: String::new(),
            })
        })
        .map_err(sql)?
    {
        project.characters.push(row.map_err(sql)?);
    }
    let mut trash = connection
        .prepare("SELECT id,kind,title,deleted_at_revision,payload FROM trash ORDER BY position")
        .map_err(sql)?;
    for row in trash
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, u64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(sql)?
    {
        let (id, kind, title, deleted_at_revision, payload) = row.map_err(sql)?;
        project.trash.push(TrashEntry {
            id,
            kind,
            title,
            deleted_at_revision,
            payload: decode(payload)?,
        });
    }
    let mut sources = connection
        .prepare("SELECT id,markdown,imported_at_revision FROM import_sources ORDER BY position")
        .map_err(sql)?;
    for row in sources
        .query_map([], |r| {
            Ok(ImportedSource {
                id: r.get(0)?,
                markdown: r.get(1)?,
                imported_at_revision: r.get(2)?,
            })
        })
        .map_err(sql)?
    {
        project.import_sources.push(row.map_err(sql)?);
    }
    let extras: Option<String> = connection
        .query_row(
            "SELECT data FROM project_extensions WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql)?;
    if let Some(extras) = extras {
        let v: serde_json::Value = decode(extras)?;
        project.relationship_changes = serde_json::from_value(v.get("relationshipChanges").cloned().unwrap_or_else(|| serde_json::json!([]))).map_err(|e| e.to_string())?;
        project.relationship_cast = serde_json::from_value(v.get("relationshipCast").cloned().unwrap_or_else(|| serde_json::json!({}))).map_err(|e| e.to_string())?;
        project.tones = serde_json::from_value(v["tones"].clone()).map_err(|e| e.to_string())?;
        project.emotions =
            serde_json::from_value(v["emotions"].clone()).map_err(|e| e.to_string())?;
        project.starter_types =
            serde_json::from_value(v["starterTypes"].clone()).map_err(|e| e.to_string())?;
        for s in &mut project.scenes {
            s.tone_id = v["sceneTones"][&s.id].as_str().unwrap_or_default().into();
            s.summary_document = v["sceneSummaries"][&s.id]
                .as_object()
                .map(|_| v["sceneSummaries"][&s.id].clone());
        }
        for c in &mut project.characters {
            c.icon = v["characterIcons"][&c.id]
                .as_str()
                .unwrap_or_default()
                .into();
            c.default_tone_id = v["characterDefaults"][&c.id]["toneId"]
                .as_str()
                .unwrap_or_default()
                .into();
            c.default_emotion_id = v["characterDefaults"][&c.id]["emotionId"]
                .as_str()
                .unwrap_or_default()
                .into();
        }
    }
    for s in &mut project.scenes {
        let mut document = summary_document(s, &project.tones);
        normalize_occurrences(&mut document, &format!("{}:summary", s.id));
        s.summary = document_text(
            &document,
            &project.characters,
            &project.tones,
            &project.emotions,
        )?;
        s.summary_document = Some(document);
        for b in &mut s.beats {
            normalize_occurrences(&mut b.document, &b.id);
        }
    }
    project.validate()?;
    Ok(project)
}

fn persist(connection: &Connection, project: &ProjectSnapshot, cursor: i64) -> Result<()> {
    // Rewrite within one transaction: readers see either the old ordering or the new
    // ordering, and no temporary duplicate ordinal can escape the transaction.
    connection.execute_batch("DELETE FROM beats; DELETE FROM scenes; DELETE FROM chapters; DELETE FROM characters; DELETE FROM trash; DELETE FROM import_sources;").map_err(sql)?;
    for (position, chapter) in project.chapters.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO chapters VALUES (?1,?2,?3)",
                params![chapter.id, chapter.title, position as i64],
            )
            .map_err(sql)?;
        for (position, id) in chapter.scene_ids.iter().enumerate() {
            let scene = project
                .scenes
                .iter()
                .find(|s| &s.id == id)
                .ok_or("Scene is missing from snapshot.")?;
            connection
                .execute(
                    "INSERT INTO scenes (id,chapter_id,title,summary,tone,prose,narration,position) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        scene.id,
                        scene.chapter_id,
                        scene.title,
                        scene.summary,
                        scene.tone,
                        scene.prose,
                        encode(&scene.narration)?,
                        position as i64
                    ],
                )
                .map_err(sql)?;
            for (position, beat) in scene.beats.iter().enumerate() {
                connection
                    .execute(
                        "INSERT INTO beats VALUES (?1,?2,?3,?4,?5)",
                        params![
                            beat.id,
                            scene.id,
                            encode(&beat.document)?,
                            beat.text,
                            position as i64
                        ],
                    )
                    .map_err(sql)?;
            }
        }
    }
    for (position, c) in project.characters.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO characters VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    c.id,
                    c.name,
                    c.background,
                    c.voice,
                    c.personality,
                    c.archived,
                    position as i64
                ],
            )
            .map_err(sql)?;
    }
    for (position, t) in project.trash.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO trash VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    t.id,
                    t.kind,
                    t.title,
                    t.deleted_at_revision,
                    encode(&t.payload)?,
                    position as i64
                ],
            )
            .map_err(sql)?;
    }
    for (position, source) in project.import_sources.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO import_sources VALUES (?1,?2,?3,?4)",
                params![
                    source.id,
                    source.markdown,
                    source.imported_at_revision,
                    position as i64
                ],
            )
            .map_err(sql)?;
    }
    connection
        .execute(
            "UPDATE project SET title=?1,revision=?2,history_cursor=?3 WHERE singleton=1",
            params![project.title, project.revision, cursor],
        )
        .map_err(sql)?;
    let scene_tones: serde_json::Map<String, serde_json::Value> = project
        .scenes
        .iter()
        .map(|s| (s.id.clone(), serde_json::json!(s.tone_id)))
        .collect();
    let character_defaults: serde_json::Map<String, serde_json::Value> = project
        .characters
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                serde_json::json!({"toneId":c.default_tone_id,"emotionId":c.default_emotion_id}),
            )
        })
        .collect();
    let character_icons: serde_json::Map<String, serde_json::Value> = project
        .characters
        .iter()
        .map(|c| (c.id.clone(), serde_json::json!(c.icon)))
        .collect();
    let scene_summaries: serde_json::Map<String, serde_json::Value> = project
        .scenes
        .iter()
        .filter_map(|s| {
            s.summary_document
                .as_ref()
                .map(|d| (s.id.clone(), d.clone()))
        })
        .collect();
    let extensions = serde_json::json!({"tones":project.tones,"emotions":project.emotions,"starterTypes":project.starter_types,"sceneTones":scene_tones,"sceneSummaries":scene_summaries,"characterDefaults":character_defaults,"characterIcons":character_icons,"relationshipChanges":project.relationship_changes,"relationshipCast":project.relationship_cast});
    connection.execute("INSERT INTO project_extensions(singleton,data) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET data=excluded.data",[encode(&extensions)?]).map_err(sql)?;
    Ok(())
}
