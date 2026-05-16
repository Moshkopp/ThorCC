use kurbo::Point;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Entity {
    Point {
        id: String,
        pos: Point,
    },
    Line {
        id: String,
        p1: String,
        p2: String,
    },
    Circle {
        id: String,
        center: String,
        radius: f64,
    },
    Arc {
        id: String,
        center: String,
        start: String,
        end: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Constraint {
    Horizontal(String),
    Vertical(String),
    Parallel(String, String),
    Perpendicular(String, String),
    EqualLength(String, String),
    Coincident(String, String),
    Distance(String, String, f64),
    DistanceX {
        first: String,
        second: Option<String>,
        value: f64,
    },
    DistanceY {
        first: String,
        second: Option<String>,
        value: f64,
    },
    Length {
        line: String,
        value: f64,
    },
    Radius {
        circle: String,
        value: f64,
    },
    Diameter {
        circle: String,
        value: f64,
    },
    Angle(String, String, f64),
    LineAngle {
        line: String,
        value: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sketch {
    pub entities: Vec<Entity>,
    pub constraints: Vec<Constraint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DimensionTarget {
    HorizontalDistance {
        first: String,
        second: Option<String>,
    },
    VerticalDistance {
        first: String,
        second: Option<String>,
    },
    PointDistance {
        first: String,
        second: String,
    },
    LineLength {
        line: String,
    },
    CircleRadius {
        circle: String,
    },
    CircleDiameter {
        circle: String,
    },
    LineAngle {
        line: String,
    },
    LineToLineAngle {
        first: String,
        second: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SketchError {
    MissingEntity(String),
    InvalidTarget(String),
}

impl Sketch {
    pub fn add_dimension(
        &mut self,
        target: DimensionTarget,
        value: f64,
    ) -> Result<(), SketchError> {
        let constraint = self.dimension_constraint(target, value)?;
        self.constraints.push(constraint);
        Ok(())
    }

    pub fn dimension_constraint(
        &self,
        target: DimensionTarget,
        value: f64,
    ) -> Result<Constraint, SketchError> {
        match target {
            DimensionTarget::HorizontalDistance { first, second } => {
                self.require_point(&first)?;
                if let Some(second) = &second {
                    self.require_point(second)?;
                }
                Ok(Constraint::DistanceX {
                    first,
                    second,
                    value,
                })
            }
            DimensionTarget::VerticalDistance { first, second } => {
                self.require_point(&first)?;
                if let Some(second) = &second {
                    self.require_point(second)?;
                }
                Ok(Constraint::DistanceY {
                    first,
                    second,
                    value,
                })
            }
            DimensionTarget::PointDistance { first, second } => {
                self.require_point(&first)?;
                self.require_point(&second)?;
                Ok(Constraint::Distance(first, second, value))
            }
            DimensionTarget::LineLength { line } => {
                self.require_line(&line)?;
                Ok(Constraint::Length { line, value })
            }
            DimensionTarget::CircleRadius { circle } => {
                self.require_circle(&circle)?;
                Ok(Constraint::Radius { circle, value })
            }
            DimensionTarget::CircleDiameter { circle } => {
                self.require_circle(&circle)?;
                Ok(Constraint::Diameter { circle, value })
            }
            DimensionTarget::LineAngle { line } => {
                self.require_line(&line)?;
                Ok(Constraint::LineAngle { line, value })
            }
            DimensionTarget::LineToLineAngle { first, second } => {
                self.require_line(&first)?;
                self.require_line(&second)?;
                Ok(Constraint::Angle(first, second, value))
            }
        }
    }

    pub fn point(&self, id: &str) -> Option<Point> {
        self.entities.iter().find_map(|entity| match entity {
            Entity::Point { id: point_id, pos } if point_id == id => Some(*pos),
            _ => None,
        })
    }

    fn require_point(&self, id: &str) -> Result<(), SketchError> {
        match self.point(id) {
            Some(_) => Ok(()),
            None => Err(SketchError::MissingEntity(id.to_string())),
        }
    }

    fn require_line(&self, id: &str) -> Result<(), SketchError> {
        match self.line_points(id) {
            Some(_) => Ok(()),
            None => Err(SketchError::MissingEntity(id.to_string())),
        }
    }

    fn require_circle(&self, id: &str) -> Result<(), SketchError> {
        match self
            .entities
            .iter()
            .any(|entity| matches!(entity, Entity::Circle { id: circle_id, .. } if circle_id == id))
        {
            true => Ok(()),
            false => Err(SketchError::MissingEntity(id.to_string())),
        }
    }

    fn line_points(&self, id: &str) -> Option<(String, String)> {
        self.entities.iter().find_map(|entity| match entity {
            Entity::Line {
                id: line_id,
                p1,
                p2,
            } if line_id == id => Some((p1.clone(), p2.clone())),
            _ => None,
        })
    }
}

pub struct Solver {
    pub tolerance: f64,
    pub max_iterations: usize,
}

impl Solver {
    pub fn new() -> Self {
        Self {
            tolerance: 1e-6,
            max_iterations: 50,
        }
    }

    pub fn solve(&self, sketch: &mut Sketch) {
        for _ in 0..self.max_iterations {
            let mut max_delta: f64 = 0.0;

            for constraint in sketch.constraints.clone() {
                max_delta = max_delta.max(apply_constraint(sketch, &constraint));
            }

            if max_delta <= self.tolerance {
                break;
            }
        }
    }
}

fn apply_constraint(sketch: &mut Sketch, constraint: &Constraint) -> f64 {
    match constraint {
        Constraint::Horizontal(line) => apply_line_axis(sketch, line, Axis::Y),
        Constraint::Vertical(line) => apply_line_axis(sketch, line, Axis::X),
        Constraint::Coincident(first, second) => move_point_to_point(sketch, second, first),
        Constraint::Distance(first, second, value) => {
            apply_point_distance(sketch, first, second, *value)
        }
        Constraint::DistanceX {
            first,
            second,
            value,
        } => apply_axis_distance(sketch, first, second.as_deref(), *value, Axis::X),
        Constraint::DistanceY {
            first,
            second,
            value,
        } => apply_axis_distance(sketch, first, second.as_deref(), *value, Axis::Y),
        Constraint::Length { line, value } => apply_line_length(sketch, line, *value),
        Constraint::Radius { circle, value } => set_circle_radius(sketch, circle, *value),
        Constraint::Diameter { circle, value } => set_circle_radius(sketch, circle, *value / 2.0),
        Constraint::LineAngle { line, value } => apply_line_angle(sketch, line, *value),
        Constraint::Angle(first, second, value) => {
            apply_line_to_line_angle(sketch, first, second, *value)
        }
        Constraint::EqualLength(first, second) => apply_equal_length(sketch, first, second),
        Constraint::Parallel(_, _) | Constraint::Perpendicular(_, _) => 0.0,
    }
}

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
}

fn apply_line_axis(sketch: &mut Sketch, line: &str, axis: Axis) -> f64 {
    let Some((p1, p2)) = sketch.line_points(line) else {
        return 0.0;
    };
    let Some(anchor) = sketch.point(&p1) else {
        return 0.0;
    };
    let Some(mut point) = sketch.point(&p2) else {
        return 0.0;
    };

    match axis {
        Axis::X => point.x = anchor.x,
        Axis::Y => point.y = anchor.y,
    }

    set_point(sketch, &p2, point)
}

fn apply_axis_distance(
    sketch: &mut Sketch,
    first: &str,
    second: Option<&str>,
    value: f64,
    axis: Axis,
) -> f64 {
    let Some(reference) = second.and_then(|id| sketch.point(id)) else {
        let mut target = match sketch.point(first) {
            Some(point) => point,
            None => return 0.0,
        };
        match axis {
            Axis::X => target.x = value,
            Axis::Y => target.y = value,
        }
        return set_point(sketch, first, target);
    };

    let Some(mut target) = sketch.point(first) else {
        return 0.0;
    };
    match axis {
        Axis::X => target.x = reference.x + value,
        Axis::Y => target.y = reference.y + value,
    }
    set_point(sketch, first, target)
}

fn apply_point_distance(sketch: &mut Sketch, first: &str, second: &str, value: f64) -> f64 {
    let Some(anchor) = sketch.point(first) else {
        return 0.0;
    };
    let Some(point) = sketch.point(second) else {
        return 0.0;
    };
    let vector = point - anchor;
    let current = vector.hypot();
    if current <= f64::EPSILON {
        return 0.0;
    }

    let target = anchor + vector * (value / current);
    set_point(sketch, second, target)
}

fn apply_line_length(sketch: &mut Sketch, line: &str, value: f64) -> f64 {
    let Some((p1, p2)) = sketch.line_points(line) else {
        return 0.0;
    };
    apply_point_distance(sketch, &p1, &p2, value)
}

fn apply_equal_length(sketch: &mut Sketch, first: &str, second: &str) -> f64 {
    let Some((first_p1, first_p2)) = sketch.line_points(first) else {
        return 0.0;
    };
    let Some((second_p1, second_p2)) = sketch.line_points(second) else {
        return 0.0;
    };
    let Some(first_start) = sketch.point(&first_p1) else {
        return 0.0;
    };
    let Some(first_end) = sketch.point(&first_p2) else {
        return 0.0;
    };
    let Some(second_start) = sketch.point(&second_p1) else {
        return 0.0;
    };
    let Some(second_end) = sketch.point(&second_p2) else {
        return 0.0;
    };

    let first_length = (first_end - first_start).hypot();
    let second_length = (second_end - second_start).hypot();
    if first_length <= f64::EPSILON || second_length <= f64::EPSILON {
        return 0.0;
    }

    if let Some(target) = explicit_line_length(sketch, first) {
        return apply_line_length(sketch, second, target);
    }
    if let Some(target) = explicit_line_length(sketch, second) {
        return apply_line_length(sketch, first, target);
    }

    apply_line_length(sketch, second, first_length)
}

fn explicit_line_length(sketch: &Sketch, line: &str) -> Option<f64> {
    sketch.constraints.iter().find_map(|constraint| match constraint {
        Constraint::Length {
            line: constrained_line,
            value,
        } if constrained_line == line => Some(*value),
        _ => None,
    })
}

fn apply_line_angle(sketch: &mut Sketch, line: &str, value: f64) -> f64 {
    let Some((p1, p2)) = sketch.line_points(line) else {
        return 0.0;
    };
    let Some(anchor) = sketch.point(&p1) else {
        return 0.0;
    };
    let Some(point) = sketch.point(&p2) else {
        return 0.0;
    };
    let length = (point - anchor).hypot();
    if length <= f64::EPSILON {
        return 0.0;
    }

    let target = Point::new(
        anchor.x + length * value.cos(),
        anchor.y + length * value.sin(),
    );
    set_point(sketch, &p2, target)
}

fn apply_line_to_line_angle(sketch: &mut Sketch, first: &str, second: &str, value: f64) -> f64 {
    let Some((first_p1, first_p2)) = sketch.line_points(first) else {
        return 0.0;
    };
    let Some((second_p1, second_p2)) = sketch.line_points(second) else {
        return 0.0;
    };
    let Some(a) = sketch.point(&first_p1) else {
        return 0.0;
    };
    let Some(b) = sketch.point(&first_p2) else {
        return 0.0;
    };
    let first_angle = (b.y - a.y).atan2(b.x - a.x);

    let Some(c) = sketch.point(&second_p1) else {
        return 0.0;
    };
    let Some(d) = sketch.point(&second_p2) else {
        return 0.0;
    };
    let length = (d - c).hypot();
    if length <= f64::EPSILON {
        return 0.0;
    }

    let target_angle = first_angle + value;
    let target = Point::new(
        c.x + length * target_angle.cos(),
        c.y + length * target_angle.sin(),
    );
    set_point(sketch, &second_p2, target)
}

fn set_circle_radius(sketch: &mut Sketch, circle: &str, value: f64) -> f64 {
    for entity in &mut sketch.entities {
        if let Entity::Circle { id, radius, .. } = entity {
            if id == circle {
                let delta = (*radius - value).abs();
                *radius = value.max(0.0);
                return delta;
            }
        }
    }
    0.0
}

fn move_point_to_point(sketch: &mut Sketch, target: &str, reference: &str) -> f64 {
    let Some(reference) = sketch.point(reference) else {
        return 0.0;
    };
    set_point(sketch, target, reference)
}

fn set_point(sketch: &mut Sketch, id: &str, target: Point) -> f64 {
    for entity in &mut sketch.entities {
        if let Entity::Point { id: point_id, pos } = entity {
            if point_id == id {
                let delta = (*pos - target).hypot();
                *pos = target;
                return delta;
            }
        }
    }
    0.0
}

pub fn infer_dimension_target(
    sketch: &Sketch,
    selection: &[String],
) -> Result<DimensionTarget, SketchError> {
    let by_id: HashMap<&str, &Entity> = sketch
        .entities
        .iter()
        .map(|entity| match entity {
            Entity::Point { id, .. }
            | Entity::Line { id, .. }
            | Entity::Circle { id, .. }
            | Entity::Arc { id, .. } => (id.as_str(), entity),
        })
        .collect();

    match selection {
        [one] => match by_id.get(one.as_str()) {
            Some(Entity::Line { .. }) => Ok(DimensionTarget::LineLength { line: one.clone() }),
            Some(Entity::Circle { .. }) => Ok(DimensionTarget::CircleDiameter {
                circle: one.clone(),
            }),
            Some(Entity::Point { .. }) => Ok(DimensionTarget::HorizontalDistance {
                first: one.clone(),
                second: None,
            }),
            Some(Entity::Arc { .. }) => Err(SketchError::InvalidTarget(one.clone())),
            None => Err(SketchError::MissingEntity(one.clone())),
        },
        [first, second] => match (by_id.get(first.as_str()), by_id.get(second.as_str())) {
            (Some(Entity::Point { .. }), Some(Entity::Point { .. })) => {
                Ok(DimensionTarget::PointDistance {
                    first: first.clone(),
                    second: second.clone(),
                })
            }
            (Some(Entity::Line { .. }), Some(Entity::Line { .. })) => {
                Ok(DimensionTarget::LineToLineAngle {
                    first: first.clone(),
                    second: second.clone(),
                })
            }
            (Some(_), Some(_)) => Err(SketchError::InvalidTarget(format!("{first},{second}"))),
            (None, _) => Err(SketchError::MissingEntity(first.clone())),
            (_, None) => Err(SketchError::MissingEntity(second.clone())),
        },
        _ => Err(SketchError::InvalidTarget(selection.join(","))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(id: &str, x: f64, y: f64) -> Entity {
        Entity::Point {
            id: id.to_string(),
            pos: Point::new(x, y),
        }
    }

    fn line(id: &str, p1: &str, p2: &str) -> Entity {
        Entity::Line {
            id: id.to_string(),
            p1: p1.to_string(),
            p2: p2.to_string(),
        }
    }

    #[test]
    fn length_dimension_resizes_line_from_first_point() {
        let mut sketch = Sketch {
            entities: vec![
                point("p1", 0.0, 0.0),
                point("p2", 3.0, 4.0),
                line("l1", "p1", "p2"),
            ],
            constraints: vec![],
        };

        sketch
            .add_dimension(
                DimensionTarget::LineLength {
                    line: "l1".to_string(),
                },
                10.0,
            )
            .unwrap();
        Solver::new().solve(&mut sketch);

        let p2 = sketch.point("p2").unwrap();
        assert!((p2.x - 6.0).abs() < 1e-6);
        assert!((p2.y - 8.0).abs() < 1e-6);
    }

    #[test]
    fn horizontal_distance_can_lock_point_to_origin() {
        let mut sketch = Sketch {
            entities: vec![point("p1", 3.0, 4.0)],
            constraints: vec![],
        };

        sketch
            .add_dimension(
                DimensionTarget::HorizontalDistance {
                    first: "p1".to_string(),
                    second: None,
                },
                12.0,
            )
            .unwrap();
        Solver::new().solve(&mut sketch);

        assert_eq!(sketch.point("p1").unwrap().x, 12.0);
    }

    #[test]
    fn diameter_dimension_updates_circle_radius() {
        let mut sketch = Sketch {
            entities: vec![
                point("center", 0.0, 0.0),
                Entity::Circle {
                    id: "c1".to_string(),
                    center: "center".to_string(),
                    radius: 2.0,
                },
            ],
            constraints: vec![],
        };

        sketch
            .add_dimension(
                DimensionTarget::CircleDiameter {
                    circle: "c1".to_string(),
                },
                14.0,
            )
            .unwrap();
        Solver::new().solve(&mut sketch);

        let radius = sketch.entities.iter().find_map(|entity| match entity {
            Entity::Circle { radius, .. } => Some(*radius),
            _ => None,
        });
        assert_eq!(radius, Some(7.0));
    }

    #[test]
    fn equal_length_follows_explicit_length_dimension() {
        let mut sketch = Sketch {
            entities: vec![
                point("a1", 0.0, 0.0),
                point("a2", 10.0, 0.0),
                point("b1", 0.0, 10.0),
                point("b2", 30.0, 10.0),
                line("measured", "a1", "a2"),
                line("follower", "b1", "b2"),
            ],
            constraints: vec![
                Constraint::Length {
                    line: "measured".to_string(),
                    value: 90.0,
                },
                Constraint::EqualLength("measured".to_string(), "follower".to_string()),
            ],
        };

        Solver::new().solve(&mut sketch);

        let follower_start = sketch.point("b1").unwrap();
        let follower_end = sketch.point("b2").unwrap();
        let follower_length = (follower_end - follower_start).hypot();
        assert!((follower_length - 90.0).abs() < 1e-6);
    }

    #[test]
    fn dimension_tool_infers_line_length_for_single_line_selection() {
        let sketch = Sketch {
            entities: vec![
                point("p1", 0.0, 0.0),
                point("p2", 1.0, 0.0),
                line("l1", "p1", "p2"),
            ],
            constraints: vec![],
        };

        let target = infer_dimension_target(&sketch, &["l1".to_string()]).unwrap();

        assert!(matches!(target, DimensionTarget::LineLength { line } if line == "l1"));
    }
}
