//! Task 3.5: a CTAN-derived command database, scoped to whichever packages a project actually
//! `\usepackage`s (3.3's tracking, [`super::ProjectIndex::packages`]) -- Section 9.4's whole
//! quality bar here is "only suggest what is actually available," so an unscoped database would
//! just be noise. See `data/README.md` for how the JSON itself is built and maintained.

use std::collections::HashMap;

use serde::Deserialize;

/// Embedded at compile time -- no runtime file to locate or fail to find; the data simply exists
/// inside the binary. Small enough (a hand-curated starter set, not a scrape of all of CTAN) that
/// re-parsing it per request, matching this crate's "no server-side cache, derive fresh every
/// call" convention (`docs/CONTRACT.md`), costs nothing worth avoiding with a lazily-cached static.
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
        .expect("data/ctan-commands.json must be valid JSON matching RawCommand's shape -- a build-time asset, not user input, so a parse failure here is a bug in the file itself")
}

/// Every command from every package in `packages` -- typically [`super::ProjectIndex::packages`],
/// the project's own `\usepackage` loads. A package with no entry in the database (everything not
/// in this starter set) simply contributes nothing, the same as it never being scoped in at all.
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
        assert!(db.contains_key("tikz"), "the acceptance criterion's own example package must exist: {:?}", db.keys().collect::<Vec<_>>());
        for (package, commands) in &db {
            assert!(!commands.is_empty(), "{package} has no commands -- an empty package entry is pointless");
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
