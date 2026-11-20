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
fn apply_json(db: &mut Database, value: serde_json::Value) -> ProjectSnapshot {
    apply(db, serde_json::from_value(value).unwrap())
}

#[test]
fn shared_definitions_defaults_and_trash_survive_manual_save() {
    let file = ProjectFile::new();
    let mut db = file.create().working_copy().unwrap();
    let initial = db.read().unwrap();
    assert_eq!(initial.tones.len(), 3);
    assert_eq!(initial.emotions.len(), 4);
    let p = apply_json(
        &mut db,
        json!({"type":"createPreset","kind":"tone","name":"Quiet"}),
    );
    let id = p.tones.last().unwrap().id.clone();
    let p = apply_json(
        &mut db,
        json!({"type":"updatePreset","kind":"tone","presetId":id,"guidance":"Keep the pauses."}),
    );
    assert_eq!(p.tones.last().unwrap().guidance, "Keep the pauses.");
    let p = apply_json(
        &mut db,
        json!({"type":"deletePreset","kind":"tone","presetId":id}),
    );
    let trash = p.trash.last().unwrap().id.clone();
    let p = apply_json(&mut db, json!({"type":"restoreTrash","trashId":trash}));
    assert!(p.tones.iter().any(|t| t.id == id));
    assert!(!Database::open(file.path())
        .unwrap()
        .read()
        .unwrap()
        .tones
        .iter()
        .any(|t| t.id == id));
    db.save().unwrap();
    drop(db);
    assert!(Database::open(file.path())
        .unwrap()
        .read()
        .unwrap()
        .tones
        .iter()
        .any(|t| t.id == id && t.guidance == "Keep the pauses."));
}

#[test]
fn separate_local_blocks_duplicate_targets_and_guard_global_deletion() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let sid = p.scenes[0].id.clone();
    let p = apply_json(&mut db, json!({"type":"createCharacter","name":"Maya"}));
    let cid = p.characters[0].id.clone();
    let eid = p
        .emotions
        .iter()
        .find(|e| e.name == "Awe")
        .unwrap()
        .id
        .clone();
    let tid = p
        .tones
        .iter()
        .find(|e| e.name == "Tense")
        .unwrap()
        .id
        .clone();
    let document = json!({"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"characterReference","attrs":{"characterId":cid,"occurrenceId":"occ-1","label":"Maya","emotion":"","delivery":""}},
        {"type":"emotionReference","attrs":{"emotionId":eid,"label":"Awe","targetOccurrenceId":"occ-1"}},
        {"type":"toneReference","attrs":{"toneId":tid,"label":"Tense"}}
    ]}]});
    let p = apply_json(
        &mut db,
        json!({"type":"createBeat","sceneId":sid,"document":document,"text":"ignored"}),
    );
    let bid = p.scenes[0].beats[0].id.clone();
    assert!(db
        .apply(
            p.revision,
            serde_json::from_value(json!({"type":"deletePreset","kind":"emotion","presetId":eid}))
                .unwrap()
        )
        .is_err());
    let p = apply_json(&mut db, json!({"type":"duplicateBeat","beatId":bid}));
    let copy = &p.scenes[0].beats[1].document["content"][0]["content"];
    let fresh = copy[0]["attrs"]["occurrenceId"].as_str().unwrap();
    assert_ne!(fresh, "occ-1");
    assert_eq!(
        copy[1]["attrs"]["targetOccurrenceId"].as_str().unwrap(),
        fresh
    );
    let p = apply_json(&mut db, json!({"type":"deleteScene","sceneId":sid}));
    assert!(db
        .apply(
            p.revision,
            serde_json::from_value(json!({"type":"deletePreset","kind":"tone","presetId":tid}))
                .unwrap()
        )
        .is_err());
}

