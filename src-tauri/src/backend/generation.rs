//! Native, scene-scoped prose generation. The UI supplies identifiers and a
//! channel; all prompt context is rebuilt from the open SQLite project here.

use super::{domain, BackendState};
use crate::chatgpt::{
    responses::{ResponsesEvent, ResponsesInput, ResponsesRequest},
    ChatGPTState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, State};

use domain::{
    AcceptedProseRevision, Character, GenerationJob, GenerationJobStatus, ProjectSnapshot, Result,
};

const MAX_GUIDANCE_BYTES: usize = 20_000;
const MAX_CONTEXT_BYTES: usize = 500_000;
const MAX_DRAFT_BYTES: usize = 10_000_000;
const CHECKPOINT_BYTES: usize = 2_048;
const CHECKPOINT_INTERVAL_MS: u128 = 500;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GenerationPurpose {
    #[default]
    Prose,
    Beats,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBinding {
    pub job_id: String,
    pub session_id: String,
    pub scene_id: String,
    pub model: String,
    pub connection_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GenerationEvent {
    Started {
        binding: GenerationBinding,
        job: GenerationJob,
    },
    TextDelta {
        binding: GenerationBinding,
        delta: String,
        draft_text: String,
    },
    Checkpoint {
        binding: GenerationBinding,
        job: GenerationJob,
    },
    Completed {
        binding: GenerationBinding,
        job: GenerationJob,
    },
    Stopped {
        binding: GenerationBinding,
        job: GenerationJob,
    },
    Failed {
        binding: GenerationBinding,
        job: GenerationJob,
        error: String,
    },
}

#[derive(Clone, Default)]
pub struct GenerationState {
    active: Arc<Mutex<Option<ActiveGeneration>>>,
}

#[derive(Clone)]
struct ActiveGeneration {
    binding: GenerationBinding,
    cancel: Arc<AtomicBool>,
}

impl GenerationState {
    fn claim(&self, binding: GenerationBinding) -> Result<Arc<AtomicBool>> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Scene generation is unavailable. Restart the app.".to_string())?;
        if active.is_some() {
            return Err("A scene is already generating. Stop it or wait for it to finish.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(ActiveGeneration {
            binding,
            cancel: cancel.clone(),
        });
        Ok(cancel)
    }

    fn request_stop(&self, session_id: &str, job_id: &str) -> Result<bool> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Scene generation is unavailable. Restart the app.".to_string())?;
        let Some(active) = active.as_ref() else {
            return Ok(false);
        };
        if active.binding.session_id != session_id || active.binding.job_id != job_id {
            return Ok(false);
        }
        active.cancel.store(true, Ordering::SeqCst);
        Ok(true)
    }

    fn is_active(&self, session_id: &str, job_id: &str) -> Result<bool> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Scene generation is unavailable. Restart the app.".to_string())?;
        Ok(active.as_ref().is_some_and(|active| {
            active.binding.session_id == session_id && active.binding.job_id == job_id
        }))
    }

    fn release(&self, job_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active
                .as_ref()
                .is_some_and(|active| active.binding.job_id == job_id)
            {
                *active = None;
            }
        }
    }
}

struct ActiveLease {
    state: GenerationState,
    job_id: String,
}

