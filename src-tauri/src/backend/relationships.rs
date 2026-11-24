use super::domain::{new_id, ProjectSnapshot, Result};
use serde::{Deserialize, Serialize};
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
        let existing = self.relationship_changes.iter_mut().find(|r| r.key() == change.key() && r.scene_id == change.scene_id && r.phase == change.phase);
        if let Some(existing) = existing { change.id = existing.id.clone(); *existing = change; }
        else { change.id = new_id(); self.relationship_changes.push(change); }
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
            if r.description.len() > 20_000 { return Err("Relationship description exceeds the 20 KB limit.".into()); }
            if r.mutual && r.source_id > r.target_id { return Err("Shared relationship endpoints must be normalized.".into()); }
            if !scopes.insert((r.key(), &r.scene_id, &r.phase)) { return Err("Duplicate relationship change in the same scene state.".into()); }
        }
        for ids in self.relationship_cast.values() {
            if ids.len() > self.characters.len() || ids.iter().collect::<HashSet<_>>().len() != ids.len() || ids.iter().any(|id| !self.characters.iter().any(|c| &c.id == id)) {
                return Err("Relationship context contains an unknown or duplicate character.".into());
            }
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