#[test]
fn removing_starters_does_not_reseed_on_open_or_repeated_initialization() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = db.read().unwrap();
    let id = p.emotions[0].id.clone();
    apply_json(
        &mut db,
        json!({"type":"deletePreset","kind":"emotion","presetId":id}),
    );
    apply_json(
        &mut db,
        json!({"type":"addStarterPresets","kind":"emotion"}),
    );
    drop(db);
    let p = Database::open(file.path()).unwrap().read().unwrap();
    assert_eq!(p.emotions.len(), 3);
    assert!(!p.emotions.iter().any(|e| e.id == id));
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
            default_tone_id: None,
            default_emotion_id: None,
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
            tone_id: None,
            scene_id,
            title: None,
            summary: Some("A short idea.".into()),
            tone: Some("Hopeful".into()),
            prose: None,
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
            default_tone_id: None,
            default_emotion_id: None,
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
    state.with_project(&a.session_id, Database::save).unwrap();
    let b = state.install(second.create()).unwrap();
    assert_ne!(a.project.project_id, b.project.project_id);
    assert!(state.with_project(&a.session_id, Database::read).is_err());
    let reopened = state
        .install(Database::open(first.path()).unwrap())
        .unwrap();
    assert_eq!(reopened.project.chapters[0].title, "Persisted chapter");
    assert_ne!(reopened.session_id, a.session_id);
}

#[test]
fn manual_save_keeps_structural_and_text_edits_out_of_the_file_until_saved() {
    let file = ProjectFile::new();
    let mut working = file.create().working_copy().unwrap();
    assert!(!working.has_unsaved_changes());
    let p = scene(&mut working);
    let scene_id = p.scenes[0].id.clone();
    beat(&mut working, &scene_id, "A private working beat.");
    let current = apply(
        &mut working,
        UpdateScene {
            tone_id: None,
            scene_id: scene_id.clone(),
            title: None,
            summary: Some("Working summary".into()),
            tone: None,
            prose: Some("Working prose.".into()),
            narration: None,
        },
    );
    assert!(working.has_unsaved_changes());
    let mut on_disk = Database::open(file.path()).unwrap();
    assert_eq!(on_disk.read().unwrap().revision, 0);
    assert!(on_disk.read().unwrap().chapters.is_empty());
    assert_eq!(working.save().unwrap(), current);
    assert!(!working.has_unsaved_changes());
    assert_eq!(on_disk.read().unwrap(), current);
    let undone = apply(&mut working, Undo);
    assert_eq!(undone.scenes[0].prose, "");
    assert!(working.has_unsaved_changes());
    working.save().unwrap();
    drop(working);
    let mut reopened = Database::open(file.path()).unwrap();
    assert_eq!(reopened.read().unwrap(), undone);
    let redone = apply(&mut reopened, Redo);
    assert_eq!(redone.scenes[0].prose, "Working prose.");
}

#[test]
fn dropping_an_unsaved_working_copy_preserves_the_saved_project() {
    let file = ProjectFile::new();
    let mut working = file.create().working_copy().unwrap();
    scene(&mut working);
    assert!(working.has_unsaved_changes());
    drop(working);
    let mut reopened = Database::open(file.path()).unwrap();
    assert_eq!(reopened.read().unwrap().revision, 0);
    assert!(reopened.read().unwrap().scenes.is_empty());
}

#[test]
fn full_save_rejects_external_changes_and_retains_working_edits() {
    let file = ProjectFile::new();
    let mut working = file.create().working_copy().unwrap();
    let current = scene(&mut working);
    let mut other = Database::open(file.path()).unwrap();
    let theirs = apply(
        &mut other,
        RenameProject {
            title: "Other window".into(),
        },
    );
    assert!(working
        .save()
        .unwrap_err()
        .contains("changed in another window"));
    assert!(working.has_unsaved_changes());
    assert_eq!(working.read().unwrap(), current);
    assert_eq!(other.read().unwrap(), theirs);
}

