use kurbo::{PathEl, BezPath, flatten};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolpathPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub feed: f64,
}

pub struct ChainEngine {
    pub tolerance: f64,
}

impl ChainEngine {
    pub fn new(tolerance: f64) -> Self {
        Self { tolerance }
    }

    /// Converts a BezPath into a sampled list of points
    pub fn sample_path(&self, path: &BezPath, z: f64, feed: f64) -> Vec<ToolpathPoint> {
        let mut points = Vec::new();
        
        flatten(path, self.tolerance, |el| {
            match el {
                PathEl::MoveTo(p) | PathEl::LineTo(p) => {
                    points.push(ToolpathPoint {
                        x: p.x,
                        y: p.y,
                        z,
                        feed,
                    });
                }
                PathEl::ClosePath => {
                }
                _ => {}
            }
        });
        
        points
    }
}
