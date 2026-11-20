use super::*;
use domain::Operation::*;
use serde_json::json;
use std::path::PathBuf;

struct ProjectFile(PathBuf);
impl ProjectFile {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("shorthand-test-{}.shorthand", new_id())))
    }
    fn path(&self) -> &str {
        self.0.to_str().unwrap()
    }
    fn create(&self) -> Database {
        Database::create(self.path(), "Synthetic project".into()).unwrap()
    }
}
impl Drop for ProjectFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
fn apply(db: &mut Database, operation: domain::Operation) -> ProjectSnapshot {
    let revision = db.read().unwrap().revision;
    db.apply(revision, operation).unwrap()
}
fn scene(db: &mut Database) -> ProjectSnapshot {
    let p = apply(
        db,
        CreateChapter {
            title: "Chapter one".into(),
        },
    );
    apply(
        db,
        CreateScene {
            chapter_id: p.chapters[0].id.clone(),
            title: "Scene one".into(),
        },
    )
}
fn beat(db: &mut Database, scene_id: &str, text: &str) -> ProjectSnapshot {
    apply(
        db,
        CreateBeat {
            scene_id: scene_id.into(),
            document: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}),
            text: text.into(),
        },
    )
}

#[test]
fn empty_project_and_full_authoring_survive_reopen() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let empty = db.read().unwrap();
    assert_eq!(empty.revision, 0);
    assert!(empty.chapters.is_empty());
    assert!(!empty.can_undo);
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    beat(&mut db, &scene_id, "A synthetic entrance.");
    let p = apply(
        &mut db,
        CreateCharacter {
            name: "Test character".into(),
        },
    );
    apply(
        &mut db,
        UpdateCharacter {
            character_id: p.characters[0].id.clone(),
            name: None,
            background: Some("Synthetic background".into()),
            voice: Some("Quiet".into()),
            personality: Some("Curious".into()),
            archived: Some(true),
        },
    );
    let p = apply(
        &mut db,
        UpdateScene {
            scene_id,
            title: None,
            summary: Some("A short idea.".into()),
            tone: Some("Hopeful".into()),
            narration: Some(domain::Narration {
                point_of_view: "Third person".into(),
                tense: "Past".into(),
                instructions: "Keep close.".into(),
            }),
        },
    );
    drop(db);
    let restored = Database::open(file.path()).unwrap().read().unwrap();
    assert_eq!(restored, p);
    assert_eq!(restored.project_id, empty.project_id);
    assert!(restored.characters[0].archived);
}

#[test]
fn duplicate_scene_and_beat_get_fresh_ids_and_keep_documents() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let p = beat(&mut db, &scene_id, "A synthetic beat.");
    let original = p.scenes[0].clone();
    let p = apply(
        &mut db,
        DuplicateScene {
            scene_id: scene_id.clone(),
        },
    );
    assert_eq!(p.chapters[0].scene_ids.len(), 2);
    assert_ne!(p.scenes[0].id, p.scenes[1].id);
    assert_ne!(p.scenes[0].beats[0].id, p.scenes[1].beats[0].id);
    assert_eq!(p.scenes[0].beats[0].document, p.scenes[1].beats[0].document);
    let p = apply(
        &mut db,
        DuplicateBeat {
            beat_id: original.beats[0].id.clone(),
        },
    );
    assert_eq!(p.scenes[0].beats.len(), 2);
    assert_ne!(p.scenes[0].beats[0].id, p.scenes[0].beats[1].id);
    assert_eq!(p.scenes[0].beats[0].text, p.scenes[0].beats[1].text);
}