#[test]
fn full_save_detects_external_writes_even_without_a_revision_change() {
    let file = ProjectFile::new();
    let mut working = file.create().working_copy().unwrap();
    scene(&mut working);
    let other = rusqlite::Connection::open(file.path()).unwrap();
    other
        .execute("UPDATE project SET title='External edit'", [])
        .unwrap();
    assert!(working
        .save()
        .unwrap_err()
        .contains("changed in another window"));
    assert!(working.has_unsaved_changes());
    let mut reopened = Database::open(file.path()).unwrap();
    assert_eq!(reopened.read().unwrap().title, "External edit");
}

#[test]
fn schema_v1_migrates_to_v3_without_losing_story_or_undo_history() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let p = beat(&mut db, &p.scenes[0].id, "The infirmary is quiet.");
    let mut expected = apply(
        &mut db,
        UpdateScene {
            tone_id: None,
            scene_id: p.scenes[0].id.clone(),
            title: None,
            summary: Some("Maya tends to Damian.".into()),
            tone: Some("Careful, awkward warmth.".into()),
            prose: None,
            narration: None,
        },
    );
    drop(db);

    // Emulate the existing v1 schema, keeping the actual project entities and history.
    let connection = rusqlite::Connection::open(file.path()).unwrap();
    connection
        .execute_batch(
            "ALTER TABLE scenes DROP COLUMN prose;
             DROP TABLE generation_jobs;
             DROP TABLE accepted_prose_revisions;
             DROP TABLE project_extensions;
             PRAGMA user_version=1;",
        )
        .unwrap();
    drop(connection);
    expected.tones.clear();
    expected.emotions.clear();
    expected.starter_types.clear();

    let mut migrated = Database::open(file.path()).unwrap();
    assert_eq!(migrated.read().unwrap(), expected);
    assert_eq!(
        migrated.apply(expected.revision, Undo).unwrap().scenes[0].beats[0].text,
        "The infirmary is quiet."
    );
    let connection = rusqlite::Connection::open(file.path()).unwrap();
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 3);
    assert_eq!(
        connection
            .query_row("SELECT prose FROM scenes LIMIT 1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        ""
    );
}

fn generation_job(
    scene_id: &str,
    scene_revision: u64,
    created_at_ms: u64,
) -> domain::GenerationJob {
    domain::GenerationJob {
        id: new_id(),
        scene_id: scene_id.into(),
        scene_revision,
        connection_id: "chatgpt-account-test".into(),
        model: "synthetic-writing-model".into(),
        request_snapshot: json!({
            "scene": { "id": scene_id, "title": "School infirmary" },
            "beats": [{ "order": 1, "text": "Maya tends to Damian." }]
        }),
        input_fingerprint: "synthetic-scene-input-fingerprint".into(),
        status: domain::GenerationJobStatus::Pending,
        draft_text: String::new(),
        error_message: None,
        created_at_ms,
        updated_at_ms: created_at_ms,
    }
}

#[test]
fn manual_save_tracks_and_persists_generation_checkpoints_without_story_revision_changes() {
    let file = ProjectFile::new();
    let mut working = file.create().working_copy().unwrap();
    let p = scene(&mut working);
    working.save().unwrap();
    let scene_id = p.scenes[0].id.clone();
    let job = generation_job(&scene_id, p.revision, 10);
    working.create_generation_job(&job).unwrap();
    assert!(working.has_unsaved_changes());
    let checkpoint = working
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Streaming,
            "A saved partial draft.".into(),
            None,
            11,
        )
        .unwrap();
    let disk = Database::open(file.path()).unwrap();
    assert!(disk
        .generation_jobs_for_scene(&scene_id)
        .unwrap()
        .is_empty());
    working.save().unwrap();
    assert!(!working.has_unsaved_changes());
    let disk = Database::open(file.path()).unwrap();
    assert_eq!(disk.generation_job(&job.id).unwrap(), Some(checkpoint));
    working
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Completed,
            "A saved complete draft.".into(),
            None,
            12,
        )
        .unwrap();
    assert!(working.has_unsaved_changes());
    working.save().unwrap();
    let disk = Database::open(file.path()).unwrap();
    assert_eq!(
        disk.generation_job(&job.id).unwrap().unwrap().status,
        domain::GenerationJobStatus::Completed
    );
}

