use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use thor_geom::sketcher::{DimensionTarget, Sketch};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimensionAnnotation {
    pub target: DimensionTarget,
    pub value: f64,
    pub offset: [f64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub sketch: Sketch,
    pub annotations: Vec<DimensionAnnotation>,
}

impl Project {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            sketch: Sketch {
                entities: Vec::new(),
                constraints: Vec::new(),
            },
            annotations: Vec::new(),
        }
    }

    pub fn save(&self, path: &str) -> std::io::Result<()> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
        fs::write(path, content)
    }

    pub fn load(path: &str) -> std::io::Result<Self> {
        Self::load_from_path(Path::new(path))
    }

    pub fn load_from_path(path: &Path) -> std::io::Result<Self> {
        let content = fs::read_to_string(path)?;
        serde_json::from_str(&content)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
    }
}
