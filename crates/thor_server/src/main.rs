use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};
use axum_embed::ServeEmbed;
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

mod project;
use project::{DimensionAnnotation, Project};
use thor_geom::Point;
use thor_geom::cam::{CamOperation, CamStrategy, Tool, generate_profile};
use thor_geom::chain::ToolpathPoint;
use thor_geom::post_processor::GCodeEmitter;
use thor_geom::sketcher::{Constraint, DimensionTarget, Entity, Solver};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    AddObject {
        object: DrawObject,
    },
    AddConstraint {
        constraint: Constraint,
    },
    AddDimension {
        target: DimensionTarget,
        value: f64,
        offset: Option<[f64; 2]>,
    },
    UpdateDimensionOffset {
        index: usize,
        offset: [f64; 2],
    },
    UpdateDimensionValue {
        index: usize,
        value: f64,
    },
    DeleteSelection {
        entities: Vec<String>,
        dimensions: Vec<usize>,
    },
    SketchUndo,
    SketchRedo,
    UpdatePoint {
        id: String,
        x: f64,
        y: f64,
    },
    UpdatePoints {
        points: Vec<PointUpdate>,
    },
    ExportGCode,
}

#[derive(Debug, Deserialize)]
struct PointUpdate {
    id: String,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum DrawObject {
    Line {
        p1: [f64; 2],
        p2: [f64; 2],
    },
    Circle {
        center: [f64; 2],
        radius: f64,
    },
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
    #[serde(rename = "TRIANGLE")]
    Triangle {
        center: [f64; 2],
        radius: f64,
    },
    #[serde(rename = "HEXAGON")]
    Hexagon {
        center: [f64; 2],
        radius: f64,
    },
    #[serde(rename = "OCTAGON")]
    Octagon {
        center: [f64; 2],
        radius: f64,
    },
    #[serde(rename = "POLYLINE")]
    Polyline {
        points: Vec<[f64; 2]>,
    },
    #[serde(rename = "SPLINE")]
    Spline {
        points: Vec<[f64; 2]>,
    },
}

#[derive(RustEmbed, Clone)]
#[folder = "../../frontend/dist/"]
struct Assets;

struct AppState {
    project: Mutex<ProjectState>,
}

#[derive(Clone)]
struct SketchSnapshot {
    sketch: thor_geom::sketcher::Sketch,
    annotations: Vec<DimensionAnnotation>,
}

struct ProjectState {
    project: Project,
    sketch_undo: Vec<SketchSnapshot>,
    sketch_redo: Vec<SketchSnapshot>,
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        project: Mutex::new(ProjectState {
            project: Project::new("Default Project"),
            sketch_undo: Vec::new(),
            sketch_redo: Vec::new(),
        }),
    });

    let serve_assets = ServeEmbed::<Assets>::new();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(serve_assets)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("🚀 ThorCC Server running at http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    {
        let state = state.project.lock().await;
        let _ = socket
            .send(Message::Text(project_state_message(&state.project)))
            .await;
    }

    while let Some(msg) = socket.recv().await {
        if let Ok(Message::Text(text)) = msg {
            let parsed: Result<ClientMessage, _> = serde_json::from_str(&text);

            match parsed {
                Ok(ClientMessage::AddObject { object }) => {
                    let mut state = state.project.lock().await;
                    let label = object.label();
                    push_sketch_undo(&mut state);
                    add_object_to_project(&mut state.project, object);
                    let response = project_state_message(&state.project);
                    println!("Added {}", label);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::AddConstraint { constraint }) => {
                    let mut state = state.project.lock().await;
                    push_sketch_undo(&mut state);
                    state.project.sketch.constraints.push(constraint);
                    let solver = Solver::new();
                    solver.solve(&mut state.project.sketch);
                    let response = project_state_message(&state.project);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::AddDimension {
                    target,
                    value,
                    offset,
                }) => {
                    let mut state = state.project.lock().await;
                    let before = sketch_snapshot(&state.project);
                    let response = match state.project.sketch.add_dimension(target.clone(), value) {
                        Ok(()) => {
                            if let Some(offset) = offset {
                                state.project.annotations.push(DimensionAnnotation {
                                    target,
                                    value,
                                    offset,
                                });
                            }
                            commit_sketch_undo(&mut state, before);
                            let solver = Solver::new();
                            solver.solve(&mut state.project.sketch);
                            project_state_message(&state.project)
                        }
                        Err(err) => serde_json::json!({
                            "type": "Error",
                            "message": format!("Invalid dimension target: {:?}", err)
                        })
                        .to_string(),
                    };
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::UpdateDimensionOffset { index, offset }) => {
                    let mut state = state.project.lock().await;
                    let before = sketch_snapshot(&state.project);
                    let response = match state.project.annotations.get_mut(index) {
                        Some(annotation) => {
                            annotation.offset = offset;
                            commit_sketch_undo(&mut state, before);
                            project_state_message(&state.project)
                        }
                        None => serde_json::json!({
                            "type": "Error",
                            "message": format!("Invalid dimension annotation index: {}", index)
                        })
                        .to_string(),
                    };
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::UpdateDimensionValue { index, value }) => {
                    let mut state = state.project.lock().await;
                    let before = sketch_snapshot(&state.project);
                    let response = match update_dimension_value(&mut state.project, index, value) {
                        Ok(()) => {
                            commit_sketch_undo(&mut state, before);
                            let solver = Solver::new();
                            solver.solve(&mut state.project.sketch);
                            project_state_message(&state.project)
                        }
                        Err(message) => serde_json::json!({
                            "type": "Error",
                            "message": message,
                        })
                        .to_string(),
                    };
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::DeleteSelection {
                    entities,
                    dimensions,
                }) => {
                    let mut state = state.project.lock().await;
                    push_sketch_undo(&mut state);
                    delete_selection(&mut state.project, &entities, &dimensions);
                    let solver = Solver::new();
                    solver.solve(&mut state.project.sketch);
                    let response = project_state_message(&state.project);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::SketchUndo) => {
                    let mut state = state.project.lock().await;
                    let response = if sketch_undo(&mut state) {
                        project_state_message(&state.project)
                    } else {
                        serde_json::json!({
                            "type": "Error",
                            "message": "Sketch undo stack is empty"
                        })
                        .to_string()
                    };
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::SketchRedo) => {
                    let mut state = state.project.lock().await;
                    let response = if sketch_redo(&mut state) {
                        project_state_message(&state.project)
                    } else {
                        serde_json::json!({
                            "type": "Error",
                            "message": "Sketch redo stack is empty"
                        })
                        .to_string()
                    };
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::UpdatePoint { id, x, y }) => {
                    let mut state = state.project.lock().await;

                    push_sketch_undo(&mut state);
                    update_project_points(
                        &mut state.project,
                        vec![PointUpdate { id, x, y }],
                    );

                    let solver = Solver::new();
                    solver.solve(&mut state.project.sketch);

                    let response = project_state_message(&state.project);
                    drop(state);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::UpdatePoints { points }) => {
                    let mut state = state.project.lock().await;

                    push_sketch_undo(&mut state);
                    update_project_points(&mut state.project, points);

                    let solver = Solver::new();
                    solver.solve(&mut state.project.sketch);

                    let response = project_state_message(&state.project);
                    drop(state);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::ExportGCode) => {
                    let state = state.project.lock().await;
                    let tool = Tool { diameter: 6.0 };
                    let op = CamOperation {
                        id: "op1".to_string(),
                        strategy: CamStrategy::ProfileOutside,
                        tool_id: "t1".to_string(),
                        stepover: 0.5,
                        stepdown: 1.0,
                        target_depth: -5.0,
                    };

                    let contours = sketch_contours(&state.project);
                    let mut points = Vec::new();
                    for contour in contours {
                        let toolpath = generate_profile(&op, &tool, &contour);

                        for segment in toolpath.segments {
                            for p in segment {
                                points.push(ToolpathPoint {
                                    x: p[0],
                                    y: p[1],
                                    z: p[2],
                                    feed: 1000.0,
                                });
                            }
                        }
                    }

                    let mut emitter = GCodeEmitter::new();
                    let gcode = emitter.emit(&points);

                    let response = serde_json::json!({
                        "type": "GCode",
                        "content": gcode
                    })
                    .to_string();
                    let _ = socket.send(Message::Text(response)).await;
                }
                Err(err) => {
                    let response = serde_json::json!({
                        "type": "Error",
                        "message": format!("Invalid message: {}", err)
                    })
                    .to_string();
                    let _ = socket.send(Message::Text(response)).await;
                }
            }
        } else {
            break;
        }
    }
}

