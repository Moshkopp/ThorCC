use serde::{Deserialize, Serialize};
use clipper2::{Path, Paths, Point};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CamStrategy {
    ProfileInside,
    ProfileOutside,
    ProfileOn,
    Pocket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CamOperation {
    pub id: String,
    pub strategy: CamStrategy,
    pub tool_id: String,
    pub stepover: f64,
    pub stepdown: f64,
    pub target_depth: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub diameter: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Toolpath {
    pub segments: Vec<Vec<[f64; 3]>>,
}

pub fn generate_profile(operation: &CamOperation, tool: &Tool, points: &Vec<[f64; 2]>) -> Toolpath {
    let clipper_points: Vec<Point> = points.iter()
        .map(|p| Point::new(p[0], p[1]))
        .collect();
    
    let path = Path::new(clipper_points);
    let paths = Paths::new(vec![path]);

    let offset_dist = match operation.strategy {
        CamStrategy::ProfileOutside => tool.diameter / 2.0,
        CamStrategy::ProfileInside => -tool.diameter / 2.0,
        _ => 0.0,
    };

    let result = paths.offset(offset_dist, 2.0);
    
    let mut segments = Vec::new();
    for p in result {
        let mut segment = Vec::new();
        for pt in p {
            segment.push([pt.x(), pt.y(), operation.target_depth]);
        }
        if let Some(first) = segment.first().cloned() {
            segment.push(first);
        }
        segments.push(segment);
    }
    Toolpath { segments }
}
