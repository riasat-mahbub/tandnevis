use super::domain::{
    document_text, new_id, summary_document, walk_nodes, Character, ProjectSnapshot, Result,
    Scene, TrashEntry,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipChange {
    #[serde(default)]
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub kind: String,
    pub mutual: bool,
    pub scene_id: String,
    pub phase: String,
    pub description: String,
    pub status: String,
}
impl RelationshipChange {
    fn key(&self) -> String {
        serde_json::to_string(&(&self.source_id, &self.target_id, &self.kind, self.mutual)).unwrap()
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipContext {
    pub before: Vec<RelationshipChange>,
    pub after: Vec<RelationshipChange>,
    pub changes: Vec<RelationshipChange>,
}

impl ProjectSnapshot {
    pub fn set_relationship(&mut self, mut change: RelationshipChange) -> Result<()> {
        if !change.scene_id.is_empty() && !self.scenes.iter().any(|s| s.id == change.scene_id) {
            return Err("Scene does not exist.".into());
        }
        if change.mutual && change.source_id > change.target_id {
            std::mem::swap(&mut change.source_id, &mut change.target_id);
        }
        change.description = change.description.trim().into();
        let explicit = (!change.id.is_empty())
            .then(|| self.relationship_changes.iter().position(|r| r.id == change.id))
            .flatten()
            .filter(|index| {
                self.relationship_changes[*index].scene_id == change.scene_id
                    && self.relationship_changes[*index].phase == change.phase
            });
        let id;
        if let Some(index) = explicit {
            id = self.relationship_changes[index].id.clone();
            if self.relationship_changes.iter().enumerate().any(|(other_index, r)| {
                other_index != index
                    && r.scene_id == change.scene_id
                    && r.phase == change.phase
                    && r.key() == change.key()
            }) {
                return Err("A relationship change with those endpoints already exists in this scene state.".into());
            }
            change.id = id.clone();
            self.relationship_changes[index] = change;
        } else if let Some(existing) = self
            .relationship_changes
            .iter_mut()
            .find(|r| r.key() == change.key() && r.scene_id == change.scene_id && r.phase == change.phase)
        {
            change.id = existing.id.clone();
            id = change.id.clone();
            *existing = change;
        } else {
            change.id = new_id();
            id = change.id.clone();
            self.relationship_changes.push(change);
        }
        self.ensure_relationship_change_node(&id)?;
        Ok(())
    }

    pub fn replace_relationship(
        &mut self,
        mut change: RelationshipChange,
        previous_change_id: &str,
    ) -> Result<()> {
        let previous = self
            .relationship_changes
            .iter()
            .find(|r| r.id == previous_change_id)
            .cloned()
            .ok_or("Relationship change does not exist.")?;
        if !change.scene_id.is_empty() && !self.scenes.iter().any(|s| s.id == change.scene_id) {
            return Err("Scene does not exist.".into());
        }
        if previous.scene_id == change.scene_id && previous.phase == change.phase {
            change.id = previous.id.clone();
        } else {
            // The previous ID belongs to another scene state. Never let it select
            // an unrelated target record while replacing an inherited edge.
            change.id.clear();
        }
        let mut desired = change.clone();
        if desired.mutual && desired.source_id > desired.target_id {
            std::mem::swap(&mut desired.source_id, &mut desired.target_id);
        }
        let identity_changed = previous.key() != desired.key();

        // The new edge is installed first. Existing local records keep their block
        // ID, while inherited records get a fresh scene-scoped ID.
        self.set_relationship(change)?;

        if !identity_changed {
            if previous.scene_id.is_empty() && !desired.scene_id.is_empty() {
                // A scene-local assertion of the same edge simply overrides the
                // inherited baseline; no empty tombstone is needed.
                return Ok(());
            }
            if desired.scene_id.is_empty() && previous.scene_id != desired.scene_id {
                self.remove_relationship_change_nodes(previous_change_id);
                self.relationship_changes.retain(|r| r.id != previous_change_id);
            }
            return Ok(());
        }

        if desired.scene_id.is_empty() {
            // The initial state has no scene block in which to author an ending.
            // When moving a local record back to the initial state, remove that
            // local record after installing the new baseline entry.
            if !previous.scene_id.is_empty() {
                self.remove_relationship_change_nodes(previous_change_id);
                self.relationship_changes.retain(|r| r.id != previous_change_id);
            }
            return Ok(());
        }

        let mut tombstone = previous;
        tombstone.id.clear();
        tombstone.scene_id = desired.scene_id;
        tombstone.phase = desired.phase;
        tombstone.description.clear();
        tombstone.status = desired.status;
        self.set_relationship(tombstone)
    }

    pub fn ensure_relationship_change_node(&mut self, change_id: &str) -> Result<()> {
        let change = self
            .relationship_changes
            .iter()
            .find(|r| r.id == change_id)
            .ok_or("Relationship change does not exist.")?;
        if change.scene_id.is_empty() {
            return Ok(());
        }
        let scene_index = self
            .scenes
            .iter()
            .position(|s| s.id == change.scene_id)
            .ok_or("Scene does not exist.")?;
        if self.scenes[scene_index].summary_document.is_none() {
            let document = summary_document(&self.scenes[scene_index], &self.tones);
            self.scenes[scene_index].summary_document = Some(document);
        }
        let document = self.scenes[scene_index].summary_document.as_mut().unwrap();
        if document_has_relationship_node(document, change_id) {
            return Ok(());
        }
        if !document["content"].is_array() {
            if document["content"].is_null() {
                document["content"] = json!([]);
            } else {
                return Err("Scene summary content must be an array.".into());
            }
        }
        document["content"].as_array_mut().unwrap().push(json!({
            "type": "paragraph",
            "content": [{"type":"relationshipChange","attrs":{"changeId":change_id}}]
        }));
        Ok(())
    }

    pub fn remove_relationship_change_nodes(&mut self, change_id: &str) {
        for scene in &mut self.scenes {
            if let Some(document) = &mut scene.summary_document {
                remove_relationship_nodes(document, change_id);
            }
        }
        for entry in &mut self.trash {
            let _ = for_each_trashed_scene_mut(entry, &mut |scene| {
                if let Some(document) = scene.get_mut("summaryDocument") {
                    remove_relationship_nodes(document, change_id);
                }
                Ok(())
            });
        }
    }

    pub fn reconcile_scene_relationship_changes(&mut self, scene_id: &str) -> Result<()> {
        let scene_index = self
            .scenes
            .iter()
            .position(|s| s.id == scene_id)
            .ok_or("Scene does not exist.")?;
        let document = self.scenes[scene_index]
            .summary_document
            .clone()
            .unwrap_or_else(|| summary_document(&self.scenes[scene_index], &self.tones));

        // Resolve first, before mutating graph state, so bad references reject the
        // operation atomically and never leave a half-updated scene.
        document_text_with_relationship_changes(
            &document,
            &self.characters,
            &self.tones,
            &self.emotions,
            &self.relationship_changes,
            scene_id,
        )?;
        let ids = relationship_node_ids(&document);
        self.relationship_changes
            .retain(|change| change.scene_id != scene_id || ids.contains(&change.id));
        self.scenes[scene_index].summary_document = Some(document);
        Ok(())
    }

    /// Upgrade old relationship events in the in-memory snapshot without changing
    /// the source database. Existing authored nodes are left in place.
    pub fn materialize_missing_relationship_nodes(&mut self) -> Result<()> {
        let event_pairs: Vec<_> = self
            .relationship_changes
            .iter()
            .filter(|r| !r.scene_id.is_empty())
            .map(|r| (r.scene_id.clone(), r.id.clone()))
            .collect();
        for (scene_id, change_id) in &event_pairs {
            if let Some(scene_index) = self.scenes.iter().position(|s| &s.id == scene_id) {
                if self.scenes[scene_index].summary_document.is_none() {
                    let document = summary_document(&self.scenes[scene_index], &self.tones);
                    self.scenes[scene_index].summary_document = Some(document);
                }
                append_relationship_node_if_missing(
                    self.scenes[scene_index].summary_document.as_mut().unwrap(),
                    change_id,
                )?;
                continue;
            }
            for entry in &mut self.trash {
                for_each_trashed_scene_mut(entry, &mut |scene| {
                    if scene["id"].as_str() == Some(scene_id.as_str()) {
                        let document = scene_summary_document(scene, &self.tones)?;
                        append_relationship_node_if_missing(document, change_id)?;
                    }
                    Ok(())
                })?;
            }
        }
        Ok(())
    }

    pub fn validate_relationships(&self) -> Result<()> {
        if self.relationship_changes.len() > 50_000 { return Err("Too many relationship changes.".into()); }
        let mut scopes = HashSet::new();
        for r in &self.relationship_changes {
            if r.source_id == r.target_id || !self.characters.iter().any(|c| c.id == r.source_id) || !self.characters.iter().any(|c| c.id == r.target_id) {
                return Err("Choose two different project characters for a relationship.".into());
            }
            if !["attitude", "family"].contains(&r.kind.as_str()) || !["before", "after"].contains(&r.phase.as_str()) || !["planned", "established"].contains(&r.status.as_str()) {
                return Err("Relationship kind, phase, or status is invalid.".into());
            }
            if r.scene_id.is_empty() && (r.phase != "before" || r.status != "established") { return Err("Initial relationships must be established Before states.".into()); }
            if !r.scene_id.is_empty() && !self.retained_scene_exists(&r.scene_id) {
                return Err("Relationship change refers to a scene that does not exist.".into());
            }
            if r.description.len() > 20_000 { return Err("Relationship description exceeds the 20 KB limit.".into()); }
            if r.mutual && r.source_id > r.target_id { return Err("Shared relationship endpoints must be normalized.".into()); }
            if !scopes.insert((r.key(), &r.scene_id, &r.phase)) { return Err("Duplicate relationship change in the same scene state.".into()); }
        }
        for (character_id, position) in &self.relationship_layout {
            if !self.characters.iter().any(|c| &c.id == character_id)
                || !position.x.is_finite()
                || !position.y.is_finite()
                || position.x.abs() > 1_000_000.0
                || position.y.abs() > 1_000_000.0
            {
                return Err("Relationship layout contains an invalid character or position.".into());
            }
        }
        for ids in self.relationship_cast.values() {
            if ids.len() > self.characters.len() || ids.iter().collect::<HashSet<_>>().len() != ids.len() || ids.iter().any(|id| !self.characters.iter().any(|c| &c.id == id)) {
                return Err("Relationship context contains an unknown or duplicate character.".into());
            }
        }
        self.validate_relationship_summary_links()?;
        Ok(())
    }

    fn retained_scene_exists(&self, scene_id: &str) -> bool {
        self.scenes.iter().any(|scene| scene.id == scene_id)
            || self.trash.iter().any(|entry| {
                (entry.kind == "scene" && entry.payload["scene"]["id"].as_str() == Some(scene_id))
                    || (entry.kind == "chapter"
                        && entry.payload["scenes"].as_array().is_some_and(|scenes| {
                            scenes.iter().any(|scene| scene["id"].as_str() == Some(scene_id))
                        }))
            })
    }

    fn validate_relationship_summary_links(&self) -> Result<()> {
        for scene in &self.scenes {
            let document = scene
                .summary_document
                .as_ref()
                .ok_or("Scene summary document is missing.")?;
            self.validate_relationship_document(&scene.id, document)?;
        }
        for entry in &self.trash {
            let mut validate = |value: &mut Value| -> Result<()> {
                let scene: Scene = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                let document = scene
                    .summary_document
                    .clone()
                    .unwrap_or_else(|| summary_document(&scene, &self.tones));
                self.validate_relationship_document(&scene.id, &document)
            };
            for_each_trashed_scene_mut_ref(entry, &mut validate)?;
        }
        Ok(())
    }

    fn validate_relationship_document(&self, scene_id: &str, document: &Value) -> Result<()> {
        let ids = relationship_node_ids(document);
        document_text_with_relationship_changes(
            document,
            &self.characters,
            &self.tones,
            &self.emotions,
            &self.relationship_changes,
            scene_id,
        )?;
        let expected: HashSet<_> = self
            .relationship_changes
            .iter()
            .filter(|r| r.scene_id == scene_id)
            .map(|r| r.id.clone())
            .collect();
        if ids != expected {
            return Err("Scene relationship changes must match its summary blocks.".into());
        }
        Ok(())
    }

    pub fn relationship_states(&self, scene_id: &str) -> Result<RelationshipContext> {
        let mut state = BTreeMap::new();
        let apply = |state: &mut BTreeMap<String, RelationshipChange>, id: &str, phase: &str| {
            for r in &self.relationship_changes { if r.scene_id == id && r.phase == phase { state.insert(r.key(), r.clone()); } }
        };
        apply(&mut state, "", "before");
        for id in self.chapters.iter().flat_map(|c| &c.scene_ids) {
            apply(&mut state, id, "before");
            if id == scene_id {
                let before = state.values().cloned().collect();
                apply(&mut state, id, "after");
                let mut changes: Vec<_> = self.relationship_changes.iter().filter(|r| r.scene_id == scene_id && r.phase == "after").cloned().collect();
                changes.sort_by_key(|r| r.key());
                return Ok(RelationshipContext { before, after: state.into_values().collect(), changes });
            }
            apply(&mut state, id, "after");
        }
        Err("The selected scene is no longer in this project.".into())
    }

    pub fn relationship_character_ids(&self, scene_id: &str, referenced: &[String]) -> Vec<String> {
        let mut ids = referenced.to_vec();
        for id in self.relationship_cast.get(scene_id).into_iter().flatten().chain(self.relationship_changes.iter().filter(|r| r.scene_id == scene_id).flat_map(|r| [&r.source_id, &r.target_id])) {
            if !ids.contains(id) { ids.push(id.clone()); }
        }
        ids
    }

    pub fn scene_relationship_context(&self, scene_id: &str, ids: &[String]) -> Result<Option<RelationshipContext>> {
        if self.relationship_changes.is_empty() { return Ok(None); }
        let mut context = self.relationship_states(scene_id)?;
        let relevant = |r: &RelationshipChange| ids.contains(&r.source_id) && ids.contains(&r.target_id);
        context.before.retain(relevant); context.after.retain(relevant); context.changes.retain(relevant);
        Ok(if context.before.is_empty() && context.after.is_empty() && context.changes.is_empty() { None } else { Some(context) })
    }
}

pub(super) fn remap_relationship_change_nodes(document: &mut Value, remap: &std::collections::HashMap<String, String>) {
    if let Some(nodes) = document.get_mut("content").and_then(Value::as_array_mut) {
        for node in nodes {
            remap_relationship_change_nodes(node, remap);
        }
    }
    if document["type"].as_str() == Some("relationshipChange") {
        if let Some(id) = document["attrs"]["changeId"].as_str() {
            if let Some(next) = remap.get(id) {
                document["attrs"]["changeId"] = json!(next);
            }
        }
    }
}

fn relationship_node_ids(document: &Value) -> HashSet<String> {
    let mut ids = HashSet::new();
    walk_nodes(document, &mut |node| {
        if node["type"].as_str() == Some("relationshipChange") {
            if let Some(id) = node["attrs"]["changeId"].as_str() {
                ids.insert(id.to_owned());
            }
        }
    });
    ids
}

fn document_has_relationship_node(document: &Value, change_id: &str) -> bool {
    let mut found = false;
    walk_nodes(document, &mut |node| {
        if node["type"].as_str() == Some("relationshipChange")
            && node["attrs"]["changeId"].as_str() == Some(change_id)
        {
            found = true;
        }
    });
    found
}

fn append_relationship_node_if_missing(document: &mut Value, change_id: &str) -> Result<()> {
    if document_has_relationship_node(document, change_id) {
        return Ok(());
    }
    if document["type"].as_str() != Some("doc") {
        return Err("Scene summary root must be type doc.".into());
    }
    if document["content"].is_null() {
        document["content"] = json!([]);
    }
    let content = document["content"]
        .as_array_mut()
        .ok_or("Scene summary content must be an array.")?;
    content.push(json!({
        "type":"paragraph",
        "content":[{"type":"relationshipChange","attrs":{"changeId":change_id}}]
    }));
    Ok(())
}

fn remove_relationship_nodes(document: &mut Value, change_id: &str) {
    let Some(object) = document.as_object_mut() else {
        return;
    };
    let Some(children) = object.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    children.retain(|node| {
        !(node["type"].as_str() == Some("relationshipChange")
            && node["attrs"]["changeId"].as_str() == Some(change_id))
    });
    for child in children {
        remove_relationship_nodes(child, change_id);
    }
}

fn scene_summary_document<'a>(scene: &'a mut Value, tones: &[super::domain::Preset]) -> Result<&'a mut Value> {
    if scene["summaryDocument"].as_object().is_none() {
        let parsed: Scene = serde_json::from_value(scene.clone()).map_err(|e| e.to_string())?;
        scene["summaryDocument"] = summary_document(&parsed, tones);
    }
    Ok(scene.get_mut("summaryDocument").unwrap())
}

fn for_each_trashed_scene_mut(
    entry: &mut TrashEntry,
    action: &mut impl FnMut(&mut Value) -> Result<()>,
) -> Result<()> {
    match entry.kind.as_str() {
        "scene" => {
            if let Some(scene) = entry.payload.get_mut("scene") {
                action(scene)?;
            }
        }
        "chapter" => {
            if let Some(scenes) = entry.payload.get_mut("scenes").and_then(Value::as_array_mut) {
                for scene in scenes {
                    action(scene)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn for_each_trashed_scene_mut_ref(
    entry: &TrashEntry,
    action: &mut impl FnMut(&mut Value) -> Result<()>,
) -> Result<()> {
    // Validation only reads the scene object. Clone each small trash payload entry
    // so this helper can share the same scene traversal shape as migration edits.
    let mut copy = entry.clone();
    for_each_trashed_scene_mut(&mut copy, action)
}

pub(super) fn document_text_with_relationship_changes(
    document: &Value,
    characters: &[super::domain::Character],
    tones: &[super::domain::Preset],
    emotions: &[super::domain::Preset],
    changes: &[RelationshipChange],
    scene_id: &str,
) -> Result<String> {
    fn transform(
        node: &mut Value,
        characters: &[Character],
        changes: &[RelationshipChange],
        scene_id: &str,
        seen: &mut HashSet<String>,
        depth: usize,
        count: &mut usize,
    ) -> Result<()> {
        *count += 1;
        if depth > 64 || *count > 100_000 {
            return Err("Scene summary is too complex.".into());
        }
        if node["type"].as_str() == Some("relationshipChange") {
            if node["content"].as_array().is_some_and(|nodes| !nodes.is_empty())
                || (!node["content"].is_null() && !node["content"].is_array())
            {
                return Err("Relationship changes cannot contain nodes.".into());
            }
            let attrs = node["attrs"]
                .as_object()
                .ok_or("Relationship change needs attributes.")?;
            if attrs.len() != 1 {
                return Err("Relationship change attributes must contain only a change ID.".into());
            }
            let id = attrs["changeId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("Relationship change needs a change ID.")?;
            if !seen.insert(id.to_owned()) {
                return Err("A relationship change can appear only once in a scene summary.".into());
            }
            let mut matching = changes.iter().filter(|change| change.id == id);
            let change = matching
                .next()
                .ok_or("Scene summary refers to an unknown relationship change.")?;
            if matching.next().is_some() {
                return Err("Project contains duplicate relationship change IDs.".into());
            }
            if change.scene_id != scene_id || scene_id.is_empty() {
                return Err("Scene summary refers to a relationship change from another scene.".into());
            }
            *node = json!({"type":"text","text":relationship_change_text(change, characters)});
            return Ok(());
        }
        if let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) {
            for child in children {
                transform(child, characters, changes, scene_id, seen, depth + 1, count)?;
            }
        }
        Ok(())
    }

    let mut transformed = document.clone();
    transform(
        &mut transformed,
        characters,
        changes,
        scene_id,
        &mut HashSet::new(),
        0,
        &mut 0,
    )?;
    document_text(&transformed, characters, tones, emotions)
}

pub(super) fn relationship_change_text(
    change: &RelationshipChange,
    characters: &[Character],
) -> String {
    let name = |id: &str| {
        characters
            .iter()
            .find(|character| character.id == id)
            .map(|character| character.name.as_str())
            .unwrap_or("Unknown character")
    };
    let direction = if change.mutual { "\u{2194}" } else { "\u{2192}" };
    let phase = if change.phase == "before" {
        "At scene entry"
    } else {
        "By scene end"
    };
    let description = if change.description.trim().is_empty() {
        "End relationship"
    } else {
        change.description.trim()
    };
    format!(
        "[Relationship change: {} {} {} · {} · {} · {} · {}]",
        name(&change.source_id),
        direction,
        name(&change.target_id),
        phase,
        change.kind,
        description,
        change.status,
    )
}

pub fn readable_relationships(project: &ProjectSnapshot, context: &RelationshipContext) -> String {
    let name = |id: &str| project.characters.iter().find(|c| c.id == id).map(|c| c.name.as_str()).unwrap_or("Unknown character");
    let lines = |items: &[RelationshipChange], empty: &str| {
        if items.is_empty() { return empty.into(); }
        items.iter().map(|r| format!("- {} {} {} [{}; {}]: {}", name(&r.source_id), if r.mutual { "↔" } else { "→" }, name(&r.target_id), r.kind, r.status, if r.description.is_empty() { "(relationship cleared)" } else { &r.description })).collect::<Vec<_>>().join("\n")
    };
    [
        "Relationship continuity (story reading order):".into(),
        "Before this scene — entering state; planned entries are provisional, not established facts:".into(),
        lines(&context.before, "(No relationships specified.)"),
        "After this scene — authored target state; write the transition, do not treat this as already true at entry:".into(),
        lines(&context.after, "(No relationships specified.)"),
        "Changes intended in this scene:".into(),
        lines(&context.changes, "(No lasting relationship changes specified.)"),
        "Attitudes are directional. Cooperation does not imply friendship or reciprocal trust. Author knowledge is not shared character knowledge. Scene summary and beats describe the encounter. Prose acceptance does not establish planned changes.".into(),
    ].join("\n")
}