fn sketch_snapshot(project: &Project) -> SketchSnapshot {
    SketchSnapshot {
        sketch: project.sketch.clone(),
        annotations: project.annotations.clone(),
    }
}

fn restore_sketch_snapshot(project: &mut Project, snapshot: SketchSnapshot) {
    project.sketch = snapshot.sketch;
    project.annotations = snapshot.annotations;
}

fn commit_sketch_undo(state: &mut ProjectState, snapshot: SketchSnapshot) {
    state.sketch_undo.push(snapshot);
    if state.sketch_undo.len() > 100 {
        state.sketch_undo.remove(0);
    }
    state.sketch_redo.clear();
}

fn push_sketch_undo(state: &mut ProjectState) {
    let snapshot = sketch_snapshot(&state.project);
    commit_sketch_undo(state, snapshot);
}

fn sketch_undo(state: &mut ProjectState) -> bool {
    let Some(previous) = state.sketch_undo.pop() else {
        return false;
    };
    let current = sketch_snapshot(&state.project);
    state.sketch_redo.push(current);
    restore_sketch_snapshot(&mut state.project, previous);
    true
}

fn sketch_redo(state: &mut ProjectState) -> bool {
    let Some(next) = state.sketch_redo.pop() else {
        return false;
    };
    let current = sketch_snapshot(&state.project);
    state.sketch_undo.push(current);
    restore_sketch_snapshot(&mut state.project, next);
    true
}

