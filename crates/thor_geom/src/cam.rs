use clipper2::{EndType, JoinType, Path, Paths, Point};
use serde::{Deserialize, Serialize};

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

pub fn generate_profile(operation: &CamOperation, tool: &Tool, points: &[[f64; 2]]) -> Toolpath {
    let clipper_points: Vec<Point> = points.iter().map(|p| Point::new(p[0], p[1])).collect();

    let path = Path::new(clipper_points);
    let paths = Paths::new(vec![path]);

    let offset_dist = match operation.strategy {
        CamStrategy::ProfileOutside => tool.diameter / 2.0,
        CamStrategy::ProfileInside => -tool.diameter / 2.0,
        _ => 0.0,
    };

    let result = paths
        .inflate(offset_dist, JoinType::Square, EndType::Polygon, 2.0)
        .simplify(0.01, false);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_operation(strategy: CamStrategy) -> CamOperation {
        CamOperation {
            id: "op1".to_string(),
            strategy,
            tool_id: "t1".to_string(),
            stepover: 0.5,
            stepdown: 1.0,
            target_depth: -3.0,
        }
    }

    #[test]
    fn profile_from_rectangle_generates_closed_segment_at_depth() {
        let tool = Tool { diameter: 6.0 };
        let rect = [[0.0, 0.0], [20.0, 0.0], [20.0, 10.0], [0.0, 10.0]];
        let toolpath = generate_profile(
            &profile_operation(CamStrategy::ProfileOutside),
            &tool,
            &rect,
        );

        assert!(!toolpath.segments.is_empty());
        let segment = &toolpath.segments[0];
        assert!(segment.len() >= 4);
        assert_eq!(segment.first(), segment.last());
        assert!(segment.iter().all(|point| point[2] == -3.0));
    }

    #[test]
    fn inside_profile_offsets_inward() {
        let tool = Tool { diameter: 4.0 };
        let rect = [[0.0, 0.0], [20.0, 0.0], [20.0, 10.0], [0.0, 10.0]];
        let toolpath =
            generate_profile(&profile_operation(CamStrategy::ProfileInside), &tool, &rect);

        let first_x = toolpath.segments[0][0][0];
        assert!(first_x > 0.0);
    }
}