#[test]
fn generation_checkpoints_survive_authoring_saves_and_acceptance_is_undoable() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let job = generation_job(&scene_id, p.revision, 10);
    db.create_generation_job(&job).unwrap();
    assert!(db
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Completed,
            "invalid early completion".into(),
            None,
            11,
        )
        .is_err());

    let streaming = db
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Streaming,
            "Maya paused with the needle between her fingers.".into(),
            None,
            12,
        )
        .unwrap();
    assert_eq!(streaming.status, domain::GenerationJobStatus::Streaming);
    drop(db);

    let mut db = Database::open(file.path()).unwrap();
    assert_eq!(db.generation_job(&job.id).unwrap(), Some(streaming.clone()));
    // Ordinary snapshot replacement rewrites scenes, but must not remove job data.
    let saved = db
        .apply(
            p.revision,
            UpdateScene {
                tone_id: None,
                scene_id: scene_id.clone(),
                title: None,
                summary: Some("A first aid scene.".into()),
                tone: None,
                prose: None,
                narration: None,
            },
        )
        .unwrap();
    assert_eq!(
        db.generation_job(&job.id).unwrap().unwrap().draft_text,
        streaming.draft_text
    );

    let completed_text =
        "Maya paused with the needle between her fingers. Damian watched her face.";
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Streaming,
        completed_text[..50].into(),
        None,
        13,
    )
    .unwrap();
    let completed = db
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Completed,
            completed_text.into(),
            None,
            14,
        )
        .unwrap();
    assert_eq!(completed.status, domain::GenerationJobStatus::Completed);

    let revision = domain::AcceptedProseRevision {
        id: new_id(),
        job_id: job.id.clone(),
        scene_id: scene_id.clone(),
        previous_prose: String::new(),
        accepted_prose: completed_text.into(),
        accepted_at_ms: 15,
    };
    let accepted = db
        .accept_generated_prose(saved.revision, revision.clone())
        .unwrap();
    assert_eq!(accepted.scenes[0].prose, completed_text);
    assert!(accepted.can_undo);
    assert_eq!(
        db.generation_job(&job.id).unwrap().unwrap().status,
        domain::GenerationJobStatus::Accepted
    );
    assert_eq!(
        db.accepted_prose_revisions_for_scene(&scene_id).unwrap(),
        vec![revision]
    );

    let after_undo = db.apply(accepted.revision, Undo).unwrap();
    assert_eq!(after_undo.scenes[0].prose, "");
    assert_eq!(
        db.accepted_prose_revisions_for_scene(&scene_id)
            .unwrap()
            .len(),
        1
    );
    drop(db);
    let db = Database::open(file.path()).unwrap();
    let jobs = db.generation_jobs_for_scene(&scene_id).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, domain::GenerationJobStatus::Accepted);
    assert_eq!(
        jobs[0].request_snapshot["scene"]["title"],
        "School infirmary"
    );
}