fn update_dimension_value(project: &mut Project, index: usize, value: f64) -> Result<(), String> {
    let Some(annotation) = project.annotations.get_mut(index) else {
        return Err(format!("Invalid dimension annotation index: {index}"));
    };

    let target = annotation.target.clone();
    let old_value = annotation.value;
    annotation.value = value;

    if let Some(constraint) = project
        .sketch
        .constraints
        .iter_mut()
        .find(|constraint| dimension_constraint_matches(constraint, &target, old_value))
    {
        set_dimension_constraint_value(constraint, value);
    } else if let Ok(constraint) = project.sketch.dimension_constraint(target, value) {
        project.sketch.constraints.push(constraint);
    }

    Ok(())
}

fn delete_selection(project: &mut Project, entities: &[String], dimensions: &[usize]) {
    let mut dimensions_to_delete: HashSet<usize> = dimensions.iter().copied().collect();
    let entity_ids: HashSet<String> = entities.iter().cloned().collect();
    let point_ids = points_for_entities(&project.sketch.entities, &entity_ids);

    for (index, annotation) in project.annotations.iter().enumerate() {
        let target_points = dimension_point_ids(&project.sketch.entities, &annotation.target);
        if target_entity_ids(&annotation.target)
            .iter()
            .any(|id| entity_ids.contains(id))
            || target_points.iter().any(|id| point_ids.contains(id))
        {
            dimensions_to_delete.insert(index);
        }
    }

    for index in dimensions_to_delete.iter().copied() {
        if let Some(annotation) = project.annotations.get(index) {
            let target = annotation.target.clone();
            let value = annotation.value;
            project
                .sketch
                .constraints
                .retain(|constraint| !dimension_constraint_matches(constraint, &target, value));
        }
    }

    project.annotations = project
        .annotations
        .iter()
        .cloned()
        .enumerate()
        .filter_map(|(index, annotation)| (!dimensions_to_delete.contains(&index)).then_some(annotation))
        .collect();

    project.sketch.constraints.retain(|constraint| {
        !constraint_references_entities(constraint, &entity_ids)
            && !constraint_references_points(constraint, &point_ids)
    });

    project.sketch.entities.retain(|entity| match entity {
        Entity::Line { id, .. } | Entity::Circle { id, .. } | Entity::Arc { id, .. } => {
            !entity_ids.contains(id)
        }
        Entity::Point { id, .. } => !point_ids.contains(id),
    });
}

fn update_project_points(project: &mut Project, updates: Vec<PointUpdate>) {
    let mut deltas = HashMap::new();

    for update in &updates {
        if let Some(current) = find_point(project, &update.id) {
            deltas.insert(
                update.id.clone(),
                [update.x - current.x, update.y - current.y],
            );
        }
    }

    for update in updates {
        for entity in project.sketch.entities.iter_mut() {
            if let Entity::Point { id, pos } = entity {
                if id == &update.id {
                    pos.x = update.x;
                    pos.y = update.y;
                    break;
                }
            }
        }
    }

    shift_dimension_annotations(project, &deltas);
}

