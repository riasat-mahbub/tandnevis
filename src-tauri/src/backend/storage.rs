use super::domain::*;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::{fs::OpenOptions, path::Path, time::Duration};

const APPLICATION_ID: i32 = 0x53485752;
const SCHEMA_VERSION: i32 = 1;

/// Each native project is one SQLite database. DELETE journaling and FULL synchronous
/// commits retain SQLite's crash recovery without an application-level sidecar journal.
pub struct Database {
    connection: Connection,
}

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
        let snapshot = ProjectSnapshot::empty(title)?;
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
                CREATE TABLE scenes (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id), title TEXT NOT NULL, summary TEXT NOT NULL, tone TEXT NOT NULL, narration TEXT NOT NULL CHECK(json_valid(narration)), position INTEGER NOT NULL CHECK(position>=0), UNIQUE(chapter_id,position));
                CREATE TABLE beats (id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES scenes(id), document TEXT NOT NULL CHECK(json_valid(document) AND json_type(document)='object'), text TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0), UNIQUE(scene_id,position));
                CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, background TEXT NOT NULL, voice TEXT NOT NULL, personality TEXT NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1)), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE trash (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('chapter','scene','beat')), title TEXT NOT NULL, deleted_at_revision INTEGER NOT NULL CHECK(deleted_at_revision>=0), payload TEXT NOT NULL CHECK(json_valid(payload)), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE import_sources (id TEXT PRIMARY KEY, markdown TEXT NOT NULL, imported_at_revision INTEGER NOT NULL CHECK(imported_at_revision>=0), position INTEGER NOT NULL UNIQUE CHECK(position>=0));
                CREATE TABLE history (sequence INTEGER PRIMARY KEY CHECK(sequence>0), before_state TEXT NOT NULL CHECK(json_valid(before_state)), after_state TEXT NOT NULL CHECK(json_valid(after_state)));" )).map_err(sql)?;
            tx.execute(
                "INSERT INTO project VALUES (1,?1,?2,0,0)",
                params![snapshot.project_id, snapshot.title],
            )
            .map_err(sql)?;
            tx.commit().map_err(sql)?;
            Ok(Self { connection })
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
        if version != SCHEMA_VERSION {
            return Err(format!(
                "Unsupported project schema {version}; this app supports {SCHEMA_VERSION}."
            ));
        }
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(sql)?;
        if integrity != "ok" {
            return Err(format!(
                "Project integrity check failed: {integrity}. Preserve this file for recovery."
            ));
        }
        let foreign_key_error: Option<String> = connection
            .query_row("PRAGMA foreign_key_check", [], |r| r.get(0))
            .optional()
            .map_err(sql)?;
        if foreign_key_error.is_some() {
            return Err(
                "Project contains broken entity references. Preserve this file for recovery."
                    .into(),
            );
        }
        let mut database = Self { connection };
        database.read()?.validate()?;
        Ok(database)
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
        self.change(expected_revision, Some(operation), None)
    }
    pub fn import(&mut self, expected_revision: u64, markdown: &str) -> Result<ProjectSnapshot> {
        self.change(expected_revision, None, Some(markdown))
    }
    fn change(
        &mut self,
        expected_revision: u64,
        operation: Option<Operation>,
        markdown: Option<&str>,
    ) -> Result<ProjectSnapshot> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let before = load(&tx)?;
        if before.revision != expected_revision {
            return Err(format!("Project changed: expected revision {expected_revision}, found {}. Reload before saving.", before.revision));
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
        let mut after;
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
        after.revision = revision;
        after.validate()?;
        persist(&tx, &after, new_cursor)?;
        let result = load(&tx)?;
        tx.commit().map_err(sql)?;
        Ok(result)
    }
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
        project_id,
        title,
        revision,
        chapters: vec![],
        scenes: vec![],
        characters: vec![],
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
    let mut scenes = connection.prepare("SELECT s.id,s.chapter_id,s.title,s.summary,s.tone,s.narration FROM scenes s JOIN chapters c ON c.id=s.chapter_id ORDER BY c.position,s.position").map_err(sql)?;
    let rows = scenes
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(sql)?;
    for row in rows {
        let (id, chapter_id, title, summary, tone, narration) = row.map_err(sql)?;
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
            tone,
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
                    "INSERT INTO scenes VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        scene.id,
                        scene.chapter_id,
                        scene.title,
                        scene.summary,
                        scene.tone,
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
    Ok(())
}