#[test]
fn reorder_checks_exact_membership_and_persists_all_orders() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let first = p.scenes[0].id.clone();
    let chapter = p.chapters[0].id.clone();
    beat(&mut db, &first, "First");
    beat(&mut db, &first, "Second");
    let p = apply(
        &mut db,
        CreateScene {
            chapter_id: chapter.clone(),
            title: "Second scene".into(),
        },
    );
    let second = p.scenes[1].id.clone();
    let p = apply(
        &mut db,
        ReorderScenes {
            chapter_id: chapter.clone(),
            ids: vec![second.clone(), first.clone()],
        },
    );
    assert_eq!(p.chapters[0].scene_ids, vec![second.clone(), first.clone()]);
    let beats = &p.scenes.iter().find(|s| s.id == first).unwrap().beats;
    let reversed = vec![beats[1].id.clone(), beats[0].id.clone()];
    let p = apply(
        &mut db,
        ReorderBeats {
            scene_id: first.clone(),
            ids: reversed.clone(),
        },
    );
    assert_eq!(
        p.scenes
            .iter()
            .find(|s| s.id == first)
            .unwrap()
            .beats
            .iter()
            .map(|b| b.id.clone())
            .collect::<Vec<_>>(),
        reversed
    );
    let before = db.read().unwrap();
    assert!(db
        .apply(
            before.revision,
            ReorderScenes {
                chapter_id: chapter,
                ids: vec![first.clone(), first]
            }
        )
        .is_err());
    assert_eq!(db.read().unwrap(), before);
    let p = apply(
        &mut db,
        CreateChapter {
            title: "Second chapter".into(),
        },
    );
    let chapter_ids = vec![p.chapters[1].id.clone(), p.chapters[0].id.clone()];
    let p = apply(
        &mut db,
        ReorderChapters {
            ids: chapter_ids.clone(),
        },
    );
    drop(db);
    assert_eq!(Database::open(file.path()).unwrap().read().unwrap(), p);
    assert_eq!(
        p.chapters.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        chapter_ids
    );
}

#[test]
fn recoverable_scene_and_chapter_deletion_keeps_profiles_and_ids() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let chapter_id = p.chapters[0].id.clone();
    beat(&mut db, &scene_id, "Keep this beat");
    let original = apply(
        &mut db,
        CreateCharacter {
            name: "Reusable character".into(),
        },
    );
    let p = apply(&mut db, DeleteScene { scene_id });
    assert!(p.scenes.is_empty());
    assert_eq!(p.characters, original.characters);
    let p = apply(
        &mut db,
        RestoreTrash {
            trash_id: p.trash[0].id.clone(),
        },
    );
    assert_eq!(p.scenes, original.scenes);
    assert!(p.trash.is_empty());
    let p = apply(&mut db, DeleteChapter { chapter_id });
    assert!(p.chapters.is_empty());
    assert!(p.scenes.is_empty());
    assert_eq!(p.characters, original.characters);
    let p = apply(
        &mut db,
        RestoreTrash {
            trash_id: p.trash[0].id.clone(),
        },
    );
    assert_eq!(p.chapters, original.chapters);
    assert_eq!(p.scenes, original.scenes);
}

#[test]
fn beat_restore_requires_parent_and_keeps_original_position() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    beat(&mut db, &scene_id, "First");
    let original = beat(&mut db, &scene_id, "Second");
    let p = apply(
        &mut db,
        DeleteBeat {
            beat_id: original.scenes[0].beats[0].id.clone(),
        },
    );
    let trash_id = p.trash[0].id.clone();
    let p = apply(&mut db, DeleteScene { scene_id });
    assert!(db
        .apply(
            p.revision,
            RestoreTrash {
                trash_id: trash_id.clone()
            }
        )
        .is_err());
    assert_eq!(db.read().unwrap(), p);
    apply(
        &mut db,
        RestoreTrash {
            trash_id: p.trash[1].id.clone(),
        },
    );
    let p = apply(&mut db, RestoreTrash { trash_id });
    assert_eq!(p.scenes, original.scenes);
}

#[test]
fn undo_redo_persist_and_branch_truncates_redo_without_reusing_revision() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let initial = db.read().unwrap();
    let created = scene(&mut db);
    let p = apply(&mut db, Undo);
    assert!(p.scenes.is_empty());
    assert!(p.can_redo);
    assert_eq!(p.revision, created.revision + 1);
    drop(db);
    let mut db = Database::open(file.path()).unwrap();
    let p = apply(&mut db, Redo);
    assert_eq!(p.scenes, created.scenes);
    assert!(!p.can_redo);
    let p = apply(&mut db, Undo);
    let p = db
        .apply(
            p.revision,
            RenameProject {
                title: "Branch title".into(),
            },
        )
        .unwrap();
    assert!(!p.can_redo);
    assert!(db.apply(p.revision, Redo).is_err());
    apply(&mut db, Undo);
    apply(&mut db, Undo);
    let p = db.read().unwrap();
    assert_eq!(p.chapters, initial.chapters);
    assert_eq!(p.title, initial.title);
    assert!(!p.can_undo);
}