fn shift_dimension_annotations(
    project: &mut Project,
    deltas: &std::collections::HashMap<String, [f64; 2]>,
) {
    if deltas.is_empty() {
        return;
    }

    let entities = project.sketch.entities.clone();
    for annotation in &mut project.annotations {
        let point_ids = dimension_point_ids(&entities, &annotation.target);
        let shifted: Vec<[f64; 2]> = point_ids
            .iter()
            .filter_map(|id| deltas.get(id).copied())
            .collect();

        if shifted.is_empty() {
            continue;
        }

        let count = shifted.len() as f64;
        annotation.offset[0] += shifted.iter().map(|delta| delta[0]).sum::<f64>() / count;
        annotation.offset[1] += shifted.iter().map(|delta| delta[1]).sum::<f64>() / count;
    }
}

fn dimension_point_ids(entities: &[Entity], target: &DimensionTarget) -> Vec<String> {
    match target {
        DimensionTarget::HorizontalDistance { first, second }
        | DimensionTarget::VerticalDistance { first, second } => {
            let mut ids = vec![first.clone()];
            if let Some(second) = second {
                ids.push(second.clone());
            }
            ids
        }
        DimensionTarget::PointDistance { first, second } => vec![first.clone(), second.clone()],
        DimensionTarget::LineLength { line } | DimensionTarget::LineAngle { line } => {
            line_points(entities, line)
        }
        DimensionTarget::CircleRadius { circle } | DimensionTarget::CircleDiameter { circle } => {
            circle_points(entities, circle)
        }
        DimensionTarget::LineToLineAngle { first, second } => {
            let mut ids = line_points(entities, first);
            ids.extend(line_points(entities, second));
            ids
        }
    }
}

fn line_points(entities: &[Entity], line_id: &str) -> Vec<String> {
    entities
        .iter()
        .find_map(|entity| match entity {
            Entity::Line { id, p1, p2 } if id == line_id => Some(vec![p1.clone(), p2.clone()]),
            _ => None,
        })
        .unwrap_or_default()
}

fn circle_points(entities: &[Entity], circle_id: &str) -> Vec<String> {
    entities
        .iter()
        .find_map(|entity| match entity {
            Entity::Circle { id, center, .. } if id == circle_id => Some(vec![center.clone()]),
            _ => None,
        })
        .unwrap_or_default()
}

fn points_for_entities(entities: &[Entity], entity_ids: &HashSet<String>) -> HashSet<String> {
    let mut points = HashSet::new();
    for entity in entities {
        match entity {
            Entity::Line { id, p1, p2 } if entity_ids.contains(id) => {
                points.insert(p1.clone());
                points.insert(p2.clone());
            }
            Entity::Circle { id, center, .. } if entity_ids.contains(id) => {
                points.insert(center.clone());
            }
            Entity::Arc {
                id,
                center,
                start,
                end,
            } if entity_ids.contains(id) => {
                points.insert(center.clone());
                points.insert(start.clone());
                points.insert(end.clone());
            }
            _ => {}
        }
    }
    points
}

fn target_entity_ids(target: &DimensionTarget) -> Vec<String> {
    match target {
        DimensionTarget::LineLength { line } | DimensionTarget::LineAngle { line } => {
            vec![line.clone()]
        }
        DimensionTarget::CircleRadius { circle } | DimensionTarget::CircleDiameter { circle } => {
            vec![circle.clone()]
        }
        DimensionTarget::LineToLineAngle { first, second } => vec![first.clone(), second.clone()],
        DimensionTarget::HorizontalDistance { .. }
        | DimensionTarget::VerticalDistance { .. }
        | DimensionTarget::PointDistance { .. } => Vec::new(),
    }
}