#[test]
fn draft_acceptance_rejects_stale_prose_mismatched_or_missing_jobs_and_wrong_scenes() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let completed_text = "Maya asks Damian to hold still.";
    let job = generation_job(&scene_id, p.revision, 30);
    db.create_generation_job(&job).unwrap();
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Streaming,
        completed_text.into(),
        None,
        31,
    )
    .unwrap();
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Completed,
        completed_text.into(),
        None,
        32,
    )
    .unwrap();

    let other_scene = db
        .apply(
            p.revision,
            CreateScene {
                chapter_id: p.chapters[0].id.clone(),
                title: "Outside the infirmary".into(),
            },
        )
        .unwrap();
    let other_scene_id = other_scene.scenes[1].id.clone();
    let current = db
        .apply(
            other_scene.revision,
            UpdateScene {
                tone_id: None,
                scene_id: scene_id.clone(),
                title: None,
                summary: None,
                tone: None,
                prose: Some("The writer changed this prose after generation.".into()),
                narration: None,
            },
        )
        .unwrap();

    let revision = |id: String, target_scene: &str, previous: &str, accepted: &str| {
        domain::AcceptedProseRevision {
            id,
            job_id: job.id.clone(),
            scene_id: target_scene.into(),
            previous_prose: previous.into(),
            accepted_prose: accepted.into(),
            accepted_at_ms: 40,
        }
    };

    let missing_job = domain::AcceptedProseRevision {
        id: new_id(),
        job_id: new_id(),
        scene_id: scene_id.clone(),
        previous_prose: current.scenes[0].prose.clone(),
        accepted_prose: completed_text.into(),
        accepted_at_ms: 41,
    };
    assert!(db
        .accept_generated_prose(current.revision, missing_job)
        .unwrap_err()
        .contains("job does not exist"));

    let wrong_scene = revision(new_id(), &other_scene_id, "", completed_text);
    assert!(db
        .accept_generated_prose(current.revision, wrong_scene)
        .unwrap_err()
        .contains("different scene"));

    let stale_previous = revision(new_id(), &scene_id, "", completed_text);
    assert!(db
        .accept_generated_prose(current.revision, stale_previous)
        .unwrap_err()
        .contains("prose changed"));

    let changed_draft = revision(
        new_id(),
        &scene_id,
        &current.scenes[0].prose,
        "Not the saved draft.",
    );
    assert!(db
        .accept_generated_prose(current.revision, changed_draft)
        .unwrap_err()
        .contains("match the saved generation draft"));

    let missing_scene = revision(new_id(), &new_id(), "", completed_text);
    assert!(db
        .accept_generated_prose(current.revision, missing_scene)
        .unwrap_err()
        .contains("scene for this accepted draft no longer exists"));

    let connection = rusqlite::Connection::open(file.path()).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER ignore_job_acceptance BEFORE UPDATE ON generation_jobs
             WHEN NEW.status='accepted' BEGIN SELECT RAISE(IGNORE); END;",
        )
        .unwrap();
    let conditional_update = revision(
        new_id(),
        &scene_id,
        &current.scenes[0].prose,
        completed_text,
    );
    assert!(db
        .accept_generated_prose(current.revision, conditional_update)
        .unwrap_err()
        .contains("changed before its draft could be accepted"));
    assert_eq!(db.read().unwrap(), current);
    assert_eq!(
        db.generation_job(&job.id).unwrap().unwrap().status,
        domain::GenerationJobStatus::Completed
    );
    assert!(db
        .accepted_prose_revisions_for_scene(&scene_id)
        .unwrap()
        .is_empty());
    connection
        .execute_batch("DROP TRIGGER ignore_job_acceptance;")
        .unwrap();
}