#[test]
fn stale_revision_across_connections_and_invalid_operation_leave_database_unchanged() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let mut other = Database::open(file.path()).unwrap();
    let p = scene(&mut db);
    assert!(other
        .apply(
            0,
            RenameProject {
                title: "Stale".into()
            }
        )
        .is_err());
    assert_eq!(other.read().unwrap(), p);
    assert!(db
        .apply(
            p.revision,
            CreateBeat {
                scene_id: p.scenes[0].id.clone(),
                document: json!("raw HTML is not a document"),
                text: "Invalid".into()
            }
        )
        .is_err());
    assert_eq!(db.read().unwrap(), p);
    assert!(db
        .apply(
            p.revision,
            CreateScene {
                chapter_id: new_id(),
                title: "Dangling".into()
            }
        )
        .is_err());
    assert_eq!(db.read().unwrap(), p);
    // Import modifies its working snapshot before encountering an invalid heading.
    assert!(db
        .import(p.revision, "## Valid\n### Imported\nNew paragraph\n\n## ")
        .is_err());
    assert_eq!(db.read().unwrap(), p);
}

#[test]
fn sqlite_failure_after_history_and_entity_writes_rolls_back_entire_operation() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let before = beat(
        &mut db,
        &p.scenes[0].id,
        "Keep the complete committed state",
    );
    let connection = rusqlite::Connection::open(file.path()).unwrap();
    connection.execute_batch("CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON scenes BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;").unwrap();
    // Persistence has already added a history row and deleted existing entities when
    // this trigger fails. SQLite must roll back all of those changes together.
    let error = db
        .apply(
            before.revision,
            RenameProject {
                title: "Must roll back".into(),
            },
        )
        .unwrap_err();
    assert!(error.contains("synthetic write failure"));
    assert_eq!(db.read().unwrap(), before);
    connection
        .execute_batch("DROP TRIGGER synthetic_disk_failure;")
        .unwrap();
    drop(connection);
    let p = apply(&mut db, Undo);
    assert!(p.scenes[0].beats.is_empty());
    assert_eq!(p.title, before.title);
    let p = apply(&mut db, Redo);
    assert_eq!(p.scenes, before.scenes);
}

#[test]
fn create_never_overwrites_and_open_rejects_foreign_or_future_schema() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let initial = db.read().unwrap();
    assert!(Database::create(file.path(), "Overwrite".into()).is_err());
    assert_eq!(db.read().unwrap(), initial);
    drop(db);
    let foreign = ProjectFile::new();
    let connection = rusqlite::Connection::open(foreign.path()).unwrap();
    connection
        .execute_batch("CREATE TABLE unrelated (id INTEGER);")
        .unwrap();
    drop(connection);
    assert!(Database::open(foreign.path())
        .unwrap_err_message()
        .contains("not a Shorthand"));
    let connection = rusqlite::Connection::open(file.path()).unwrap();
    connection
        .execute_batch("PRAGMA user_version=999;")
        .unwrap();
    drop(connection);
    assert!(Database::open(file.path())
        .unwrap_err_message()
        .contains("Unsupported project schema"));
}

trait ErrorMessage<T> {
    fn unwrap_err_message(self) -> String;
}
impl<T> ErrorMessage<T> for std::result::Result<T, String> {
    fn unwrap_err_message(self) -> String {
        match self {
            Ok(_) => panic!("Expected error"),
            Err(error) => error,
        }
    }
}

#[test]
fn markdown_is_explicit_append_only_import_and_a_single_undoable_operation() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let original = scene(&mut db);
    let p = db.import(original.revision,"## Imported chapter\n\n### Imported scene\n\nSynthetic first paragraph.\n\nSynthetic second paragraph.\n").unwrap();
    assert_eq!(p.revision, original.revision + 1);
    assert_eq!(p.chapters.len(), 2);
    assert_eq!(p.scenes[1].beats.len(), 2);
    assert_eq!(
        p.scenes[1].beats[0].document["importedMarkdown"],
        "Synthetic first paragraph."
    );
    assert!(p.import_sources[0]
        .markdown
        .starts_with("## Imported chapter\n\n"));
    assert_eq!(p.import_sources[0].imported_at_revision, p.revision);
    let exported = p.markdown();
    assert!(exported.contains("## Imported chapter"));
    assert!(exported.contains("Synthetic second paragraph."));
    let p = apply(&mut db, Undo);
    assert_eq!(p.chapters, original.chapters);
    assert_eq!(p.scenes, original.scenes);
    assert!(p.import_sources.is_empty());
}