fn constraint_references_entities(constraint: &Constraint, entity_ids: &HashSet<String>) -> bool {
    match constraint {
        Constraint::Horizontal(line)
        | Constraint::Vertical(line)
        | Constraint::Length { line, .. }
        | Constraint::LineAngle { line, .. } => entity_ids.contains(line),
        Constraint::Parallel(first, second)
        | Constraint::Perpendicular(first, second)
        | Constraint::EqualLength(first, second)
        | Constraint::Angle(first, second, _) => {
            entity_ids.contains(first) || entity_ids.contains(second)
        }
        Constraint::Radius { circle, .. } | Constraint::Diameter { circle, .. } => {
            entity_ids.contains(circle)
        }
        Constraint::Coincident(_, _)
        | Constraint::Distance(_, _, _)
        | Constraint::DistanceX { .. }
        | Constraint::DistanceY { .. } => false,
    }
}

fn constraint_references_points(constraint: &Constraint, point_ids: &HashSet<String>) -> bool {
    match constraint {
        Constraint::Coincident(first, second) | Constraint::Distance(first, second, _) => {
            point_ids.contains(first) || point_ids.contains(second)
        }
        Constraint::DistanceX { first, second, .. }
        | Constraint::DistanceY { first, second, .. } => {
            point_ids.contains(first) || second.as_ref().is_some_and(|id| point_ids.contains(id))
        }
        Constraint::Horizontal(_)
        | Constraint::Vertical(_)
        | Constraint::Parallel(_, _)
        | Constraint::Perpendicular(_, _)
        | Constraint::EqualLength(_, _)
        | Constraint::Length { .. }
        | Constraint::Radius { .. }
        | Constraint::Diameter { .. }
        | Constraint::Angle(_, _, _)
        | Constraint::LineAngle { .. } => false,
    }
}

fn dimension_constraint_matches(
    constraint: &Constraint,
    target: &DimensionTarget,
    value: f64,
) -> bool {
    const EPSILON: f64 = 1e-6;
    match (constraint, target) {
        (
            Constraint::DistanceX {
                first,
                second,
                value: constraint_value,
            },
            DimensionTarget::HorizontalDistance {
                first: target_first,
                second: target_second,
            },
        )
        | (
            Constraint::DistanceY {
                first,
                second,
                value: constraint_value,
            },
            DimensionTarget::VerticalDistance {
                first: target_first,
                second: target_second,
            },
        ) => {
            first == target_first
                && second == target_second
                && (*constraint_value - value).abs() <= EPSILON
        }
        (Constraint::Distance(first, second, constraint_value), DimensionTarget::PointDistance {
            first: target_first,
            second: target_second,
        }) => {
            first == target_first
                && second == target_second
                && (*constraint_value - value).abs() <= EPSILON
        }
        (Constraint::Length { line, value: constraint_value }, DimensionTarget::LineLength {
            line: target_line,
        }) => line == target_line && (*constraint_value - value).abs() <= EPSILON,
        (
            Constraint::Radius {
                circle,
                value: constraint_value,
            },
            DimensionTarget::CircleRadius {
                circle: target_circle,
            },
        )
        | (
            Constraint::Diameter {
                circle,
                value: constraint_value,
            },
            DimensionTarget::CircleDiameter {
                circle: target_circle,
            },
        ) => circle == target_circle && (*constraint_value - value).abs() <= EPSILON,
        (
            Constraint::LineAngle {
                line,
                value: constraint_value,
            },
            DimensionTarget::LineAngle { line: target_line },
        ) => line == target_line && (*constraint_value - value).abs() <= EPSILON,
        (
            Constraint::Angle(first, second, constraint_value),
            DimensionTarget::LineToLineAngle {
                first: target_first,
                second: target_second,
            },
        ) => {
            first == target_first
                && second == target_second
                && (*constraint_value - value).abs() <= EPSILON
        }
        _ => false,
    }
}

fn set_dimension_constraint_value(constraint: &mut Constraint, value: f64) {
    match constraint {
        Constraint::Distance(_, _, constraint_value)
        | Constraint::DistanceX {
            value: constraint_value,
            ..
        }
        | Constraint::DistanceY {
            value: constraint_value,
            ..
        }
        | Constraint::Length {
            value: constraint_value,
            ..
        }
        | Constraint::Radius {
            value: constraint_value,
            ..
        }
        | Constraint::Diameter {
            value: constraint_value,
            ..
        }
        | Constraint::Angle(_, _, constraint_value)
        | Constraint::LineAngle {
            value: constraint_value,
            ..
        } => *constraint_value = value,
        Constraint::Horizontal(_)
        | Constraint::Vertical(_)
        | Constraint::Parallel(_, _)
        | Constraint::Perpendicular(_, _)
        | Constraint::EqualLength(_, _)
        | Constraint::Coincident(_, _) => {}
    }
}