#[test]
fn draft_acceptance_rejects_pending_failed_interrupted_and_discarded_jobs() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let pending = generation_job(&scene_id, p.revision, 50);
    db.create_generation_job(&pending).unwrap();
    let revision = |job_id: String, accepted_at_ms| domain::AcceptedProseRevision {
        id: new_id(),
        job_id,
        scene_id: scene_id.clone(),
        previous_prose: String::new(),
        accepted_prose: String::new(),
        accepted_at_ms,
    };

    assert!(db
        .accept_generated_prose(p.revision, revision(pending.id.clone(), 51))
        .unwrap_err()
        .contains("completed or stopped"));

    let failed = generation_job(&scene_id, p.revision, 52);
    db.create_generation_job(&failed).unwrap();
    db.checkpoint_generation_job(
        &failed.id,
        domain::GenerationJobStatus::Failed,
        "A partial draft.".into(),
        Some("Synthetic provider error.".into()),
        53,
    )
    .unwrap();
    assert!(db
        .accept_generated_prose(p.revision, revision(failed.id.clone(), 54))
        .unwrap_err()
        .contains("completed or stopped"));

    let interrupted = generation_job(&scene_id, p.revision, 55);
    db.create_generation_job(&interrupted).unwrap();
    db.interrupt_unfinished_generation_jobs(56).unwrap();
    assert!(db
        .accept_generated_prose(p.revision, revision(interrupted.id.clone(), 57))
        .unwrap_err()
        .contains("completed or stopped"));

    let discarded = generation_job(&scene_id, p.revision, 58);
    db.create_generation_job(&discarded).unwrap();
    db.checkpoint_generation_job(
        &discarded.id,
        domain::GenerationJobStatus::Streaming,
        "Partial draft.".into(),
        None,
        59,
    )
    .unwrap();
    db.checkpoint_generation_job(
        &discarded.id,
        domain::GenerationJobStatus::Stopped,
        "Partial draft.".into(),
        None,
        60,
    )
    .unwrap();
    db.checkpoint_generation_job(
        &discarded.id,
        domain::GenerationJobStatus::Discarded,
        "Partial draft.".into(),
        None,
        61,
    )
    .unwrap();
    assert!(db
        .accept_generated_prose(p.revision, revision(discarded.id.clone(), 62))
        .unwrap_err()
        .contains("completed or stopped"));

    assert_eq!(db.read().unwrap(), p);
    assert!(db
        .accepted_prose_revisions_for_scene(&scene_id)
        .unwrap()
        .is_empty());
}

#[test]
fn stopped_partial_generation_can_be_accepted_deliberately() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let scene_id = p.scenes[0].id.clone();
    let job = generation_job(&scene_id, p.revision, 70);
    db.create_generation_job(&job).unwrap();
    let partial = "Maya lets the needle rest for a moment.";
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Streaming,
        partial.into(),
        None,
        71,
    )
    .unwrap();
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Stopped,
        partial.into(),
        None,
        72,
    )
    .unwrap();

    let accepted = db
        .accept_generated_prose(
            p.revision,
            domain::AcceptedProseRevision {
                id: new_id(),
                job_id: job.id.clone(),
                scene_id: scene_id.clone(),
                previous_prose: String::new(),
                accepted_prose: partial.into(),
                accepted_at_ms: 73,
            },
        )
        .unwrap();
    assert_eq!(accepted.scenes[0].prose, partial);
    assert_eq!(
        db.generation_job(&job.id).unwrap().unwrap().status,
        domain::GenerationJobStatus::Accepted
    );
}

#[test]
fn unfinished_generation_is_marked_interrupted_without_resending() {
    let file = ProjectFile::new();
    let mut db = file.create();
    let p = scene(&mut db);
    let job = generation_job(&p.scenes[0].id, p.revision, 20);
    db.create_generation_job(&job).unwrap();
    db.checkpoint_generation_job(
        &job.id,
        domain::GenerationJobStatus::Streaming,
        "Partial output.".into(),
        None,
        21,
    )
    .unwrap();

    assert_eq!(db.interrupt_unfinished_generation_jobs(22).unwrap(), 1);
    let interrupted = db.generation_job(&job.id).unwrap().unwrap();
    assert_eq!(interrupted.status, domain::GenerationJobStatus::Interrupted);
    assert_eq!(interrupted.draft_text, "Partial output.");
    assert!(db
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Completed,
            "Do not auto-resend.".into(),
            None,
            23,
        )
        .is_err());
    let discarded = db
        .checkpoint_generation_job(
            &job.id,
            domain::GenerationJobStatus::Discarded,
            interrupted.draft_text,
            None,
            24,
        )
        .unwrap();
    assert_eq!(discarded.status, domain::GenerationJobStatus::Discarded);
}
