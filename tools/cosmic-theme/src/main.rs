//! Writes COSMIC's dark and light themes, built from the theme builders in
//! the system defaults (`XDG_DATA_DIRS`), to the user config directory
//! (`XDG_CONFIG_HOME`).
//!
//! COSMIC's desktop reads the computed theme (`com.system76.CosmicTheme.Dark`
//! and `.Light`), not the builder: the builder is what COSMIC Settings edits,
//! and it writes the theme it builds from it. Changing only the builder's
//! accent changes nothing until a user opens the Appearance page, so AgentUX
//! ships the theme this builds as well.

use cosmic_config::CosmicConfigEntry;
use cosmic_theme::{Theme, ThemeBuilder};

fn main() {
    for (name, builder, theme) in [
        ("dark", ThemeBuilder::dark_config(), Theme::dark_config()),
        ("light", ThemeBuilder::light_config(), Theme::light_config()),
    ] {
        let builder = builder.unwrap_or_else(|err| panic!("{name} builder config: {err}"));
        // As COSMIC does: a key that is missing from the defaults or does not
        // parse keeps its built-in value. Fedora 44's COSMIC 1.10 ships only
        // some of the builder's keys, and a palette this release cannot read.
        let builder = ThemeBuilder::get_entry(&builder).unwrap_or_else(|(errors, builder)| {
            for error in errors.into_iter().filter(cosmic_config::Error::is_err) {
                eprintln!("warning: {name} builder default kept built in: {error:?}");
            }
            builder
        });
        let theme = theme.unwrap_or_else(|err| panic!("{name} theme config: {err}"));
        builder
            .build()
            .write_entry(&theme)
            .unwrap_or_else(|err| panic!("writing the {name} theme: {err}"));
    }
}