fn project_state_message(project: &Project) -> String {
    serde_json::json!({
        "type": "Sketch",
        "sketch": project.sketch,
        "annotations": project.annotations,
    })
    .to_string()
}

impl DrawObject {
    fn label(&self) -> &'static str {
        match self {
            DrawObject::Line { .. } => "Line",
            DrawObject::Circle { .. } => "Circle",
            DrawObject::Rect { .. } => "Rect",
            DrawObject::Triangle { .. } => "Triangle",
            DrawObject::Hexagon { .. } => "Hexagon",
            DrawObject::Octagon { .. } => "Octagon",
            DrawObject::Polyline { .. } => "Polyline",
            DrawObject::Spline { .. } => "Spline",
        }
    }
}

fn add_object_to_project(project: &mut Project, object: DrawObject) {
    let object_index = project.sketch.entities.len();

    match object {
        DrawObject::Line { p1, p2 } => {
            let p1_id = add_point(project, object_index, 0, p1);
            let p2_id = add_point(project, object_index, 1, p2);
            project.sketch.entities.push(Entity::Line {
                id: format!("line_{}", object_index),
                p1: p1_id,
                p2: p2_id,
            });
        }
        DrawObject::Circle { center, radius } => {
            let center_id = add_point(project, object_index, 0, center);
            project.sketch.entities.push(Entity::Circle {
                id: format!("circle_{}", object_index),
                center: center_id,
                radius,
            });
        }
        DrawObject::Rect { x, y, w, h } => {
            add_polyline(
                project,
                object_index,
                "rect",
                &[[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
                true,
            );
        }
        DrawObject::Triangle { center, radius } => {
            add_regular_polygon(project, object_index, "triangle", center, radius, 3)
        }
        DrawObject::Hexagon { center, radius } => {
            add_regular_polygon(project, object_index, "hexagon", center, radius, 6)
        }
        DrawObject::Octagon { center, radius } => {
            add_regular_polygon(project, object_index, "octagon", center, radius, 8)
        }
        DrawObject::Polyline { points } => {
            add_polyline(project, object_index, "polyline", &points, false)
        }
        DrawObject::Spline { points } => {
            add_polyline(project, object_index, "spline", &points, false)
        }
    }
}

fn add_regular_polygon(
    project: &mut Project,
    object_index: usize,
    prefix: &str,
    center: [f64; 2],
    radius: f64,
    sides: usize,
) {
    let points: Vec<[f64; 2]> = (0..sides)
        .map(|i| {
            let angle = std::f64::consts::TAU * i as f64 / sides as f64;
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ]
        })
        .collect();
    add_polyline(project, object_index, prefix, &points, true);
}

fn add_polyline(
    project: &mut Project,
    object_index: usize,
    prefix: &str,
    points: &[[f64; 2]],
    close: bool,
) {
    if points.len() < 2 {
        return;
    }

    let point_ids: Vec<String> = points
        .iter()
        .enumerate()
        .map(|(idx, point)| add_point(project, object_index, idx, *point))
        .collect();

    for idx in 0..point_ids.len() - 1 {
        project.sketch.entities.push(Entity::Line {
            id: format!("{}_{}_{}", prefix, object_index, idx),
            p1: point_ids[idx].clone(),
            p2: point_ids[idx + 1].clone(),
        });
    }

    if close && point_ids.len() > 2 {
        project.sketch.entities.push(Entity::Line {
            id: format!("{}_{}_close", prefix, object_index),
            p1: point_ids[point_ids.len() - 1].clone(),
            p2: point_ids[0].clone(),
        });
    }
}

fn add_point(
    project: &mut Project,
    object_index: usize,
    point_index: usize,
    coords: [f64; 2],
) -> String {
    let id = format!("p{}_{}", object_index, point_index);
    project.sketch.entities.push(Entity::Point {
        id: id.clone(),
        pos: Point::new(coords[0], coords[1]),
    });
    id
}

fn sketch_contours(project: &Project) -> Vec<Vec<[f64; 2]>> {
    let mut contours = Vec::new();

    for entity in &project.sketch.entities {
        match entity {
            Entity::Circle { center, radius, .. } => {
                if let Some(point) = find_point(project, center) {
                    contours.push(circle_contour(point, *radius, 64));
                }
            }
            Entity::Line { .. } => {}
            Entity::Point { .. } | Entity::Arc { .. } => {}
        }
    }

    contours.extend(line_contours(project));
    contours
}

fn line_contours(project: &Project) -> Vec<Vec<[f64; 2]>> {
    let mut unused_lines: Vec<(&String, &String)> = project
        .sketch
        .entities
        .iter()
        .filter_map(|entity| match entity {
            Entity::Line { p1, p2, .. } => Some((p1, p2)),
            _ => None,
        })
        .collect();
    let mut contours = Vec::new();

    while let Some((start, end)) = unused_lines.pop() {
        let start_id = start.clone();
        let mut current_id = end.clone();
        let mut contour = match (
            find_point(project, &start_id),
            find_point(project, &current_id),
        ) {
            (Some(start_point), Some(end_point)) => {
                vec![[start_point.x, start_point.y], [end_point.x, end_point.y]]
            }
            _ => continue,
        };

        while current_id != start_id {
            let Some(index) = unused_lines
                .iter()
                .position(|(p1, p2)| *p1 == &current_id || *p2 == &current_id)
            else {
                contour.clear();
                break;
            };
            let (p1, p2) = unused_lines.remove(index);
            current_id = if p1 == &current_id {
                p2.clone()
            } else {
                p1.clone()
            };

            if let Some(point) = find_point(project, &current_id) {
                contour.push([point.x, point.y]);
            } else {
                contour.clear();
                break;
            }
        }

        if contour.len() > 3 {
            contour.pop();
            contours.push(contour);
        }
    }

    contours
}

fn find_point<'a>(project: &'a Project, id: &str) -> Option<&'a Point> {
    project
        .sketch
        .entities
        .iter()
        .find_map(|entity| match entity {
            Entity::Point { id: point_id, pos } if point_id == id => Some(pos),
            _ => None,
        })
}

