use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project_id: String,
    pub title: String,
    pub revision: u64,
    pub chapters: Vec<Chapter>,
    pub scenes: Vec<Scene>,
    pub characters: Vec<Character>,
    pub trash: Vec<TrashEntry>,
    pub import_sources: Vec<ImportedSource>,
    pub can_undo: bool,
    pub can_redo: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub scene_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Narration {
    pub point_of_view: String,
    pub tense: String,
    pub instructions: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub chapter_id: String,
    pub title: String,
    pub summary: String,
    pub tone: String,
    #[serde(default)]
    pub prose: String,
    pub narration: Narration,
    pub beats: Vec<Beat>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GenerationJobStatus {
    Pending,
    Streaming,
    Completed,
    Stopped,
    Failed,
    Interrupted,
    Accepted,
    Discarded,
}

impl GenerationJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Streaming => "streaming",
            Self::Completed => "completed",
            Self::Stopped => "stopped",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
            Self::Accepted => "accepted",
            Self::Discarded => "discarded",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        use GenerationJobStatus::*;
        match self {
            Pending => matches!(next, Streaming | Stopped | Failed | Interrupted),
            Streaming => matches!(next, Streaming | Completed | Stopped | Failed | Interrupted),
            Completed | Stopped => matches!(next, Accepted | Discarded),
            Failed | Interrupted => next == Discarded,
            Accepted | Discarded => false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJob {
    pub id: String,
    pub scene_id: String,
    pub scene_revision: u64,
    pub connection_id: String,
    pub model: String,
    pub request_snapshot: Value,
    pub input_fingerprint: String,
    pub status: GenerationJobStatus,
    pub draft_text: String,
    pub error_message: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedProseRevision {
    pub id: String,
    pub job_id: String,
    pub scene_id: String,
    pub previous_prose: String,
    pub accepted_prose: String,
    pub accepted_at_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Beat {
    pub id: String,
    pub document: Value,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    pub background: String,
    pub voice: String,
    pub personality: String,
    pub archived: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub deleted_at_revision: u64,
    pub payload: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSource {
    pub id: String,
    pub markdown: String,
    pub imported_at_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    RenameProject {
        title: String,
    },
    CreateChapter {
        title: String,
    },
    RenameChapter {
        chapter_id: String,
        title: String,
    },
    ReorderChapters {
        ids: Vec<String>,
    },
    DeleteChapter {
        chapter_id: String,
    },
    CreateScene {
        chapter_id: String,
        title: String,
    },
    UpdateScene {
        scene_id: String,
        title: Option<String>,
        summary: Option<String>,
        tone: Option<String>,
        prose: Option<String>,
        narration: Option<Narration>,
    },
    DuplicateScene {
        scene_id: String,
    },
    ReorderScenes {
        chapter_id: String,
        ids: Vec<String>,
    },
    DeleteScene {
        scene_id: String,
    },
    CreateBeat {
        scene_id: String,
        document: Value,
        text: String,
    },
    UpdateBeat {
        beat_id: String,
        document: Value,
        text: String,
    },
    DuplicateBeat {
        beat_id: String,
    },
    ReorderBeats {
        scene_id: String,
        ids: Vec<String>,
    },
    DeleteBeat {
        beat_id: String,
    },
    RestoreTrash {
        trash_id: String,
    },
    CreateCharacter {
        name: String,
    },
    UpdateCharacter {
        character_id: String,
        name: Option<String>,
        background: Option<String>,
        voice: Option<String>,
        personality: Option<String>,
        archived: Option<bool>,
    },
    Undo,
    Redo,
}

fn title(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 1000 || value.contains(['\r', '\n', '\0']) {
        Err("Titles and names must contain 1–1000 bytes on one line.".into())
    } else {
        Ok(())
    }
}
fn permutation(actual: &[String], proposed: &[String]) -> Result<()> {
    let a: HashSet<_> = actual.iter().collect();
    let b: HashSet<_> = proposed.iter().collect();
    if actual.len() != proposed.len() || b.len() != proposed.len() || a != b {
        Err("Reorder must contain each current ID exactly once.".into())
    } else {
        Ok(())
    }
}

/// Validate the supported Tiptap document subset and derive its portable text.
/// Character names resolve from the project library, including archived profiles.
fn document_text(document: &Value, characters: &[Character]) -> Result<String> {
    fn node(
        value: &Value,
        characters: &[Character],
        depth: usize,
        count: &mut usize,
    ) -> Result<String> {
        *count += 1;
        if depth > 64 || *count > 100_000 {
            return Err("Beat document is too complex.".into());
        }
        let object = value.as_object().ok_or("Document nodes must be objects.")?;
        let kind = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or("Document node needs a type.")?;
        if let Some(marks) = object.get("marks") {
            for mark in marks.as_array().ok_or("Node marks must be an array.")? {
                match mark["type"].as_str().ok_or("Mark needs a type.")? {
                    "bold" | "italic" | "strike" | "code" | "underline" => {}
                    "link" => {
                        let href = mark["attrs"]["href"]
                            .as_str()
                            .ok_or("Link needs an href.")?;
                        if !["https://", "http://", "mailto:"]
                            .iter()
                            .any(|prefix| href.to_ascii_lowercase().starts_with(prefix))
                        {
                            return Err("Links must use HTTP, HTTPS, or mailto.".into());
                        }
                    }
                    _ => return Err("Unsupported document mark.".into()),
                }
            }
        }
        let children: &[Value] = match object.get("content") {
            Some(v) => v.as_array().ok_or("Node content must be an array.")?,
            None => &[],
        };
        match kind {
            "text" => {
                if !children.is_empty() {
                    return Err("Text nodes cannot contain nodes.".into());
                }
                Ok(object
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or("Text node needs text.")?
                    .into())
            }
            "characterReference" => {
                if !children.is_empty() {
                    return Err("Character references cannot contain nodes.".into());
                }
                let attrs = object
                    .get("attrs")
                    .and_then(Value::as_object)
                    .ok_or("Character reference needs attributes.")?;
                let id = attrs
                    .get("characterId")
                    .and_then(Value::as_str)
                    .ok_or("Character reference needs a character ID.")?;
                for field in ["label", "emotion", "delivery"] {
                    if let Some(v) = attrs.get(field) {
                        if !v.as_str().is_some_and(|s| s.len() <= 1000) {
                            return Err(
                                "Character reference attributes must be short strings.".into()
                            );
                        }
                    }
                }
                Ok(characters
                    .iter()
                    .find(|c| c.id == id)
                    .ok_or("Character reference points to an unknown profile.")?
                    .name
                    .clone())
            }
            "hardBreak" | "horizontalRule" => {
                if !children.is_empty() {
                    return Err("Break nodes cannot contain nodes.".into());
                }
                Ok(if kind == "hardBreak" { "\n" } else { "---" }.into())
            }
            "doc" | "paragraph" | "heading" | "blockquote" | "bulletList" | "orderedList"
            | "listItem" | "codeBlock" => {
                if kind == "heading"
                    && !value["attrs"]["level"]
                        .as_u64()
                        .is_some_and(|v| (1..=6).contains(&v))
                {
                    return Err("Heading level must be 1–6.".into());
                }
                if kind == "orderedList" && value["attrs"]["start"].as_i64().is_some_and(|v| v < 1)
                {
                    return Err("List start must be positive.".into());
                }
                let mut parts = Vec::new();
                for child in children {
                    let child_kind = child["type"]
                        .as_str()
                        .ok_or("Document child needs a type.")?;
                    let inline = ["text", "hardBreak", "characterReference"].contains(&child_kind);
                    let allowed = match kind {
                        "paragraph" | "heading" => inline,
                        "codeBlock" => child_kind == "text",
                        "bulletList" | "orderedList" => child_kind == "listItem",
                        _ => !inline && child_kind != "doc" && child_kind != "listItem",
                    };
                    if !allowed {
                        return Err(format!("Unsupported {child_kind} inside {kind}."));
                    }
                    parts.push(node(child, characters, depth + 1, count)?);
                }
                let separator = if ["paragraph", "heading", "codeBlock"].contains(&kind) {
                    ""
                } else {
                    "\n\n"
                };
                Ok(parts.join(separator))
            }
            _ => Err(format!("Unsupported document node: {kind}.")),
        }
    }
    if document["type"].as_str() != Some("doc") {
        return Err("Beat document root must be type doc.".into());
    }
    node(document, characters, 0, &mut 0)
}
fn reorder<T, F: Fn(&T) -> &str>(items: &mut [T], ids: &[String], get: F) -> Result<()> {
    permutation(
        &items.iter().map(|v| get(v).to_string()).collect::<Vec<_>>(),
        ids,
    )?;
    items.sort_by_key(|v| ids.iter().position(|id| id == get(v)).unwrap());
    Ok(())
}

impl ProjectSnapshot {
    pub fn empty(name: String) -> Result<Self> {
        title(&name)?;
        Ok(Self {
            project_id: new_id(),
            title: name,
            revision: 0,
            chapters: vec![],
            scenes: vec![],
            characters: vec![],
            trash: vec![],
            import_sources: vec![],
            can_undo: false,
            can_redo: false,
        })
    }
    fn chapter_mut(&mut self, id: &str) -> Result<&mut Chapter> {
        self.chapters
            .iter_mut()
            .find(|v| v.id == id)
            .ok_or_else(|| "Chapter does not exist.".into())
    }
    fn scene_mut(&mut self, id: &str) -> Result<&mut Scene> {
        self.scenes
            .iter_mut()
            .find(|v| v.id == id)
            .ok_or_else(|| "Scene does not exist.".into())
    }
    fn beat_location(&self, id: &str) -> Result<(usize, usize)> {
        self.scenes
            .iter()
            .enumerate()
            .find_map(|(si, s)| s.beats.iter().position(|b| b.id == id).map(|bi| (si, bi)))
            .ok_or_else(|| "Beat does not exist.".into())
    }
    fn trash(&mut self, kind: &str, name: String, payload: Value) {
        self.trash.push(TrashEntry {
            id: new_id(),
            kind: kind.into(),
            title: name,
            deleted_at_revision: self.revision + 1,
            payload,
        });
    }
    pub fn apply(&mut self, operation: Operation) -> Result<()> {
        match operation {
            Operation::RenameProject { title: name } => {
                title(&name)?;
                self.title = name;
            }
            Operation::CreateChapter { title: name } => {
                title(&name)?;
                self.chapters.push(Chapter {
                    id: new_id(),
                    title: name,
                    scene_ids: vec![],
                });
            }
            Operation::RenameChapter {
                chapter_id,
                title: name,
            } => {
                title(&name)?;
                self.chapter_mut(&chapter_id)?.title = name;
            }
            Operation::ReorderChapters { ids } => reorder(&mut self.chapters, &ids, |c| &c.id)?,
            Operation::DeleteChapter { chapter_id } => {
                let pos = self
                    .chapters
                    .iter()
                    .position(|c| c.id == chapter_id)
                    .ok_or("Chapter does not exist.")?;
                let chapter = self.chapters.remove(pos);
                let scenes: Vec<_> = self
                    .scenes
                    .iter()
                    .filter(|s| s.chapter_id == chapter_id)
                    .cloned()
                    .collect();
                self.scenes.retain(|s| s.chapter_id != chapter_id);
                self.trash(
                    "chapter",
                    chapter.title.clone(),
                    json!({"chapter":chapter,"scenes":scenes,"position":pos}),
                );
            }
            Operation::CreateScene {
                chapter_id,
                title: name,
            } => {
                title(&name)?;
                let id = new_id();
                self.chapter_mut(&chapter_id)?.scene_ids.push(id.clone());
                self.scenes.push(Scene {
                    id,
                    chapter_id,
                    title: name,
                    summary: String::new(),
                    tone: String::new(),
                    prose: String::new(),
                    narration: Narration::default(),
                    beats: vec![],
                });
            }
            Operation::UpdateScene {
                scene_id,
                title: name,
                summary,
                tone,
                prose,
                narration,
            } => {
                if let Some(ref name) = name {
                    title(name)?;
                }
                let scene = self.scene_mut(&scene_id)?;
                if let Some(v) = name {
                    scene.title = v;
                }
                if let Some(v) = summary {
                    scene.summary = v;
                }
                if let Some(v) = tone {
                    scene.tone = v;
                }
                if let Some(v) = prose {
                    scene.prose = v;
                }
                if let Some(v) = narration {
                    scene.narration = v;
                }
            }
            Operation::DuplicateScene { scene_id } => {
                let mut scene = self.scene_mut(&scene_id)?.clone();
                scene.id = new_id();
                scene.title.push_str(" (copy)");
                for beat in &mut scene.beats {
                    beat.id = new_id();
                }
                let chapter = self.chapter_mut(&scene.chapter_id)?;
                let pos = chapter
                    .scene_ids
                    .iter()
                    .position(|id| id == &scene_id)
                    .ok_or("Scene order is invalid.")?;
                chapter.scene_ids.insert(pos + 1, scene.id.clone());
                self.scenes.push(scene);
            }
            Operation::ReorderScenes { chapter_id, ids } => {
                let chapter = self.chapter_mut(&chapter_id)?;
                permutation(&chapter.scene_ids, &ids)?;
                chapter.scene_ids = ids;
            }
            Operation::DeleteScene { scene_id } => {
                let pos = self
                    .scenes
                    .iter()
                    .position(|s| s.id == scene_id)
                    .ok_or("Scene does not exist.")?;
                let scene = self.scenes.remove(pos);
                let chapter = self.chapter_mut(&scene.chapter_id)?;
                let position = chapter
                    .scene_ids
                    .iter()
                    .position(|id| id == &scene_id)
                    .ok_or("Scene order is invalid.")?;
                chapter.scene_ids.remove(position);
                self.trash(
                    "scene",
                    scene.title.clone(),
                    json!({"scene":scene,"position":position}),
                );
            }
            Operation::CreateBeat {
                scene_id,
                document,
                text,
            } => self.scene_mut(&scene_id)?.beats.push(Beat {
                id: new_id(),
                document,
                text,
            }),
            Operation::UpdateBeat {
                beat_id,
                document,
                text,
            } => {
                let (s, b) = self.beat_location(&beat_id)?;
                self.scenes[s].beats[b].document = document;
                self.scenes[s].beats[b].text = text;
            }
            Operation::DuplicateBeat { beat_id } => {
                let (s, b) = self.beat_location(&beat_id)?;
                let mut beat = self.scenes[s].beats[b].clone();
                beat.id = new_id();
                self.scenes[s].beats.insert(b + 1, beat);
            }
            Operation::ReorderBeats { scene_id, ids } => {
                reorder(&mut self.scene_mut(&scene_id)?.beats, &ids, |b| &b.id)?
            }
            Operation::DeleteBeat { beat_id } => {
                let (s, b) = self.beat_location(&beat_id)?;
                let beat = self.scenes[s].beats.remove(b);
                let scene_id = self.scenes[s].id.clone();
                self.trash(
                    "beat",
                    beat.text.chars().take(80).collect(),
                    json!({"beat":beat,"sceneId":scene_id,"position":b}),
                );
            }
            Operation::RestoreTrash { trash_id } => {
                let pos = self
                    .trash
                    .iter()
                    .position(|t| t.id == trash_id)
                    .ok_or("Trash entry does not exist.")?;
                let entry = self.trash[pos].clone();
                let position = entry.payload["position"]
                    .as_u64()
                    .ok_or("Invalid Trash position.")? as usize;
                match entry.kind.as_str() {
                    "chapter" => {
                        let chapter: Chapter =
                            serde_json::from_value(entry.payload["chapter"].clone())
                                .map_err(|e| e.to_string())?;
                        let scenes: Vec<Scene> =
                            serde_json::from_value(entry.payload["scenes"].clone())
                                .map_err(|e| e.to_string())?;
                        self.chapters
                            .insert(position.min(self.chapters.len()), chapter);
                        self.scenes.extend(scenes);
                    }
                    "scene" => {
                        let scene: Scene = serde_json::from_value(entry.payload["scene"].clone())
                            .map_err(|e| e.to_string())?;
                        let chapter = self
                            .chapter_mut(&scene.chapter_id)
                            .map_err(|_| "Restore the scene's chapter first.")?;
                        chapter
                            .scene_ids
                            .insert(position.min(chapter.scene_ids.len()), scene.id.clone());
                        self.scenes.push(scene);
                    }
                    "beat" => {
                        let beat: Beat = serde_json::from_value(entry.payload["beat"].clone())
                            .map_err(|e| e.to_string())?;
                        let scene_id = entry.payload["sceneId"]
                            .as_str()
                            .ok_or("Invalid Trash scene.")?;
                        let scene = self
                            .scene_mut(scene_id)
                            .map_err(|_| "Restore the beat's scene first.")?;
                        scene.beats.insert(position.min(scene.beats.len()), beat);
                    }
                    _ => return Err("Unknown Trash entry kind.".into()),
                }
                self.trash.remove(pos);
            }
            Operation::CreateCharacter { name } => {
                title(&name)?;
                self.characters.push(Character {
                    id: new_id(),
                    name,
                    background: String::new(),
                    voice: String::new(),
                    personality: String::new(),
                    archived: false,
                });
            }
            Operation::UpdateCharacter {
                character_id,
                name,
                background,
                voice,
                personality,
                archived,
            } => {
                if let Some(ref name) = name {
                    title(name)?;
                }
                let c = self
                    .characters
                    .iter_mut()
                    .find(|c| c.id == character_id)
                    .ok_or("Character does not exist.")?;
                if let Some(v) = name {
                    c.name = v;
                }
                if let Some(v) = background {
                    c.background = v;
                }
                if let Some(v) = voice {
                    c.voice = v;
                }
                if let Some(v) = personality {
                    c.personality = v;
                }
                if let Some(v) = archived {
                    c.archived = v;
                }
            }
            Operation::Undo | Operation::Redo => {
                return Err("History operations require a project transaction.".into())
            }
        }
        for scene in &mut self.scenes {
            for beat in &mut scene.beats {
                beat.text = document_text(&beat.document, &self.characters)?;
            }
        }
        self.validate()
    }
    pub fn validate(&self) -> Result<()> {
        title(&self.title)?;
        let mut ids = HashSet::new();
        let mut add = |id: &str| -> Result<()> {
            Uuid::parse_str(id).map_err(|_| "Invalid entity ID.")?;
            if !ids.insert(id.to_string()) {
                return Err("Duplicate entity ID.".into());
            }
            Ok(())
        };
        add(&self.project_id)?;
        let mut ordered_scenes = HashSet::new();
        for c in &self.chapters {
            add(&c.id)?;
            title(&c.title)?;
            for id in &c.scene_ids {
                if !ordered_scenes.insert(id) {
                    return Err("Scene appears more than once in chapter order.".into());
                }
                if !self
                    .scenes
                    .iter()
                    .any(|s| &s.id == id && s.chapter_id == c.id)
                {
                    return Err("Scene has an invalid chapter reference.".into());
                }
            }
        }
        if ordered_scenes.len() != self.scenes.len() {
            return Err("Every scene must appear in chapter order.".into());
        }
        for s in &self.scenes {
            add(&s.id)?;
            title(&s.title)?;
            if s.prose.len() > 10_000_000 {
                return Err("Scene prose exceeds the 10 MB limit.".into());
            }
            for b in &s.beats {
                add(&b.id)?;
                if !b.document.is_object() {
                    return Err("Beat document must be a structured JSON object.".into());
                }
                if serde_json::to_vec(&b.document)
                    .map_err(|e| e.to_string())?
                    .len()
                    > 4_000_000
                    || b.text.len() > 4_000_000
                {
                    return Err("Beat exceeds the 4 MB limit.".into());
                }
                if b.text != document_text(&b.document, &self.characters)? {
                    return Err("Beat text does not match its structured document.".into());
                }
            }
        }
        for c in &self.characters {
            add(&c.id)?;
            title(&c.name)?;
        }
        for t in &self.trash {
            add(&t.id)?;
        }
        for source in &self.import_sources {
            add(&source.id)?;
        }
        Ok(())
    }
    pub fn markdown(&self) -> String {
        let mut out = format!("# {}\n\n", self.title);
        for chapter in &self.chapters {
            out.push_str(&format!("## {}\n\n", chapter.title));
            for id in &chapter.scene_ids {
                if let Some(scene) = self.scenes.iter().find(|s| &s.id == id) {
                    out.push_str(&format!("### {}\n\n", scene.title));
                    if !scene.summary.is_empty() {
                        out.push_str(&format!(
                            "> Summary: {}\n\n",
                            scene.summary.replace('\n', "\n> ")
                        ));
                    }
                    for beat in &scene.beats {
                        out.push_str(&beat.text);
                        out.push_str("\n\n");
                    }
                }
            }
        }
        out
    }
    /// Explicit plain Markdown import: headings establish chapters/scenes; paragraphs become beats.
    /// The original source is retained in the structured document on every imported beat.
    pub fn import_markdown(&mut self, markdown: &str) -> Result<()> {
        if markdown.trim().is_empty() {
            return Err("Markdown is empty.".into());
        }
        if markdown.len() > 16_000_000 {
            return Err("Markdown exceeds the 16 MB import limit.".into());
        }
        let mut chapter_id: Option<String> = None;
        let mut scene_id: Option<String> = None;
        let mut paragraph = String::new();
        fn flush(
            project: &mut ProjectSnapshot,
            chapter: &mut Option<String>,
            scene: &mut Option<String>,
            paragraph: &mut String,
        ) -> Result<()> {
            if paragraph.trim().is_empty() {
                paragraph.clear();
                return Ok(());
            }
            if chapter.is_none() {
                project.apply(Operation::CreateChapter {
                    title: "Imported chapter".into(),
                })?;
                *chapter = Some(project.chapters.last().unwrap().id.clone());
            }
            if scene.is_none() {
                project.apply(Operation::CreateScene {
                    chapter_id: chapter.clone().unwrap(),
                    title: "Imported scene".into(),
                })?;
                *scene = Some(project.scenes.last().unwrap().id.clone());
            }
            let text = paragraph.trim_end().to_string();
            project.apply(Operation::CreateBeat { scene_id:scene.clone().unwrap(), document:json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}],"importedMarkdown":text}), text })?;
            paragraph.clear();
            Ok(())
        }
        let mut fenced = false;
        for line in markdown.lines() {
            if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
                fenced = !fenced;
            }
            if !fenced && (line.starts_with("## ") || line.starts_with("### ")) {
                flush(self, &mut chapter_id, &mut scene_id, &mut paragraph)?;
                if let Some(name) = line.strip_prefix("## ") {
                    self.apply(Operation::CreateChapter {
                        title: name.trim().into(),
                    })?;
                    chapter_id = Some(self.chapters.last().unwrap().id.clone());
                    scene_id = None;
                } else if let Some(name) = line.strip_prefix("### ") {
                    if chapter_id.is_none() {
                        self.apply(Operation::CreateChapter {
                            title: "Imported chapter".into(),
                        })?;
                        chapter_id = Some(self.chapters.last().unwrap().id.clone());
                    }
                    self.apply(Operation::CreateScene {
                        chapter_id: chapter_id.clone().unwrap(),
                        title: name.trim().into(),
                    })?;
                    scene_id = Some(self.scenes.last().unwrap().id.clone());
                }
            } else if line.is_empty() && !fenced {
                flush(self, &mut chapter_id, &mut scene_id, &mut paragraph)?;
            } else {
                paragraph.push_str(line);
                paragraph.push('\n');
            }
        }
        flush(self, &mut chapter_id, &mut scene_id, &mut paragraph)?;
        self.import_sources.push(ImportedSource {
            id: new_id(),
            markdown: markdown.into(),
            imported_at_revision: self.revision + 1,
        });
        self.validate()
    }
}
