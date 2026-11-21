use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
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
    #[serde(default)]
    pub tones: Vec<Preset>,
    #[serde(default)]
    pub emotions: Vec<Preset>,
    #[serde(default)]
    pub starter_types: Vec<String>,
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
    #[serde(default)]
    pub summary_document: Option<Value>,
    pub tone: String,
    #[serde(default)]
    pub tone_id: String,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    #[serde(default)]
    pub default_tone_id: String,
    #[serde(default)]
    pub default_emotion_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub meaning: String,
    pub guidance: String,
    pub example: String,
    #[serde(default, deserialize_with = "deserialize_preset_color", skip_serializing_if = "String::is_empty")]
    pub color: String,
    pub archived: bool,
    pub revision: u64,
}

fn normalize_preset_color(value: &str) -> Result<String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err("Reusable block color must be empty or a #RRGGBB hex value.".into());
    }
    Ok(value.to_ascii_uppercase())
}

const CHARACTER_ICONS: &[&str] = &[
    "user",
    "crown",
    "coins",
    "swords",
    "shield",
    "book-open",
    "feather",
    "heart",
    "sparkles",
    "wand-sparkles",
    "skull",
    "search",
    "fingerprint",
    "key-round",
    "drama",
    "glasses",
    "graduation-cap",
    "trophy",
    "flame",
    "theater",
    "flask-conical",
    "compass",
    "ghost",
    "smile",
    "music",
    "gem",
    "star",
    "moon",
    "hat-glasses",
    "hand-heart",
    "briefcase",
    "bird",
];

fn normalize_character_icon(value: &str) -> Result<String> {
    if value.is_empty() || CHARACTER_ICONS.contains(&value) {
        Ok(value.to_owned())
    } else {
        Err("Character icon is not supported.".into())
    }
}

fn deserialize_preset_color<'de, D>(deserializer: D) -> std::result::Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    normalize_preset_color(&value).map_err(serde::de::Error::custom)
}

#[derive(Deserialize)]
struct StarterCatalog {
    version: u32,
    tones: Vec<StarterPreset>,
    emotions: Vec<StarterPreset>,
}
#[derive(Deserialize)]
struct StarterPreset {
    name: String,
    meaning: String,
    guidance: String,
    example: String,
    #[serde(default)]
    color: String,
}
fn starter_catalog() -> &'static StarterCatalog {
    static CATALOG: std::sync::OnceLock<StarterCatalog> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/content/starter-presets.json"))
            .expect("The bundled starter catalog is valid JSON")
    })
}
fn original_starter_guidance(kind: PresetKind, name: &str) -> Option<&'static str> {
    match (kind, name) {
        (PresetKind::Tone, "Tender") => Some("Emphasize small gestures of care, warmth, and vulnerability."),
        (PresetKind::Tone, "Tense") => Some("Emphasize uncertainty and restrained pressure without inventing extra danger."),
        (PresetKind::Tone, "Playful") => Some("Allow light teasing and gentle humor while preserving character voice."),
        (PresetKind::Emotion, "Serious") => Some("Focused and restrained; keep attention on the immediate task."),
        (PresetKind::Emotion, "Awe") => Some("Let wonder or admiration interrupt the character's usual reactions."),
        (PresetKind::Emotion, "Angry") => Some("Show irritation or frustration through responses and actions, without requiring shouting."),
        (PresetKind::Emotion, "Embarrassed") => Some("Show self-consciousness through hesitation, deflection, or awkward reactions."),
        _ => None,
    }
}
fn catalog_marker_version(marker: &str, kind: PresetKind) -> Option<u32> {
    marker
        .strip_prefix(&format!("{}:catalog-v", kind.as_str()))?
        .parse()
        .ok()
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PresetKind {
    Tone,
    Emotion,
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
        summary_document: Option<Value>,
        tone: Option<String>,
        tone_id: Option<String>,
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
        background: Option<String>,
        personality: Option<String>,
        voice: Option<String>,
        #[serde(default)]
        icon: Option<String>,
        default_tone_id: Option<String>,
        default_emotion_id: Option<String>,
    },
    DuplicateCharacter {
        character_id: String,
    },
    DeleteCharacter {
        character_id: String,
    },
    UpdateCharacter {
        character_id: String,
        name: Option<String>,
        background: Option<String>,
        voice: Option<String>,
        personality: Option<String>,
        archived: Option<bool>,
        #[serde(default)]
        icon: Option<String>,
        default_tone_id: Option<String>,
        default_emotion_id: Option<String>,
    },
    CreatePreset {
        kind: PresetKind,
        name: String,
        #[serde(default)]
        color: Option<String>,
    },
    UpdatePreset {
        kind: PresetKind,
        preset_id: String,
        name: Option<String>,
        meaning: Option<String>,
        guidance: Option<String>,
        example: Option<String>,
        archived: Option<bool>,
        #[serde(default)]
        color: Option<String>,
    },
    DuplicatePreset {
        kind: PresetKind,
        preset_id: String,
    },
    DeletePreset {
        kind: PresetKind,
        preset_id: String,
    },
    AddStarterPresets {
        kind: PresetKind,
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
impl PresetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tone => "tone",
            Self::Emotion => "emotion",
        }
    }
}

