//! Editor backend: row-based chart editing, timing math, and undo history.
//!
//! The design follows ArrowVortex: charts are edited on a 48-rows-per-beat
//! grid ([`timing`]), notes and tempo live in [`chart::EditorChart`], and
//! [`state::EditorState`] holds the open chart plus its history. [`commands`]
//! exposes everything to the React UI as Tauri commands.

pub mod chart;
pub mod commands;
pub mod state;
pub mod timing;
