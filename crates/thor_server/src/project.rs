use serde::{Deserialize, Serialize};
use thor_geom::sketcher::{DimensionTarget, Sketch};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimensionAnnotation {
    pub target: DimensionTarget,
    pub value: f64,
    pub offset: [f64; 2],
}

#[derive(Debug, Serialize, Deserialize)]
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

    pub fn save(&self, _path: &str) -> std::io::Result<()> {
        // Implementation for saving to file
        Ok(())
    }

    pub fn load(_path: &str) -> std::io::Result<Self> {
        // Implementation for loading from file
        Ok(Self::new("Loaded Project"))
    }
}