impl Drop for ActiveLease {
    fn drop(&mut self) {
        self.state.release(&self.job_id);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneDirection {
    id: String,
    title: String,
    summary: String,
    summary_document: Value,
    tone: String,
    tone_id: String,
    narration: domain::Narration,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterOccurrence {
    path: Vec<usize>,
    character_id: String,
    occurrence_id: String,
    label: String,
    emotion: String,
    delivery: String,
    profile_resolved: bool,
    profile_archived: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationBeat {
    id: String,
    order: usize,
    document: Value,
    readable_text: String,
    references: Vec<CharacterOccurrence>,
    tone: String,
    tone_source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationCharacter {
    id: String,
    name: String,
    background: String,
    personality: String,
    voice: String,
    archived: bool,
    default_tone_id: String,
    default_emotion_id: String,
}

#[derive(Clone, Debug, Serialize)]
struct GenerationPreset {
    kind: String,
    #[serde(flatten)]
    preset: domain::Preset,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnresolvedReference {
    beat_id: String,
    path: Vec<usize>,
    character_id: String,
    label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneGenerationContext {
    schema_version: u8,
    project_revision: u64,
    scene: SceneDirection,
    summary_board: GenerationBeat,
    beats: Vec<GenerationBeat>,
    referenced_characters: Vec<GenerationCharacter>,
    referenced_presets: Vec<GenerationPreset>,
    unresolved_references: Vec<UnresolvedReference>,
    readable_context: String,
}

fn attr_string(node: &Value, key: &str) -> String {
    node.get("attrs")
        .and_then(|attrs| attrs.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn collect_references(
    node: &Value,
    path: &mut Vec<usize>,
    beat_id: &str,
    characters: &HashMap<&str, &Character>,
    occurrences: &mut Vec<CharacterOccurrence>,
    referenced_ids: &mut Vec<String>,
    referenced_seen: &mut HashSet<String>,
    unresolved: &mut Vec<UnresolvedReference>,
) {
    if node.get("type").and_then(Value::as_str) == Some("characterReference") {
        let character_id = attr_string(node, "characterId");
        let profile = characters.get(character_id.as_str()).copied();
        let label = profile
            .map(|character| character.name.clone())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| {
                let label = attr_string(node, "label");
                if label.is_empty() {
                    "Character".to_owned()
                } else {
                    label
                }
            });
        let emotion = attr_string(node, "emotion");
        let delivery = attr_string(node, "delivery");
        occurrences.push(CharacterOccurrence {
            path: path.clone(),
            character_id: character_id.clone(),
            occurrence_id: attr_string(node, "occurrenceId"),
            label: label.clone(),
            emotion,
            delivery,
            profile_resolved: profile.is_some(),
            profile_archived: profile.is_some_and(|character| character.archived),
        });
        if profile.is_some() {
            if referenced_seen.insert(character_id.clone()) {
                referenced_ids.push(character_id);
            }
        } else {
            unresolved.push(UnresolvedReference {
                beat_id: beat_id.to_owned(),
                path: path.clone(),
                character_id,
                label,
            });
        }
    }

    for (index, child) in children(node).iter().enumerate() {
        path.push(index);
        collect_references(
            child,
            path,
            beat_id,
            characters,
            occurrences,
            referenced_ids,
            referenced_seen,
            unresolved,
        );
        path.pop();
    }
}

fn render_node(node: &Value, characters: &HashMap<&str, &Character>) -> String {
    match node.get("type").and_then(Value::as_str).unwrap_or_default() {
        "text" => node
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        "hardBreak" => "\n".to_owned(),
        "horizontalRule" => "\n---\n".to_owned(),
        "characterReference" => {
            let id = attr_string(node, "characterId");
            let label = characters
                .get(id.as_str())
                .map(|character| character.name.as_str())
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    let label = attr_string(node, "label");
                    if label.is_empty() {
                        "Character".into()
                    } else {
                        label
                    }
                });
            let mut directions = Vec::new();
            let emotion = attr_string(node, "emotion");
            let delivery = attr_string(node, "delivery");
            if !emotion.trim().is_empty() {
                directions.push(format!("emotion: {emotion}"));
            }
            if !delivery.trim().is_empty() {
                directions.push(format!("delivery: {delivery}"));
            }
            if directions.is_empty() {
                format!("[{label}]")
            } else {
                format!("[{label} \u{2014} {}]", directions.join("; "))
            }
        }
        kind => {
            let rendered = children(node)
                .iter()
                .map(|child| render_node(child, characters))
                .collect::<Vec<_>>();
            match kind {
                "paragraph" | "heading" | "blockquote" => {
                    let text = rendered.join("");
                    if children(node).is_empty() {
                        text
                    } else {
                        format!("{text}\n")
                    }
                }
                "listItem" => format!("{}\n", rendered.join("").trim_end()),
                "bulletList" => {
                    rendered
                        .iter()
                        .map(|item| item.trim_end())
                        .filter(|item| !item.is_empty())
                        .map(|item| format!("\u{2022} {item}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                        + "\n"
                }
                "orderedList" => {
                    rendered
                        .iter()
                        .enumerate()
                        .map(|(index, item)| format!("{}. {}", index + 1, item.trim_end()))
                        .collect::<Vec<_>>()
                        .join("\n")
                        + "\n"
                }
                _ => rendered.join(""),
            }
        }
    }
}

fn clean_block(value: String) -> String {
    value.trim().to_owned()
}

fn format_character(character: &GenerationCharacter, project: &ProjectSnapshot) -> String {
    let mut facts = Vec::new();
    if !character.background.trim().is_empty() {
        facts.push(format!("Background: {}", character.background.trim()));
    }
    if !character.personality.trim().is_empty() {
        facts.push(format!("Personality: {}", character.personality.trim()));
    }
    if !character.voice.trim().is_empty() {
        facts.push(format!("Baseline voice: {}", character.voice.trim()));
    }
    if let Some(p) = project
        .tones
        .iter()
        .find(|p| p.id == character.default_tone_id)
    {
        facts.push(format!("Default tone: {}", p.name));
    }
    if let Some(p) = project
        .emotions
        .iter()
        .find(|p| p.id == character.default_emotion_id)
    {
        facts.push(format!("Default emotion: {}", p.name));
    }
    if character.archived {
        facts.push(
            "This profile is archived; it remains attached to an existing beat reference.".into(),
        );
    }
    if facts.is_empty() {
        format!("- {}", character.name)
    } else {
        format!("- {}\n  {}", character.name, facts.join("\n  "))
    }
}

fn add_preset(
    project: &ProjectSnapshot,
    kind: domain::PresetKind,
    id: &str,
    referenced: &mut Vec<GenerationPreset>,
) -> Result<Option<domain::Preset>> {
    if id.is_empty() {
        return Ok(None);
    }
    let preset =
        project.presets(kind).iter().find(|p| p.id == id).ok_or(
            "A reusable block definition is missing. Repair its reference before generating.",
        )?;
    if !referenced
        .iter()
        .any(|p| p.kind == kind.as_str() && p.preset.id == id)
    {
        referenced.push(GenerationPreset {
            kind: kind.as_str().into(),
            preset: preset.clone(),
        });
    }
    Ok(Some(preset.clone()))
}

fn block_document(
    project: &ProjectSnapshot,
    document: &Value,
    referenced: &mut Vec<GenerationPreset>,
    summary: bool,
) -> Result<(Value, Option<domain::Preset>)> {
    let mut owners = HashMap::new();
    domain::walk_nodes(document, &mut |node| {
        if node["type"] == "characterReference" {
            let character_id = attr_string(node, "characterId");
            let name = project
                .characters
                .iter()
                .find(|c| c.id == character_id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| attr_string(node, "label"));
            owners.insert(attr_string(node, "occurrenceId"), name);
        }
    });
    fn transform(
        project: &ProjectSnapshot,
        node: &Value,
        owners: &HashMap<String, String>,
        referenced: &mut Vec<GenerationPreset>,
        tone: &mut Option<domain::Preset>,
        summary: bool,
    ) -> Result<Value> {
        let kind = node["type"].as_str().unwrap_or_default();
        if kind == "toneReference" {
            if tone.is_some() {
                return Err("A beat can contain only one tone block.".into());
            }
            let p = add_preset(
                project,
                domain::PresetKind::Tone,
                &attr_string(node, "toneId"),
                referenced,
            )?
            .ok_or("A beat tone reference is missing its definition.")?;
            let text = format!(
                "[{} tone: {}]",
                if summary { "Scene" } else { "Beat" },
                p.name
            );
            *tone = Some(p);
            return Ok(json!({"type":"text","text":text}));
        }
        if kind == "emotionReference" {
            let p = add_preset(
                project,
                domain::PresetKind::Emotion,
                &attr_string(node, "emotionId"),
                referenced,
            )?
            .ok_or("An emotion reference is missing its definition.")?;
            let target = attr_string(node, "targetOccurrenceId");
            let name = owners
                .get(&target)
                .filter(|_| !target.is_empty())
                .ok_or("An emotion block needs a character occurrence in the same beat.")?;
            return Ok(
                json!({"type":"text","text":format!("[Emotion: {} \u{2192} {}]",p.name,name)}),
            );
        }
        let mut result = node.clone();
        if let Some(nodes) = node["content"].as_array() {
            result["content"] = Value::Array(
                nodes
                    .iter()
                    .map(|n| transform(project, n, owners, referenced, tone, summary))
                    .collect::<Result<Vec<_>>>()?,
            );
        }
        Ok(result)
    }
    let mut tone = None;
    let result = transform(project, document, &owners, referenced, &mut tone, summary)?;
    Ok((result, tone))
}

fn format_preset(p: &GenerationPreset) -> String {
    let mut facts = Vec::new();
    for (label, value) in [
        ("Meaning", &p.preset.meaning),
        ("Guidance", &p.preset.guidance),
        ("Example", &p.preset.example),
    ] {
        if !value.trim().is_empty() {
            facts.push(format!("{label}: {}", value.trim()));
        }
    }
    let label = if p.kind == "tone" { "Tone" } else { "Emotion" };
    if facts.is_empty() {
        format!("- {label}: {}", p.preset.name)
    } else {
        format!("- {label}: {}\n  {}", p.preset.name, facts.join("\n  "))
    }
}

fn build_scene_context(
    project: &ProjectSnapshot,
    scene_id: &str,
) -> Result<SceneGenerationContext> {
    let scene = project
        .scenes
        .iter()
        .find(|scene| scene.id == scene_id)
        .ok_or("The selected scene is no longer in this project.")?;
    let characters: HashMap<&str, &Character> = project
        .characters
        .iter()
        .map(|character| (character.id.as_str(), character))
        .collect();
    let mut referenced_ids = Vec::new();
    let mut referenced_seen = HashSet::new();
    let mut unresolved_references = Vec::new();
    let mut beats = Vec::with_capacity(scene.beats.len());
    let mut referenced_presets = Vec::new();
    let summary_id = format!("{}:summary", scene.id);
    let mut summary_document = domain::summary_document(scene, &project.tones);
    domain::normalize_occurrences(&mut summary_document, &summary_id);
    let (summary_display, summary_tone) =
        block_document(project, &summary_document, &mut referenced_presets, true)?;
    let scene_tone = if let Some(tone) = &summary_tone {
        tone.name.clone()
    } else {
        add_preset(
            project,
            domain::PresetKind::Tone,
            &scene.tone_id,
            &mut referenced_presets,
        )?
        .map(|p| p.name)
        .unwrap_or_else(|| scene.tone.clone())
    };
    let mut summary_references = Vec::new();
    collect_references(
        &summary_document,
        &mut Vec::new(),
        &summary_id,
        &characters,
        &mut summary_references,
        &mut referenced_ids,
        &mut referenced_seen,
        &mut unresolved_references,
    );
    let summary_board = GenerationBeat {
        id: summary_id,
        order: 0,
        document: summary_document.clone(),
        readable_text: clean_block(render_node(&summary_display, &characters)),
        references: summary_references,
        tone: scene_tone.clone(),
        tone_source: if scene_tone.is_empty() {
            "none"
        } else {
            "scene"
        }
        .into(),
    };

    for (index, beat) in scene.beats.iter().enumerate() {
        let (display_document, beat_tone) =
            block_document(project, &beat.document, &mut referenced_presets, false)?;
        let mut references = Vec::new();
        collect_references(
            &beat.document,
            &mut Vec::new(),
            &beat.id,
            &characters,
            &mut references,
            &mut referenced_ids,
            &mut referenced_seen,
            &mut unresolved_references,
        );
        beats.push(GenerationBeat {
            id: beat.id.clone(),
            order: index + 1,
            document: beat.document.clone(),
            readable_text: clean_block(render_node(&display_document, &characters)),
            references,
            tone: beat_tone
                .as_ref()
                .map(|p| p.name.clone())
                .unwrap_or_else(|| scene_tone.clone()),
            tone_source: if beat_tone.is_some() {
                "beat"
            } else if !scene_tone.is_empty() {
                "scene"
            } else {
                "none"
            }
            .into(),
        });
    }

    let referenced_characters = referenced_ids
        .iter()
        .filter_map(|id| characters.get(id.as_str()).copied())
        .map(|character| GenerationCharacter {
            id: character.id.clone(),
            name: character.name.clone(),
            background: character.background.clone(),
            personality: character.personality.clone(),
            voice: character.voice.clone(),
            archived: character.archived,
            default_tone_id: character.default_tone_id.clone(),
            default_emotion_id: character.default_emotion_id.clone(),
        })
        .collect::<Vec<_>>();
    for character in &referenced_characters {
        add_preset(
            project,
            domain::PresetKind::Tone,
            &character.default_tone_id,
            &mut referenced_presets,
        )?;
        add_preset(
            project,
            domain::PresetKind::Emotion,
            &character.default_emotion_id,
            &mut referenced_presets,
        )?;
    }

    let direction = SceneDirection {
        id: scene.id.clone(),
        title: scene.title.clone(),
        summary: scene.summary.clone(),
        summary_document,
        tone: scene_tone,
        tone_id: summary_tone
            .map(|p| p.id)
            .unwrap_or_else(|| scene.tone_id.clone()),
        narration: scene.narration.clone(),
    };
    let mut blocks = vec![format!("Scene: {}", direction.title)];
    if !summary_board.readable_text.trim().is_empty() {
        blocks.push(format!(
            "Scene summary: {}",
            summary_board.readable_text.trim()
        ));
    }
    if !direction.tone.trim().is_empty() {
        blocks.push(format!("Scene tone: {}", direction.tone.trim()));
    }
    if !direction.narration.point_of_view.trim().is_empty() {
        blocks.push(format!(
            "Point of view: {}",
            direction.narration.point_of_view.trim()
        ));
    }
    if !direction.narration.tense.trim().is_empty() {
        blocks.push(format!("Tense: {}", direction.narration.tense.trim()));
    }
    if !direction.narration.instructions.trim().is_empty() {
        blocks.push(format!(
            "Narration guidance: {}",
            direction.narration.instructions.trim()
        ));
    }
    if referenced_characters.is_empty() {
        blocks.push("Referenced character profiles: none.".into());
    } else {
        blocks.push(format!(
            "Referenced character profiles:\n{}",
            referenced_characters
                .iter()
                .map(|c| format_character(c, project))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !referenced_presets.is_empty() {
        blocks.push(format!(
            "Referenced reusable blocks:\n{}",
            referenced_presets
                .iter()
                .map(format_preset)
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    blocks.push(format!(
        "Ordered beats:\n{}",
        beats
            .iter()
            .map(|beat| format!(
                "{}:\n{}",
                if beat.tone.is_empty() {
                    format!("Beat {}", beat.order)
                } else {
                    format!(
                        "Beat {} (tone: {}; {})",
                        beat.order,
                        beat.tone,
                        if beat.tone_source == "beat" {
                            "beat override"
                        } else {
                            "inherited scene"
                        }
                    )
                },
                if beat.readable_text.is_empty() {
                    "(empty)"
                } else {
                    &beat.readable_text
                }
            ))
            .collect::<Vec<_>>()
            .join("\n\n")
    ));
    if !unresolved_references.is_empty() {
        blocks.push(format!(
            "Unresolved character references:\n{}",
            unresolved_references
                .iter()
                .map(|reference| format!(
                    "- {} (profile unavailable; preserve this as an existing reference)",
                    reference.label
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    let readable_context = blocks.join("\n\n");
    Ok(SceneGenerationContext {
        schema_version: 1,
        project_revision: project.revision,
        scene: direction,
        summary_board,
        beats,
        referenced_characters,
        referenced_presets,
        unresolved_references,
        readable_context,
    })
}

#[cfg(test)]
fn fingerprint(context: &SceneGenerationContext, guidance: &str) -> Result<String> {
    fingerprint_for_purpose(context, guidance, GenerationPurpose::Prose)
}

fn fingerprint_for_purpose(
    context: &SceneGenerationContext,
    guidance: &str,
    purpose: GenerationPurpose,
) -> Result<String> {
    let mut value = json!({
        "scene": context.scene,
        "summaryBoard": context.summary_board,
        "beats": context.beats,
        "referencedCharacters": context.referenced_characters,
        "referencedPresets": context.referenced_presets,
        "unresolvedReferences": context.unresolved_references,
        "defaultGuidance": guidance,
    });
    if purpose == GenerationPurpose::Beats {
        value["purpose"] = json!("beats");
    }
    let canonical = serde_json::to_string(&canonicalize_json(value))
        .map_err(|_| "Could not fingerprint the scene direction.".to_string())?;
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for code_unit in canonical.encode_utf16() {
        hash ^= u64::from(code_unit);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    Ok(format!("{hash:016x}"))
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonicalize_json).collect()),
        Value::Object(object) => {
            let mut entries = object.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            let mut canonical = serde_json::Map::new();
            for (key, value) in entries {
                canonical.insert(key, canonicalize_json(value));
            }
            Value::Object(canonical)
        }
        other => other,
    }
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

pub(super) fn timestamp_ms() -> u64 {
    current_time_ms()
}

fn validate_guidance(guidance: Option<String>) -> Result<String> {
    let guidance = guidance.unwrap_or_default();
    if guidance.len() > MAX_GUIDANCE_BYTES {
        return Err("Additional writing guidance is too long.".into());
    }
    Ok(guidance)
}

#[cfg(test)]
fn validate_context_for_request(context: &SceneGenerationContext) -> Result<()> {
    validate_context_for_purpose(context, GenerationPurpose::Prose)
}

fn validate_context_for_purpose(
    context: &SceneGenerationContext,
    purpose: GenerationPurpose,
) -> Result<()> {
    if !context.unresolved_references.is_empty() {
        return Err(
            "A character definition is missing. Repair its reference before generating.".into(),
        );
    }
    let has_beats = context
        .beats
        .iter()
        .any(|beat| !beat.readable_text.trim().is_empty());
    let has_summary = !context.summary_board.readable_text.trim().is_empty();
    if purpose == GenerationPurpose::Beats && !has_summary {
        return Err("Describe the scene on its summary board before generating beats.".into());
    }
    if purpose == GenerationPurpose::Prose && !has_summary && !has_beats {
        return Err(
            "Describe the scene in its summary or add a non-empty beat before generating prose."
                .into(),
        );
    }
    if context.readable_context.len() > MAX_CONTEXT_BYTES {
        return Err("This scene has too much context for one generation request.".into());
    }
    Ok(())
}

#[cfg(test)]
fn make_request(model: &str, guidance: &str, context: &SceneGenerationContext) -> ResponsesRequest {
    make_request_for_purpose(model, guidance, context, GenerationPurpose::Prose)
}

fn make_request_for_purpose(
    model: &str,
    guidance: &str,
    context: &SceneGenerationContext,
    purpose: GenerationPurpose,
) -> ResponsesRequest {
    let mut instructions = String::from(if purpose == GenerationPurpose::Prose {
        "Write polished story prose for one scene from its summary board, using every beat in order when beats are present. Treat character references as instructions for the named character at that moment; local emotion and delivery override the character's baseline profile only for that occurrence. A tone on the summary board supplies the scene tone. An explicit beat tone overrides the scene tone for that beat only; other beats inherit the scene tone. Character voice remains independent. Use the narration guidance. Preserve the causal sequence and intent of the summary and beats while writing natural, connected prose. Do not add a title, explanation, analysis, or events that contradict the scene direction."
    } else {
        "Turn the summary board into a short sequence of 1 to 12 new editable story beats. These beats will be appended after any existing beats; do not repeat their events. Return ONLY a JSON object in this exact shape: {\"beats\":[{\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Describe one story moment.\"}]}]}}]}. Each beat is freeform shorthand, not finished prose. Use text and optionally characterReference, emotionReference, and toneReference inline nodes. Character attrs: {characterId:<existing id>,occurrenceId:<unique local id>,label:<name>,emotion:\"\",delivery:\"\"}. Emotion attrs: {emotionId:<existing id>,label:<name>,targetOccurrenceId:<character occurrence in THIS beat>}. Tone attrs: {toneId:<existing id>,label:<name>}; at most one tone per beat. Use ONLY IDs in referencedCharacters/referencedPresets from the supplied context. Never invent a shared ID or apply emotion to a different occurrence. Beats may have no characters. Preserve character voice, the author's intent, and the causal sequence. No Markdown fences, explanation, title, or prose outside the JSON object."
    });
    if !guidance.is_empty() {
        instructions.push_str("\n\nAdditional author guidance:\n");
        instructions.push_str(guidance);
    }
    ResponsesRequest {
        model: model.to_owned(),
        instructions: Some(instructions),
        input: vec![ResponsesInput {
            role: "user".into(),
            content: if purpose == GenerationPurpose::Prose {
                context.readable_context.clone()
            } else {
                format!(
                    "{}\n\nStructured block context (use only these shared IDs):\n{}",
                    context.readable_context,
                    serde_json::to_string(context).unwrap_or_default()
                )
            },
        }],
    }
}

fn make_request_snapshot(
    connection_id: &str,
    request: &ResponsesRequest,
    context: &SceneGenerationContext,
    guidance: &str,
    base_prose: &str,
    purpose: GenerationPurpose,
) -> Result<Value> {
    serde_json::to_value(json!({
        "schemaVersion": 1,
        "connectionId": connection_id,
        "model": request.model,
        "defaultGuidance": guidance,
        "baseProse": base_prose,
        "purpose": purpose,
        "context": context,
        "request": request,
    }))
    .map_err(|_| "Could not save the immutable generation request.".into())
}

fn send_event(channel: &Channel<GenerationEvent>, event: GenerationEvent) -> Result<()> {
    channel
        .send(event)
        .map_err(|_| "The scene view disconnected from generation.".to_string())
}

fn checkpoint(
    backend: &BackendState,
    session_id: &str,
    job_id: &str,
    status: GenerationJobStatus,
    draft_text: String,
    error_message: Option<String>,
) -> Result<GenerationJob> {
    backend.with_project(session_id, |database| {
        database.checkpoint_generation_job(
            job_id,
            status,
            draft_text,
            error_message,
            current_time_ms(),
        )
    })
}

fn safe_error(error: &str) -> String {
    error
        .chars()
        .filter(|character| !character.is_control())
        .take(1000)
        .collect()
}

fn run_generation(
    app: AppHandle,
    backend: BackendState,
    chatgpt: ChatGPTState,
    state: GenerationState,
    binding: GenerationBinding,
    request: ResponsesRequest,
    cancel: Arc<AtomicBool>,
    channel: Channel<GenerationEvent>,
) {
    let _lease = ActiveLease {
        state,
        job_id: binding.job_id.clone(),
    };
    if !backend.is_current_session(&binding.session_id) {
        return;
    }
    let mut job = match checkpoint(
        &backend,
        &binding.session_id,
        &binding.job_id,
        GenerationJobStatus::Streaming,
        String::new(),
        None,
    ) {
        Ok(job) => job,
        Err(error) => {
            if let Ok(job) = checkpoint(
                &backend,
                &binding.session_id,
                &binding.job_id,
                GenerationJobStatus::Failed,
                String::new(),
                Some(safe_error(&error)),
            ) {
                let _ = send_event(
                    &channel,
                    GenerationEvent::Failed {
                        binding,
                        job,
                        error: safe_error(&error),
                    },
                );
            }
            return;
        }
    };
    if send_event(
        &channel,
        GenerationEvent::Checkpoint {
            binding: binding.clone(),
            job: job.clone(),
        },
    )
    .is_err()
    {
        cancel.store(true, Ordering::SeqCst);
    }

    let mut draft_text = String::new();
    let mut last_checkpoint_bytes = 0;
    let mut last_checkpoint_at = std::time::Instant::now();
    let mut saw_completed = false;
    let mut provider_error = None;
    let session_id = binding.session_id.clone();
    let job_id = binding.job_id.clone();
    let connection_id = binding.connection_id.clone();
    let stream_result = chatgpt.stream_if_ready_for_connection(
        &app,
        &connection_id,
        &request,
        || {
            if cancel.load(Ordering::SeqCst) {
                Some("Generation stopped.".into())
            } else if !backend.is_current_session(&session_id) {
                Some("The project changed while this scene was generating.".into())
            } else {
                None
            }
        },
        |event| match event {
            ResponsesEvent::TextDelta(delta) => {
                if draft_text.len().saturating_add(delta.len()) > MAX_DRAFT_BYTES {
                    return Err(
                        "ChatGPT generated a scene larger than Shorthand Writer supports.".into(),
                    );
                }
                draft_text.push_str(&delta);
                let checkpoint_due = draft_text.len().saturating_sub(last_checkpoint_bytes)
                    >= CHECKPOINT_BYTES
                    || last_checkpoint_at.elapsed().as_millis() >= CHECKPOINT_INTERVAL_MS;
                if checkpoint_due {
                    job = checkpoint(
                        &backend,
                        &session_id,
                        &job_id,
                        GenerationJobStatus::Streaming,
                        draft_text.clone(),
                        None,
                    )?;
                    last_checkpoint_bytes = draft_text.len();
                    last_checkpoint_at = std::time::Instant::now();
                    send_event(
                        &channel,
                        GenerationEvent::Checkpoint {
                            binding: binding.clone(),
                            job: job.clone(),
                        },
                    )?;
                }
                send_event(
                    &channel,
                    GenerationEvent::TextDelta {
                        binding: binding.clone(),
                        delta,
                        draft_text: draft_text.clone(),
                    },
                )
            }
            ResponsesEvent::Completed => {
                saw_completed = true;
                Ok(())
            }
            ResponsesEvent::Failed { code } => {
                provider_error = Some(format!("ChatGPT could not complete this scene ({code})."));
                Ok(())
            }
            ResponsesEvent::Incomplete { reason } => {
                provider_error = Some(format!("ChatGPT returned an incomplete scene ({reason})."));
                Ok(())
            }
        },
    );

    // The project may have been closed/replaced while HTTP was polling. Reopening
    // it marks any pending job interrupted; never attach output to a new session.
    if !backend.is_current_session(&binding.session_id) {
        return;
    }

    let stopped = cancel.load(Ordering::SeqCst)
        || stream_result
            .as_ref()
            .is_err_and(|error| error == "Generation stopped.");
    let (terminal, error) = if stopped {
        (GenerationJobStatus::Stopped, None)
    } else if let Some(error) = provider_error {
        (GenerationJobStatus::Failed, Some(error))
    } else if let Err(error) = stream_result {
        (GenerationJobStatus::Failed, Some(safe_error(&error)))
    } else if !saw_completed {
        (
            GenerationJobStatus::Failed,
            Some("ChatGPT did not complete the scene response.".into()),
        )
    } else if draft_text.trim().is_empty() {
        (
            GenerationJobStatus::Failed,
            Some("ChatGPT completed without producing scene prose.".into()),
        )
    } else {
        (GenerationJobStatus::Completed, None)
    };

    match checkpoint(
        &backend,
        &binding.session_id,
        &binding.job_id,
        terminal,
        draft_text,
        error.clone(),
    ) {
        Ok(final_job) => {
            let event = match terminal {
                GenerationJobStatus::Completed => GenerationEvent::Completed {
                    binding,
                    job: final_job,
                },
                GenerationJobStatus::Stopped => GenerationEvent::Stopped {
                    binding,
                    job: final_job,
                },
                _ => GenerationEvent::Failed {
                    binding,
                    job: final_job,
                    error: error.unwrap_or_else(|| "Scene generation failed.".into()),
                },
            };
            let _ = send_event(&channel, event);
        }
        Err(_) => {}
    }
}

#[tauri::command]
pub async fn start_scene_generation(
    app: AppHandle,
    session_id: String,
    scene_id: String,
    model: String,
    default_guidance: Option<String>,
    purpose: Option<GenerationPurpose>,
    on_event: Channel<GenerationEvent>,
    backend: State<'_, BackendState>,
    chatgpt: State<'_, ChatGPTState>,
    generation: State<'_, GenerationState>,
) -> Result<GenerationJob> {
    let guidance = validate_guidance(default_guidance)?;
    let purpose = purpose.unwrap_or_default();
    if model.trim().is_empty() || model.len() > 1000 {
        return Err("Choose a supported ChatGPT model in Settings.".into());
    }
    let app_for_check = app.clone();
    let chatgpt_state = chatgpt.inner().clone();
    let model_for_check = model.clone();
    let connection_id = super::blocking(move || {
        chatgpt_state.verified_connection_id_for_model(&app_for_check, &model_for_check)
    })
    .await?;

    let job_id = domain::new_id();
    let binding = GenerationBinding {
        job_id: job_id.clone(),
        session_id: session_id.clone(),
        scene_id: scene_id.clone(),
        model: model.clone(),
        connection_id: connection_id.clone(),
    };
    let generation_state = generation.inner().clone();
    let cancel = generation_state.claim(binding.clone())?;
    let backend_state = backend.inner().clone();
    let guidance_for_create = guidance.clone();
    let model_for_create = model.clone();
    let connection_for_create = connection_id.clone();
    let session_for_create = session_id.clone();
    let scene_for_create = scene_id.clone();
    let job_id_for_create = job_id.clone();
    let created = super::blocking(move || {
        backend_state.with_project(&session_for_create, |database| {
            let project = database.read()?;
            let context = build_scene_context(&project, &scene_for_create)?;
            validate_context_for_purpose(&context, purpose)?;
            let input_fingerprint =
                fingerprint_for_purpose(&context, &guidance_for_create, purpose)?;
            let request = make_request_for_purpose(
                &model_for_create,
                &guidance_for_create,
                &context,
                purpose,
            );
            let base_prose = project
                .scenes
                .iter()
                .find(|scene| scene.id == scene_for_create)
                .ok_or("The selected scene is no longer in this project.")?
                .prose
                .clone();
            let request_snapshot = make_request_snapshot(
                &connection_for_create,
                &request,
                &context,
                &guidance_for_create,
                &base_prose,
                purpose,
            )?;
            let now = current_time_ms();
            let job = GenerationJob {
                id: job_id_for_create,
                scene_id: scene_for_create,
                scene_revision: project.revision,
                connection_id: connection_for_create,
                model: model_for_create,
                request_snapshot,
                input_fingerprint,
                status: GenerationJobStatus::Pending,
                draft_text: String::new(),
                error_message: None,
                created_at_ms: now,
                updated_at_ms: now,
            };
            database.create_generation_job(&job)?;
            Ok((job, request))
        })
    })
    .await;
    let (job, request) = match created {
        Ok(value) => value,
        Err(error) => {
            generation_state.release(&job_id);
            return Err(error);
        }
    };
    if let Err(error) = send_event(
        &on_event,
        GenerationEvent::Started {
            binding: binding.clone(),
            job: job.clone(),
        },
    ) {
        let event_error = error.clone();
        let _ = super::blocking({
            let backend_state = backend.inner().clone();
            let session_id = session_id.clone();
            let job_id = job_id.clone();
            move || {
                checkpoint(
                    &backend_state,
                    &session_id,
                    &job_id,
                    GenerationJobStatus::Failed,
                    String::new(),
                    Some(event_error.clone()),
                )
                .map(|_| ())
            }
        })
        .await;
        generation_state.release(&job_id);
        return Err(error);
    }

    let app_for_worker = app.clone();
    let backend_for_worker = backend.inner().clone();
    let chatgpt_for_worker = chatgpt.inner().clone();
    let state_for_worker = generation_state.clone();
    let binding_for_worker = binding.clone();
    let channel_for_worker = on_event.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        run_generation(
            app_for_worker,
            backend_for_worker,
            chatgpt_for_worker,
            state_for_worker,
            binding_for_worker,
            request,
            cancel,
            channel_for_worker,
        );
    });
    Ok(job)
}

#[tauri::command]
pub async fn stop_scene_generation(
    session_id: String,
    job_id: String,
    backend: State<'_, BackendState>,
    generation: State<'_, GenerationState>,
) -> Result<GenerationJob> {
    let backend_state = backend.inner().clone();
    let job_for_read = job_id.clone();
    let session_for_read = session_id.clone();
    let job = super::blocking(move || {
        backend_state.with_project(&session_for_read, |database| {
            database
                .generation_job(&job_for_read)?
                .ok_or_else(|| "Generation job does not exist in this project.".into())
        })
    })
    .await?;
    let generation_state = generation.inner().clone();
    if generation_state.request_stop(&session_id, &job_id)? {
        return Ok(job);
    }
    let backend_state = backend.inner().clone();
    super::blocking(move || {
        backend_state.with_project(&session_id, |database| {
            let latest = database
                .generation_job(&job_id)?
                .ok_or_else(|| "Generation job does not exist in this project.".to_string())?;
            if matches!(
                latest.status,
                GenerationJobStatus::Pending | GenerationJobStatus::Streaming
            ) {
                database.checkpoint_generation_job(
                    &latest.id,
                    GenerationJobStatus::Interrupted,
                    latest.draft_text,
                    Some("Generation was interrupted before it could be stopped.".into()),
                    current_time_ms(),
                )
            } else {
                Ok(latest)
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn scene_generation_jobs(
    session_id: String,
    scene_id: String,
    backend: State<'_, BackendState>,
    generation: State<'_, GenerationState>,
) -> Result<Vec<GenerationJob>> {
    let backend_state = backend.inner().clone();
    let generation_state = generation.inner().clone();
    super::blocking(move || {
        backend_state.with_project(&session_id, |database| {
            let mut jobs = database.generation_jobs_for_scene(&scene_id)?;
            for job in &mut jobs {
                if matches!(
                    job.status,
                    GenerationJobStatus::Pending | GenerationJobStatus::Streaming
                ) && !generation_state.is_active(&session_id, &job.id)?
                {
                    *job = database.checkpoint_generation_job(
                        &job.id,
                        GenerationJobStatus::Interrupted,
                        job.draft_text.clone(),
                        Some("Generation was interrupted and will not be resumed.".into()),
                        current_time_ms(),
                    )?;
                }
            }
            Ok(jobs)
        })
    })
    .await
}

fn verify_job_binding(
    job: &GenerationJob,
    scene_id: &str,
    model: &str,
    connection_id: &str,
) -> Result<()> {
    if job.scene_id != scene_id || job.model != model || job.connection_id != connection_id {
        return Err(
            "This generation job belongs to a different scene or ChatGPT connection.".into(),
        );
    }
    Ok(())
}

fn guidance_from_job(job: &GenerationJob) -> Result<String> {
    job.request_snapshot
        .get("defaultGuidance")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "The saved generation request is invalid.".into())
}

fn base_prose_from_job(job: &GenerationJob) -> Result<String> {
    job.request_snapshot
        .get("baseProse")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "The saved generation request is invalid.".into())
}

fn purpose_from_job(job: &GenerationJob) -> Result<GenerationPurpose> {
    match job.request_snapshot.get("purpose") {
        None => Ok(GenerationPurpose::Prose),
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|_| "The saved generation purpose is invalid.".into()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GeneratedBeats {
    beats: Vec<GeneratedBeatDocument>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GeneratedBeatDocument {
    document: Value,
}

fn parse_generated_beats(
    draft: &str,
    project: &ProjectSnapshot,
    saved_context: &Value,
) -> Result<Vec<Value>> {
    if draft.len() > 1_000_000 {
        return Err("The generated scene exceeds the 1 MB beat limit.".into());
    }
    let draft = draft.trim();
    let draft = draft
        .strip_prefix("```json")
        .or_else(|| draft.strip_prefix("```"))
        .and_then(|value| value.trim().strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(draft);
    let parsed: GeneratedBeats = serde_json::from_str(draft).map_err(|_| "The generated scene is not valid beat JSON. Generate a new attempt; your existing writing is unchanged.".to_string())?;
    if parsed.beats.is_empty() || parsed.beats.len() > 40 {
        return Err("A generated scene must contain between 1 and 40 beats.".into());
    }
    let characters: HashSet<&str> = saved_context["referencedCharacters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["id"].as_str())
        .collect();
    let presets: HashSet<(&str, &str)> = saved_context["referencedPresets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some((p["kind"].as_str()?, p["id"].as_str()?)))
        .collect();
    let mut documents = Vec::new();
    for beat in parsed.beats {
        let mut document = beat.document;
        let mut invalid = false;
        domain::walk_nodes(&document, &mut |node| match node["type"].as_str() {
            Some("characterReference") => {
                if !node["attrs"]["characterId"]
                    .as_str()
                    .is_some_and(|id| characters.contains(id))
                {
                    invalid = true;
                }
            }
            Some("toneReference") => {
                if !node["attrs"]["toneId"]
                    .as_str()
                    .is_some_and(|id| presets.contains(&("tone", id)))
                {
                    invalid = true;
                }
            }
            Some("emotionReference") => {
                if !node["attrs"]["emotionId"]
                    .as_str()
                    .is_some_and(|id| presets.contains(&("emotion", id)))
                {
                    invalid = true;
                }
            }
            _ => {}
        });
        if invalid {
            return Err("The generated scene references a block that was not supplied. Generate a new attempt; your existing writing is unchanged.".into());
        }
        let text = domain::document_text(
            &document,
            &project.characters,
            &project.tones,
            &project.emotions,
        )?;
        if text.trim().is_empty() {
            return Err("Generated beats must describe a story moment.".into());
        }
        domain::refresh_occurrences(&mut document);
        documents.push(document);
    }
    Ok(documents)
}

#[tauri::command]
pub async fn accept_scene_generation(
    session_id: String,
    scene_id: String,
    job_id: String,
    expected_project_revision: u64,
    model: String,
    connection_id: String,
    acknowledge_outdated: bool,
    backend: State<'_, BackendState>,
    generation: State<'_, GenerationState>,
) -> Result<ProjectSnapshot> {
    let generation_state = generation.inner().clone();
    if generation_state.is_active(&session_id, &job_id)? {
        return Err("Wait for scene generation to stop before accepting the draft.".into());
    }
    let backend_state = backend.inner().clone();
    super::blocking(move || {
        backend_state.with_project(&session_id, |database| {
            let job = database
                .generation_job(&job_id)?
                .ok_or_else(|| "Generation job does not exist in this project.".to_string())?;
            verify_job_binding(&job, &scene_id, &model, &connection_id)?;
            let purpose = purpose_from_job(&job)?;
            if purpose == GenerationPurpose::Beats && job.status != GenerationJobStatus::Completed {
                return Err("Only a completed generated scene can be added as beats. Generate a new attempt for a partial or interrupted scene.".into());
            }
            if !matches!(job.status, GenerationJobStatus::Completed | GenerationJobStatus::Stopped) {
                return Err("Only a completed or stopped scene draft can be accepted.".into());
            }
            let project = database.read()?;
            let context = build_scene_context(&project, &scene_id)?;
            let guidance = guidance_from_job(&job)?;
            let current_fingerprint = fingerprint_for_purpose(&context, &guidance, purpose)?;
            let scene = project
                .scenes
                .iter()
                .find(|scene| scene.id == scene_id)
                .ok_or("The selected scene is no longer in this project.")?;
            let directions_changed = current_fingerprint != job.input_fingerprint;
            let prose_changed = purpose == GenerationPurpose::Prose && scene.prose != base_prose_from_job(&job)?;
            if (directions_changed || prose_changed) && !acknowledge_outdated {
                return Err("Scene directions or prose changed after generation started. Review the scene and confirm before accepting this draft.".into());
            }
            if purpose == GenerationPurpose::Beats {
                let documents = parse_generated_beats(&job.draft_text, &project, &job.request_snapshot["context"])?;
                return database.accept_generated_beats(expected_project_revision, &job_id, &scene_id, documents, current_time_ms());
            }
            database.accept_generated_prose(
                expected_project_revision,
                AcceptedProseRevision {
                    id: domain::new_id(),
                    job_id,
                    scene_id,
                    previous_prose: scene.prose.clone(),
                    accepted_prose: job.draft_text,
                    accepted_at_ms: current_time_ms(),
                },
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn discard_scene_generation(
    session_id: String,
    scene_id: String,
    job_id: String,
    model: String,
    connection_id: String,
    backend: State<'_, BackendState>,
    generation: State<'_, GenerationState>,
) -> Result<GenerationJob> {
    let generation_state = generation.inner().clone();
    if generation_state.is_active(&session_id, &job_id)? {
        return Err("Stop scene generation before discarding its draft.".into());
    }
    let backend_state = backend.inner().clone();
    super::blocking(move || {
        backend_state.with_project(&session_id, |database| {
            let mut job = database
                .generation_job(&job_id)?
                .ok_or_else(|| "Generation job does not exist in this project.".to_string())?;
            verify_job_binding(&job, &scene_id, &model, &connection_id)?;
            if matches!(
                job.status,
                GenerationJobStatus::Pending | GenerationJobStatus::Streaming
            ) {
                job = database.checkpoint_generation_job(
                    &job.id,
                    GenerationJobStatus::Interrupted,
                    job.draft_text,
                    Some("Generation was interrupted before it could be discarded.".into()),
                    current_time_ms(),
                )?;
            }
            if !matches!(
                job.status,
                GenerationJobStatus::Completed
                    | GenerationJobStatus::Stopped
                    | GenerationJobStatus::Failed
                    | GenerationJobStatus::Interrupted
            ) {
                return Err("This generation draft can no longer be discarded.".into());
            }
            database.checkpoint_generation_job(
                &job.id,
                GenerationJobStatus::Discarded,
                job.draft_text,
                job.error_message,
                current_time_ms(),
            )
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn rich_summary_context_matches_frontend_fingerprints_for_both_purposes() {
        let project: ProjectSnapshot =
            serde_json::from_str(include_str!("../../../src/test/summary-board-context.json"))
                .unwrap();
        let context = build_scene_context(&project, "scene").unwrap();
        let prose = fingerprint_for_purpose(&context, "", GenerationPurpose::Prose).unwrap();
        let beats = fingerprint_for_purpose(&context, "", GenerationPurpose::Beats).unwrap();
        assert_eq!(prose, "8202f5d7b8870fd9");
        assert_eq!(beats, "71f34330f03469e6");
        assert_eq!(context.referenced_characters.len(), 2);
        assert!(context
            .referenced_characters
            .iter()
            .all(|character| character.id != "joy"));
        assert!(validate_context_for_purpose(&context, GenerationPurpose::Beats).is_ok());
    }
    #[test]
    fn summary_board_resolves_blocks_and_generates_without_beats() {
        let mut project: ProjectSnapshot =
            serde_json::from_str(include_str!("../../../src/test/global-block-context.json"))
                .unwrap();
        project.scenes[0].beats.clear();
        project.scenes[0].summary_document = Some(
            json!({"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"toneReference","attrs":{"toneId":"tense","label":"Old tone"}},
                {"type":"characterReference","attrs":{"characterId":"maya","occurrenceId":"summary-maya","label":"Old name","emotion":"","delivery":"softly"}},
                {"type":"emotionReference","attrs":{"emotionId":"awe","label":"Old emotion","targetOccurrenceId":"summary-maya"}},
                {"type":"text","text":" tends the wounds."}
            ]}]}),
        );
        let context = build_scene_context(&project, "scene").unwrap();
        assert_eq!(context.summary_board.id, "scene:summary");
        assert_eq!(context.summary_board.tone, "Tense");
        assert_eq!(context.scene.tone_id, "tense");
        assert!(context
            .summary_board
            .readable_text
            .contains("[Scene tone: Tense]"));
        assert!(context
            .summary_board
            .readable_text
            .contains("[Emotion: Awe → Maya]"));
        assert_eq!(
            context.summary_board.references[0].occurrence_id,
            "summary-maya"
        );
        assert_eq!(context.referenced_characters.len(), 1);
        assert!(validate_context_for_purpose(&context, GenerationPurpose::Beats).is_ok());
        assert!(validate_context_for_purpose(&context, GenerationPurpose::Prose).is_ok());
        assert_ne!(
            fingerprint_for_purpose(&context, "", GenerationPurpose::Beats).unwrap(),
            fingerprint(&context, "").unwrap()
        );
        let request =
            make_request_for_purpose("test-model", "", &context, GenerationPurpose::Beats);
        assert!(request.instructions.unwrap().contains("JSON object"));
        assert!(request.input[0].content.contains("summary-maya"));
        assert!(make_request("test-model", "", &context)
            .instructions
            .unwrap()
            .contains("summary board"));
    }

    #[test]
    fn generated_beats_validate_supplied_ids_and_remap_local_targets() {
        let project: ProjectSnapshot =
            serde_json::from_str(include_str!("../../../src/test/global-block-context.json"))
                .unwrap();
        let context =
            serde_json::to_value(build_scene_context(&project, "scene").unwrap()).unwrap();
        let source = project.scenes[0].beats[0].document.clone();
        let draft = json!({"beats":[{"document":source}]}).to_string();
        let documents = parse_generated_beats(&draft, &project, &context).unwrap();
        let nodes = &documents[0]["content"][0]["content"];
        let next_occurrence = nodes[2]["attrs"]["occurrenceId"].as_str().unwrap();
        assert_ne!(next_occurrence, "maya-once");
        assert_eq!(nodes[3]["attrs"]["targetOccurrenceId"], next_occurrence);
        let mut invalid: Value = serde_json::from_str(&draft).unwrap();
        invalid["beats"][0]["document"]["content"][0]["content"][2]["attrs"]["characterId"] =
            json!("unrelated");
        assert!(
            parse_generated_beats(&invalid.to_string(), &project, &context)
                .unwrap_err()
                .contains("not supplied")
        );
        let mut invalid: Value = serde_json::from_str(&draft).unwrap();
        invalid["beats"][0]["document"]["content"][0]["content"][3]["attrs"]
            ["targetOccurrenceId"] = json!("different-occurrence");
        assert!(parse_generated_beats(&invalid.to_string(), &project, &context).is_err());
        assert!(parse_generated_beats("{\"beats\":[", &project, &context).is_err());
        assert!(parse_generated_beats("{\"beats\":[]}", &project, &context).is_err());
    }
    #[test]
    fn missing_character_reference_blocks_sending_incomplete_context() {
        let mut project: ProjectSnapshot =
            serde_json::from_str(include_str!("../../../src/test/global-block-context.json"))
                .unwrap();
        project
            .characters
            .retain(|character| character.id != "maya");
        let context = build_scene_context(&project, "scene").unwrap();
        assert!(validate_context_for_request(&context)
            .unwrap_err()
            .contains("character definition is missing"));
    }
    #[test]
    fn shared_global_blocks_match_frontend_fingerprint() {
        let project: ProjectSnapshot =
            serde_json::from_str(include_str!("../../../src/test/global-block-context.json"))
                .unwrap();
        let context = build_scene_context(&project, "scene").unwrap();
        assert_eq!(context.beats[0].tone, "Tense");
        assert_eq!(context.beats[1].tone, "Tender");
        assert!(context.readable_context.contains("[Emotion: Awe → Maya]"));
        assert!(!context.readable_context.contains("Must not leak"));
        assert_eq!(fingerprint(&context, "").unwrap(), "80bd2eb1e85a8048");
    }
    use super::*;
    use domain::{Beat, Chapter, Narration, Scene};

    fn beat(id: &str, document: Value) -> Beat {
        Beat {
            id: id.into(),
            text: "editor text mirror".into(),
            document,
        }
    }

    fn fixture() -> ProjectSnapshot {
        let document = json!({
            "type":"doc",
            "content":[{"type":"paragraph","content":[
                {"type":"characterReference","attrs":{"characterId":"maya","label":"Old Maya","emotion":"serious","delivery":"quiet"}},
                {"type":"text","text":" repairs the damage."}
            ]}]
        });
        ProjectSnapshot {
            tones: vec![],
            emotions: vec![],
            starter_types: vec![],
            project_id: "project-a".into(),
            title: "Private title excluded from request".into(),
            revision: 12,
            chapters: vec![Chapter {
                id: "chapter-a".into(),
                title: "Chapter".into(),
                scene_ids: vec!["scene-a".into(), "scene-b".into()],
            }],
            scenes: vec![
                Scene {
                    tone_id: String::new(),
                    id: "scene-a".into(),
                    chapter_id: "chapter-a".into(),
                    title: "Infirmary".into(),
                    summary: "Maya treats Damian.".into(),
                    summary_document: None,
                    tone: "Tense and tender".into(),
                    prose: String::new(),
                    narration: Narration {
                        point_of_view: "Third person limited".into(),
                        tense: "Past".into(),
                        instructions: "Stay close to Maya.".into(),
                    },
                    beats: vec![beat("beat-a", document)],
                },
                Scene {
                    tone_id: String::new(),
                    id: "scene-b".into(),
                    chapter_id: "chapter-a".into(),
                    title: "Unrelated other scene".into(),
                    summary: "This must never leak.".into(),
                    summary_document: None,
                    tone: String::new(),
                    prose: String::new(),
                    narration: Narration::default(),
                    beats: vec![],
                },
            ],
            characters: vec![
                Character {
                    default_tone_id: String::new(),
                    default_emotion_id: String::new(),
                    id: "maya".into(),
                    name: "Maya".into(),
                    background: "A careful apprentice healer.".into(),
                    voice: "Measured and dry.".into(),
                    personality: "Protective.".into(),
                    archived: true,
                },
                Character {
                    default_tone_id: String::new(),
                    default_emotion_id: String::new(),
                    id: "unreferenced".into(),
                    name: "Unrelated private profile".into(),
                    background: "Secret profile facts.".into(),
                    voice: String::new(),
                    personality: String::new(),
                    archived: false,
                },
            ],
            trash: vec![],
            import_sources: vec![],
            can_undo: false,
            can_redo: false,
        }
    }

    #[test]
    fn request_context_is_limited_to_selected_scene_and_referenced_profiles() {
        let project = fixture();
        let context = build_scene_context(&project, "scene-a").unwrap();
        assert_eq!(context.beats.len(), 1);
        assert_eq!(context.referenced_characters.len(), 1);
        assert_eq!(context.referenced_characters[0].name, "Maya");
        assert!(context.referenced_characters[0].archived);
        assert!(context.readable_context.contains("emotion: serious"));
        assert!(context.readable_context.contains("delivery: quiet"));
        assert!(context
            .readable_context
            .contains("Baseline voice: Measured and dry."));
        assert!(context.readable_context.contains(
            "This profile is archived; it remains attached to an existing beat reference."
        ));
        assert!(!context.readable_context.contains("Unrelated other scene"));
        assert!(!context
            .readable_context
            .contains("Unrelated private profile"));
        assert!(!context.readable_context.contains("Secret profile facts."));
        assert!(!context.readable_context.contains("Private title excluded"));
    }

    #[test]
    fn input_fingerprint_changes_for_relevant_direction_but_not_project_revision() {
        let project = fixture();
        let context = build_scene_context(&project, "scene-a").unwrap();
        let original = fingerprint(&context, "").unwrap();
        // Same canonical JSON/FNV vector as the frontend helper, including a
        // non-ASCII em dash in the rendered character reference.
        assert_eq!(original, "51f2bbee86850c70");
        let mut unrelated_edit = project.clone();
        unrelated_edit.revision += 1;
        unrelated_edit.title = "A renamed project".into();
        let unrelated_context = build_scene_context(&unrelated_edit, "scene-a").unwrap();
        assert_eq!(fingerprint(&unrelated_context, "").unwrap(), original);

        let mut changed_scene = project;
        changed_scene.scenes[0].tone = "Light and comic".into();
        let changed_context = build_scene_context(&changed_scene, "scene-a").unwrap();
        assert_ne!(fingerprint(&changed_context, "").unwrap(), original);
    }

    #[test]
    fn lists_followed_by_paragraphs_keep_the_same_beat_text_as_the_preview() {
        let mut project = fixture();
        project.scenes[0].beats[0].document = json!({
            "type":"doc",
            "content":[
                {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]}]}]},
                {"type":"paragraph","content":[{"type":"text","text":"Then after."}]}
            ]
        });
        let context = build_scene_context(&project, "scene-a").unwrap();
        assert_eq!(context.beats[0].readable_text, "• First\nThen after.");
    }

    #[test]
    fn empty_scene_beats_are_rejected_without_using_editor_mirror_text() {
        let mut project = fixture();
        project.scenes[0].summary.clear();
        project.scenes[0].tone.clear();
        project.scenes[0].beats[0].document = json!({
            "type":"doc",
            "content":[{"type":"paragraph","content":[]}]
        });
        let context = build_scene_context(&project, "scene-a").unwrap();
        assert!(validate_context_for_request(&context)
            .unwrap_err()
            .contains("non-empty beat"));
    }

    #[test]
    fn restored_or_wrong_session_jobs_cannot_be_stopped_as_the_active_job() {
        let state = GenerationState::default();
        let binding = GenerationBinding {
            job_id: "job-a".into(),
            session_id: "session-a".into(),
            scene_id: "scene-a".into(),
            model: "model-a".into(),
            connection_id: "opaque-a".into(),
        };
        let cancel = state.claim(binding).unwrap();
        assert!(!state.request_stop("session-b", "job-a").unwrap());
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(!state.request_stop("session-a", "job-b").unwrap());
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(state.request_stop("session-a", "job-a").unwrap());
        assert!(cancel.load(Ordering::SeqCst));
        state.release("job-a");
    }
}