fn circle_contour(center: &Point, radius: f64, segments: usize) -> Vec<[f64; 2]> {
    (0..segments)
        .map(|i| {
            let angle = std::f64::consts::TAU * i as f64 / segments as f64;
            [
                center.x + radius * angle.cos(),
                center.y + radius * angle.sin(),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sketch_undo_and_redo_restore_only_sketch_snapshot() {
        let mut state = ProjectState {
            project: Project::new("test"),
            sketch_undo: Vec::new(),
            sketch_redo: Vec::new(),
        };

        push_sketch_undo(&mut state);
        add_object_to_project(
            &mut state.project,
            DrawObject::Line {
                p1: [0.0, 0.0],
                p2: [10.0, 0.0],
            },
        );

        assert_eq!(state.project.sketch.entities.len(), 3);
        assert!(sketch_undo(&mut state));
        assert_eq!(state.project.sketch.entities.len(), 0);
        assert!(sketch_redo(&mut state));
        assert_eq!(state.project.sketch.entities.len(), 3);
    }

    #[test]
    fn add_rect_creates_closed_line_contour() {
        let mut project = Project::new("test");

        add_object_to_project(
            &mut project,
            DrawObject::Rect {
                x: 0.0,
                y: 0.0,
                w: 20.0,
                h: 10.0,
            },
        );

        assert_eq!(project.sketch.entities.len(), 8);

        let contours = sketch_contours(&project);
        assert_eq!(contours.len(), 1);
        assert_eq!(contours[0].len(), 4);
    }

    #[test]
    fn add_circle_creates_circle_contour_for_cam() {
        let mut project = Project::new("test");

        add_object_to_project(
            &mut project,
            DrawObject::Circle {
                center: [5.0, 6.0],
                radius: 10.0,
            },
        );

        let contours = sketch_contours(&project);
        assert_eq!(contours.len(), 1);
        assert_eq!(contours[0].len(), 64);
        assert_eq!(contours[0][0], [15.0, 6.0]);
    }

    #[test]
    fn open_polyline_is_not_exported_as_closed_contour() {
        let mut project = Project::new("test");

        add_object_to_project(
            &mut project,
            DrawObject::Polyline {
                points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]],
            },
        );

        assert!(sketch_contours(&project).is_empty());
    }
}