#[test]
fn command_operation_contract_uses_camel_case_and_rejects_unknown_fields() {
    let operation: domain::Operation =
        serde_json::from_value(json!({"type":"createScene","chapterId":new_id(),"title":"Scene"}))
            .unwrap();
    assert!(matches!(operation, CreateScene { .. }));
    assert!(serde_json::from_value::<domain::Operation>(
        json!({"type":"createChapter","title":"Title","sql":"DROP TABLE project"})
    )
    .is_err());
    assert!(serde_json::from_value::<domain::Operation>(
        json!({"type":"executeSql","sql":"SELECT 1"})
    )
    .is_err());
}

#[test]
fn character_reference_validation_and_text_follow_profile_rename_and_archive() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let p = apply(
        &mut db,
        CreateCharacter {
            name: "Synthetic Ada".into(),
        },
    );
    let character_id = p.characters[0].id.clone();
    let document = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"characterReference","attrs":{"characterId":character_id,"label":"Wrong label","emotion":"Hopeful","delivery":"Quiet"}},{"type":"text","text":" enters."}]}]});
    let p = apply(
        &mut db,
        CreateBeat {
            scene_id: scene_id.clone(),
            document: document.clone(),
            text: "Untrusted conflicting plain text".into(),
        },
    );
    assert_eq!(p.scenes[0].beats[0].text, "Synthetic Ada enters.");
    let p = apply(
        &mut db,
        UpdateCharacter {
            character_id,
            name: Some("Synthetic Bea".into()),
            background: None,
            voice: None,
            personality: None,
            archived: Some(true),
        },
    );
    assert_eq!(p.scenes[0].beats[0].text, "Synthetic Bea enters.");
    assert!(p.markdown().contains("Synthetic Bea enters."));
    let p = apply(
        &mut db,
        CreateBeat {
            scene_id: scene_id.clone(),
            document: document.clone(),
            text: "".into(),
        },
    );
    assert_eq!(p.scenes[0].beats[1].text, "Synthetic Bea enters.");
    let mut unknown = document;
    unknown["content"][0]["content"][0]["attrs"]["characterId"] = json!(new_id());
    assert!(db
        .apply(
            p.revision,
            CreateBeat {
                scene_id: scene_id.clone(),
                document: unknown,
                text: "".into()
            }
        )
        .is_err());
    for document in [
        json!({"type":"doc","content":[{"type":"script"}]}),
        json!({"type":"doc","content":[{"type":"text","text":"Bad root child"}]}),
        json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Link","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}),
    ] {
        assert!(db
            .apply(
                p.revision,
                CreateBeat {
                    scene_id: scene_id.clone(),
                    document,
                    text: "".into()
                }
            )
            .is_err());
        assert_eq!(db.read().unwrap(), p);
    }
}

#[test]
fn markdown_export_atomically_replaces_an_existing_selected_file() {
    let path = std::env::temp_dir().join(format!("shorthand-export-test-{}.md", new_id()));
    std::fs::write(&path, "Previous export").unwrap();
    write_markdown(&path, "# Synthetic export\n").unwrap();
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "# Synthetic export\n"
    );
    std::fs::remove_file(path).unwrap();
}

#[test]
fn opening_another_project_invalidates_old_session_without_losing_persistence() {
    let first = ProjectFile::new();
    let second = ProjectFile::new();
    let state = BackendState::default();
    let a = state.install(first.create()).unwrap();
    state
        .with_project(&a.session_id, |db| {
            db.apply(
                0,
                CreateChapter {
                    title: "Persisted chapter".into(),
                },
            )
        })
        .unwrap();
    let b = state.install(second.create()).unwrap();
    assert_ne!(a.project.project_id, b.project.project_id);
    assert!(state.with_project(&a.session_id, Database::read).is_err());
    let reopened = state
        .install(Database::open(first.path()).unwrap())
        .unwrap();
    assert_eq!(reopened.project.chapters[0].title, "Persisted chapter");
    assert_ne!(reopened.session_id, a.session_id);
}
