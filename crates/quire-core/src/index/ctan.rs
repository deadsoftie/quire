use std::collections::HashMap;

use serde::Deserialize;

const CTAN_COMMANDS_JSON: &str = include_str!("../../data/ctan-commands.json");

#[derive(Deserialize)]
struct RawCommand {
    name: String,
    arity: u32,
    #[serde(default)]
    detail: Option<String>,
}

pub struct CtanCommand {
    /// Without the leading backslash, matching `MacroDef::name`'s convention.
    pub name: String,
    pub arity: u32,
    pub detail: Option<String>,
}

fn database() -> HashMap<String, Vec<RawCommand>> {
    serde_json::from_str(CTAN_COMMANDS_JSON)
        .expect("data/ctan-commands.json must be valid JSON matching RawCommand's shape - a build-time asset, not user input, so a parse failure here is a bug in the file itself")
}

pub fn commands_for_packages<'a>(packages: impl Iterator<Item = &'a str>) -> Vec<CtanCommand> {
    let db = database();
    packages
        .filter_map(|pkg| db.get(pkg))
        .flat_map(|cmds| cmds.iter())
        .map(|c| CtanCommand { name: c.name.clone(), arity: c.arity, detail: c.detail.clone() })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_json_parses_and_is_reasonably_shaped() {
        let db = database();
        assert!(db.contains_key("tikz"), "tikz must be in the bundled database: {:?}", db.keys().collect::<Vec<_>>());
        for (package, commands) in &db {
            assert!(!commands.is_empty(), "{package} has no commands - an empty package entry is pointless");
            for cmd in commands {
                assert!(!cmd.name.is_empty(), "{package} has a command with an empty name");
                assert!(!cmd.name.starts_with('\\'), "{package}'s {:?} should not include the leading backslash", cmd.name);
            }
        }
    }

    #[test]
    fn scoping_only_returns_loaded_packages() {
        let loaded = ["tikz"];
        let commands = commands_for_packages(loaded.iter().copied());
        assert!(commands.iter().any(|c| c.name == "draw"), "tikz's own commands should be included");

        let hyperref_only_commands = ["href", "url", "autoref", "nameref"];
        assert!(
            !commands.iter().any(|c| hyperref_only_commands.contains(&c.name.as_str())),
            "hyperref wasn't loaded, so its commands must not appear: {:?}",
            commands.iter().map(|c| &c.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn no_loaded_packages_means_no_commands() {
        let commands = commands_for_packages(std::iter::empty());
        assert!(commands.is_empty());
    }
}