pub fn walk_nodes(value: &Value, action: &mut impl FnMut(&Value)) {
    action(value);
    if let Some(nodes) = value.get("content").and_then(Value::as_array) {
        for child in nodes {
            walk_nodes(child, action);
        }
    }
}
fn walk_nodes_mut(value: &mut Value, action: &mut impl FnMut(&mut Value)) {
    action(value);
    if let Some(nodes) = value.get_mut("content").and_then(Value::as_array_mut) {
        for child in nodes {
            walk_nodes_mut(child, action);
        }
    }
}
pub fn normalize_occurrences(document: &mut Value, beat_id: &str) {
    let mut index = 0;
    walk_nodes_mut(document, &mut |node| {
        if node["type"] == "characterReference" {
            let missing = node["attrs"]["occurrenceId"]
                .as_str()
                .is_none_or(str::is_empty);
            if missing {
                node["attrs"]["occurrenceId"] = json!(format!("{beat_id}:legacy:{index}"));
            }
            index += 1;
        }
    });
}
pub(super) fn refresh_occurrences(document: &mut Value) {
    let mut ids = HashMap::new();
    walk_nodes_mut(document, &mut |node| {
        if node["type"] == "characterReference" {
            let old = node["attrs"]["occurrenceId"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let next = new_id();
            if !old.is_empty() {
                ids.insert(old, next.clone());
            }
            node["attrs"]["occurrenceId"] = json!(next);
        }
    });
    walk_nodes_mut(document, &mut |node| {
        if node["type"] == "emotionReference" {
            let old = node["attrs"]["targetOccurrenceId"]
                .as_str()
                .unwrap_or_default();
            if !old.is_empty() {
                if let Some(next) = ids.get(old) {
                    node["attrs"]["targetOccurrenceId"] = json!(next);
                }
            }
        }
    });
}
fn value_uses(value: &Value, key: &str, id: &str) -> bool {
    match value {
        Value::Object(map) => map
            .iter()
            .any(|(k, v)| (k == key && v.as_str() == Some(id)) || value_uses(v, key, id)),
        Value::Array(values) => values.iter().any(|v| value_uses(v, key, id)),
        _ => false,
    }
}
pub fn plain_document(text: &str) -> Value {
    let content: Vec<Value> = text
        .split('\n')
        .map(|part| {
            if part.is_empty() {
                json!({"type":"paragraph"})
            } else {
                json!({"type":"paragraph","content":[{"type":"text","text":part}]})
            }
        })
        .collect();
    json!({"type":"doc","content":content})
}

/// Old projects keep their summary and optional tone as one editable board.
pub fn summary_document(scene: &Scene, tones: &[Preset]) -> Value {
    let legacy = scene.summary_document.is_none();
    let mut document = scene
        .summary_document
        .clone()
        .unwrap_or_else(|| plain_document(&scene.summary));
    let mut has_tone = false;
    walk_nodes(&document, &mut |node| {
        if node["type"] == "toneReference" {
            has_tone = true;
        }
    });
    if let Some(tone) = tones
        .iter()
        .find(|tone| !has_tone && tone.id == scene.tone_id)
    {
        if !document["content"].is_array() {
            if !document["content"].is_null() {
                return document;
            }
            document["content"] = json!([]);
        }
        if document["content"][0]["type"] != "paragraph" {
            document["content"]
                .as_array_mut()
                .unwrap()
                .insert(0, json!({"type":"paragraph"}));
        }
        let paragraph = &mut document["content"][0];
        if paragraph["content"].is_null() {
            paragraph["content"] = json!([]);
        }
        paragraph["content"].as_array_mut().unwrap().insert(
            0,
            json!({"type":"toneReference","attrs":{"toneId":tone.id,"label":tone.name}}),
        );
    }
    if legacy && scene.tone_id.is_empty() && !scene.tone.trim().is_empty() {
        document["content"].as_array_mut().unwrap().push(json!({"type":"paragraph","content":[{"type":"text","text":format!("Scene tone: {}", scene.tone)}]}));
    }
    document
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
pub(super) fn document_text(
    document: &Value,
    characters: &[Character],
    tones: &[Preset],
    emotions: &[Preset],
) -> Result<String> {
    fn node(
        value: &Value,
        characters: &[Character],
        tones: &[Preset],
        emotions: &[Preset],
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
            "toneReference" | "emotionReference" => {
                if !children.is_empty() {
                    return Err("Reusable references cannot contain nodes.".into());
                }
                let (entries, key, label) = if kind == "toneReference" {
                    (tones, "toneId", "Tone")
                } else {
                    (emotions, "emotionId", "Emotion")
                };
                let id = value["attrs"][key]
                    .as_str()
                    .ok_or("Reusable reference needs an ID.")?;
                let p = entries
                    .iter()
                    .find(|p| p.id == id)
                    .ok_or("Reusable reference points to an unknown definition.")?;
                Ok(format!("[{label}: {}]", p.name))
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
                    let inline = [
                        "text",
                        "hardBreak",
                        "characterReference",
                        "toneReference",
                        "emotionReference",
                    ]
                    .contains(&child_kind);
                    let allowed = match kind {
                        "paragraph" | "heading" => inline,
                        "codeBlock" => child_kind == "text",
                        "bulletList" | "orderedList" => child_kind == "listItem",
                        _ => !inline && child_kind != "doc" && child_kind != "listItem",
                    };
                    if !allowed {
                        return Err(format!("Unsupported {child_kind} inside {kind}."));
                    }
                    parts.push(node(child, characters, tones, emotions, depth + 1, count)?);
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
    let mut occurrences = HashSet::new();
    let mut invalid = false;
    walk_nodes(document, &mut |value| match value["type"].as_str() {
        Some("characterReference") => {
            if let Some(id) = value["attrs"]["occurrenceId"]
                .as_str()
                .filter(|v| !v.is_empty())
            {
                if id.len() > 256 || !occurrences.insert(id.to_owned()) {
                    invalid = true;
                }
            }
        }
        Some("emotionReference") => {
            // Older documents may retain an explicit occurrence target. New
            // emotion references are freeform tokens and need no target.
            if value["attrs"].as_object().is_none_or(|attrs| {
                attrs
                    .get("targetOccurrenceId")
                    .is_some_and(|target| !target.as_str().is_some_and(|id| id.len() <= 256))
            }) {
                invalid = true;
            }
        }
        _ => {}
    });
    if invalid {
        return Err("Character occurrence IDs must be unique, and legacy emotion targets must be short strings.".into());
    }
    node(document, characters, tones, emotions, 0, &mut 0)
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
    pub fn presets(&self, kind: PresetKind) -> &[Preset] {
        match kind {
            PresetKind::Tone => &self.tones,
            PresetKind::Emotion => &self.emotions,
        }
    }
    fn presets_mut(&mut self, kind: PresetKind) -> &mut Vec<Preset> {
        match kind {
            PresetKind::Tone => &mut self.tones,
            PresetKind::Emotion => &mut self.emotions,
        }
    }
    pub fn add_starters(&mut self, kind: PresetKind) {
        self.add_starters_from(kind, None);
    }
    pub fn initialize_starters(&mut self, template: Option<&ProjectSnapshot>) {
        self.add_starters_from(PresetKind::Tone, template);
        self.add_starters_from(PresetKind::Emotion, template);
    }
    fn add_starters_from(&mut self, kind: PresetKind, template: Option<&ProjectSnapshot>) {
        let catalog = starter_catalog();
        if self
            .starter_types
            .iter()
            .filter_map(|marker| catalog_marker_version(marker, kind))
            .any(|version| version >= catalog.version)
        {
            return;
        }
        let legacy_initialized = self
            .starter_types
            .iter()
            .any(|marker| marker == kind.as_str());
        let starters = match kind {
            PresetKind::Tone => &catalog.tones,
            PresetKind::Emotion => &catalog.emotions,
        };
        for starter in starters {
            if let Some(existing) = self
                .presets_mut(kind)
                .iter_mut()
                .find(|preset| preset.name.trim().eq_ignore_ascii_case(starter.name.trim()))
            {
                // Only an untouched first-release seed is recognizable without
                // guessing at user intent. Custom, edited and archived data wins.
                if !existing.archived
                    && existing.revision == 0
                    && existing.meaning.is_empty()
                    && existing.example.is_empty()
                    && original_starter_guidance(kind, &starter.name)
                        == Some(existing.guidance.as_str())
                {
                    existing.meaning = starter.meaning.clone();
                    existing.example = starter.example.clone();
                }
                continue;
            }
            let deleted = self.trash.iter().any(|entry| {
                entry.kind == kind.as_str()
                    && entry.payload["preset"]["name"]
                        .as_str()
                        .is_some_and(|name| name.trim().eq_ignore_ascii_case(starter.name.trim()))
            });
            if deleted
                || (legacy_initialized && original_starter_guidance(kind, &starter.name).is_some())
            {
                continue;
            }
            let id = template
                .and_then(|project| {
                    project
                        .presets(kind)
                        .iter()
                        .find(|preset| preset.name.trim().eq_ignore_ascii_case(starter.name.trim()))
                })
                .filter(|preset| {
                    !self
                        .tones
                        .iter()
                        .chain(&self.emotions)
                        .any(|current| current.id == preset.id)
                })
                .map(|preset| preset.id.clone())
                .unwrap_or_else(new_id);
            self.presets_mut(kind).push(Preset {
                id,
                name: starter.name.clone(),
                meaning: starter.meaning.clone(),
                guidance: starter.guidance.clone(),
                example: starter.example.clone(),
                color: normalize_preset_color(&starter.color)
                    .expect("The bundled starter catalog has valid preset colors"),
                archived: false,
                revision: 0,
            });
        }
        if !legacy_initialized {
            self.starter_types.push(kind.as_str().into());
        }
        self.starter_types
            .push(format!("{}:catalog-v{}", kind.as_str(), catalog.version));
    }
    fn character_is_used(&self, id: &str) -> bool {
        self.scenes.iter().any(|s| {
            s.summary_document
                .as_ref()
                .is_some_and(|d| value_uses(d, "characterId", id))
        }) || self
            .scenes
            .iter()
            .flat_map(|s| &s.beats)
            .any(|b| value_uses(&b.document, "characterId", id))
            || self
                .trash
                .iter()
                .any(|t| value_uses(&t.payload, "characterId", id))
    }
    fn preset_is_used(&self, kind: PresetKind, id: &str) -> bool {
        let (key, default_key) = match kind {
            PresetKind::Tone => ("toneId", "defaultToneId"),
            PresetKind::Emotion => ("emotionId", "defaultEmotionId"),
        };
        self.scenes.iter().any(|s| {
            (kind == PresetKind::Tone && s.tone_id == id)
                || s.summary_document
                    .as_ref()
                    .is_some_and(|d| value_uses(d, key, id))
                || s.beats.iter().any(|b| value_uses(&b.document, key, id))
        }) || self.characters.iter().any(|c| match kind {
            PresetKind::Tone => c.default_tone_id == id,
            PresetKind::Emotion => c.default_emotion_id == id,
        }) || self
            .trash
            .iter()
            .any(|t| value_uses(&t.payload, key, id) || value_uses(&t.payload, default_key, id))
    }
    pub fn empty(name: String) -> Result<Self> {
        title(&name)?;
        Ok(Self {
            project_id: new_id(),
            title: name,
            revision: 0,
            chapters: vec![],
            scenes: vec![],
            characters: vec![],
            tones: vec![],
            emotions: vec![],
            starter_types: vec![],
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
                    summary_document: Some(plain_document("")),
                    tone: String::new(),
                    tone_id: String::new(),
                    prose: String::new(),
                    narration: Narration::default(),
                    beats: vec![],
                });
            }
            Operation::UpdateScene {
                scene_id,
                title: name,
                summary,
                summary_document,
                tone,
                tone_id,
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
                    scene.summary_document = None;
                    scene.summary = v;
                }
                if let Some(v) = summary_document {
                    scene.summary_document = Some(v);
                }
                if let Some(v) = tone {
                    scene.tone = v;
                }
                if let Some(v) = tone_id {
                    scene.tone_id = v;
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
                if let Some(document) = &mut scene.summary_document {
                    refresh_occurrences(document);
                }
                for beat in &mut scene.beats {
                    beat.id = new_id();
                    refresh_occurrences(&mut beat.document);
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
                refresh_occurrences(&mut beat.document);
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
                    "tone" | "emotion" => {
                        let preset: Preset =
                            serde_json::from_value(entry.payload["preset"].clone())
                                .map_err(|e| e.to_string())?;
                        let entries = if entry.kind == "tone" {
                            &mut self.tones
                        } else {
                            &mut self.emotions
                        };
                        entries.insert(position.min(entries.len()), preset);
                    }
                    "character" => {
                        let character: Character =
                            serde_json::from_value(entry.payload["character"].clone())
                                .map_err(|e| e.to_string())?;
                        self.characters
                            .insert(position.min(self.characters.len()), character);
                    }
                    _ => return Err("Unknown Trash entry kind.".into()),
                }
                self.trash.remove(pos);
            }
            Operation::CreateCharacter {
                name,
                background,
                personality,
                voice,
                icon,
                default_tone_id,
                default_emotion_id,
            } => {
                title(&name)?;
                let icon = icon
                    .as_deref()
                    .map(normalize_character_icon)
                    .transpose()?
                    .unwrap_or_default();
                self.characters.push(Character {
                    id: new_id(),
                    name,
                    background: background.unwrap_or_default(),
                    voice: voice.unwrap_or_default(),
                    personality: personality.unwrap_or_default(),
                    archived: false,
                    icon,
                    default_tone_id: default_tone_id.unwrap_or_default(),
                    default_emotion_id: default_emotion_id.unwrap_or_default(),
                });
            }
            Operation::UpdateCharacter {
                character_id,
                name,
                background,
                voice,
                personality,
                archived,
                icon,
                default_tone_id,
                default_emotion_id,
            } => {
                if let Some(ref name) = name {
                    title(name)?;
                }
                let icon = icon
                    .as_deref()
                    .map(normalize_character_icon)
                    .transpose()?;
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
                if let Some(v) = icon {
                    c.icon = v;
                }
                if let Some(v) = default_tone_id {
                    c.default_tone_id = v;
                }
                if let Some(v) = default_emotion_id {
                    c.default_emotion_id = v;
                }
            }
            Operation::DuplicateCharacter { character_id } => {
                let mut c = self
                    .characters
                    .iter()
                    .find(|c| c.id == character_id)
                    .ok_or("Character does not exist.")?
                    .clone();
                c.id = new_id();
                c.name.push_str(" (copy)");
                self.characters.push(c);
            }
            Operation::DeleteCharacter { character_id } => {
                if self.character_is_used(&character_id) {
                    return Err("This character is used in the project. Archive it to preserve its references.".into());
                }
                let position = self
                    .characters
                    .iter()
                    .position(|c| c.id == character_id)
                    .ok_or("Character does not exist.")?;
                let c = self.characters.remove(position);
                self.trash(
                    "character",
                    c.name.clone(),
                    json!({"character": c,"position":position}),
                );
            }
            Operation::CreatePreset { kind, name, color } => {
                title(&name)?;
                let color = color
                    .as_deref()
                    .map(normalize_preset_color)
                    .transpose()?
                    .unwrap_or_default();
                self.presets_mut(kind).push(Preset {
                    id: new_id(),
                    name,
                    meaning: String::new(),
                    guidance: String::new(),
                    example: String::new(),
                    color,
                    archived: false,
                    revision: 0,
                });
            }
            Operation::UpdatePreset {
                kind,
                preset_id,
                name,
                meaning,
                guidance,
                example,
                archived,
                color,
            } => {
                if let Some(ref value) = name {
                    title(value)?;
                }
                let color = color
                    .as_deref()
                    .map(normalize_preset_color)
                    .transpose()?;
                let semantic_change = name.is_some()
                    || meaning.is_some()
                    || guidance.is_some()
                    || example.is_some()
                    || archived.is_some();
                let p = self
                    .presets_mut(kind)
                    .iter_mut()
                    .find(|p| p.id == preset_id)
                    .ok_or("Reusable block does not exist.")?;
                if let Some(v) = name {
                    p.name = v;
                }
                if let Some(v) = meaning {
                    p.meaning = v;
                }
                if let Some(v) = guidance {
                    p.guidance = v;
                }
                if let Some(v) = example {
                    p.example = v;
                }
                if let Some(v) = archived {
                    p.archived = v;
                }
                if let Some(v) = color {
                    p.color = v;
                }
                if semantic_change {
                    p.revision = p
                        .revision
                        .checked_add(1)
                        .ok_or("Reusable block revision overflow.")?;
                }
            }
            Operation::DuplicatePreset { kind, preset_id } => {
                let mut p = self
                    .presets(kind)
                    .iter()
                    .find(|p| p.id == preset_id)
                    .ok_or("Reusable block does not exist.")?
                    .clone();
                p.id = new_id();
                p.name.push_str(" (copy)");
                p.revision = 0;
                self.presets_mut(kind).push(p);
            }
            Operation::DeletePreset { kind, preset_id } => {
                if self.preset_is_used(kind, &preset_id) {
                    return Err("This reusable block is used in the project. Archive it to preserve its references.".into());
                }
                let entries = self.presets_mut(kind);
                let position = entries
                    .iter()
                    .position(|p| p.id == preset_id)
                    .ok_or("Reusable block does not exist.")?;
                let p = entries.remove(position);
                self.trash(
                    kind.as_str(),
                    p.name.clone(),
                    json!({"preset":p,"position":position}),
                );
            }
            Operation::AddStarterPresets { kind } => self.add_starters(kind),
            Operation::Undo | Operation::Redo => {
                return Err("History operations require a project transaction.".into())
            }
        }
        for scene in &mut self.scenes {
            if scene.summary_document.is_none() {
                scene.summary_document = Some(summary_document(scene, &self.tones));
            }
            if let Some(document) = &mut scene.summary_document {
                normalize_occurrences(document, &format!("{}:summary", scene.id));
                scene.summary =
                    document_text(document, &self.characters, &self.tones, &self.emotions)?;
            }
            for beat in &mut scene.beats {
                normalize_occurrences(&mut beat.document, &beat.id);
                beat.text = document_text(
                    &beat.document,
                    &self.characters,
                    &self.tones,
                    &self.emotions,
                )?;
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
            if let Some(document) = &s.summary_document {
                if serde_json::to_vec(document)
                    .map_err(|e| e.to_string())?
                    .len()
                    > 4_000_000
                {
                    return Err("Scene summary exceeds the 4 MB limit.".into());
                }
                document_text(document, &self.characters, &self.tones, &self.emotions)?;
            }
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
                if b.text
                    != document_text(&b.document, &self.characters, &self.tones, &self.emotions)?
                {
                    return Err("Beat text does not match its structured document.".into());
                }
            }
        }
        for c in &self.characters {
            add(&c.id)?;
            title(&c.name)?;
            if normalize_character_icon(&c.icon)? != c.icon {
                return Err("Character icon is not normalized.".into());
            }
            if !c.default_tone_id.is_empty()
                && !self.tones.iter().any(|p| p.id == c.default_tone_id)
            {
                return Err("Character default tone is missing.".into());
            }
            if !c.default_emotion_id.is_empty()
                && !self.emotions.iter().any(|p| p.id == c.default_emotion_id)
            {
                return Err("Character default emotion is missing.".into());
            }
        }
        for s in &self.scenes {
            if !s.tone_id.is_empty() && !self.tones.iter().any(|p| p.id == s.tone_id) {
                return Err("Scene tone is missing.".into());
            }
        }
        for p in self.tones.iter().chain(&self.emotions) {
            add(&p.id)?;
            title(&p.name)?;
            if p.meaning.len() > 20_000
                || p.guidance.len() > 20_000
                || p.example.len() > 20_000
                || p.revision > i64::MAX as u64
            {
                return Err("Reusable block guidance exceeds the supported limits.".into());
            }
            if normalize_preset_color(&p.color)? != p.color {
                return Err("Reusable block color is not normalized.".into());
            }
        }
        if self.starter_types.iter().any(|k| {
            k != "tone"
                && k != "emotion"
                && catalog_marker_version(k, PresetKind::Tone).is_none()
                && catalog_marker_version(k, PresetKind::Emotion).is_none()
        }) {
            return Err("Unknown starter block category.".into());
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
