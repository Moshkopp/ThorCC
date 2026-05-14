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
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

mod project;
use project::Project;
use thor_geom::Point;
use thor_geom::cam::{CamOperation, CamStrategy, Tool, generate_profile};
use thor_geom::chain::ToolpathPoint;
use thor_geom::post_processor::GCodeEmitter;
use thor_geom::sketcher::{Entity, Solver};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    AddObject { object: DrawObject },
    UpdatePoint { id: String, x: f64, y: f64 },
    ExportGCode,
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
    project: Mutex<Project>,
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        project: Mutex::new(Project::new("Default Project")),
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
    while let Some(msg) = socket.recv().await {
        if let Ok(Message::Text(text)) = msg {
            let parsed: Result<ClientMessage, _> = serde_json::from_str(&text);

            match parsed {
                Ok(ClientMessage::AddObject { object }) => {
                    let mut project = state.project.lock().await;
                    let label = object.label();
                    add_object_to_project(&mut project, object);
                    let response = serde_json::json!({
                        "type": "UpdateHistory",
                        "items": project_history(&project)
                    })
                    .to_string();
                    println!("Added {}", label);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::UpdatePoint { id, x, y }) => {
                    let mut project = state.project.lock().await;

                    for entity in project.sketch.entities.iter_mut() {
                        if let Entity::Point { id: p_id, pos } = entity {
                            if p_id == &id {
                                pos.x = x;
                                pos.y = y;
                                break;
                            }
                        }
                    }

                    let solver = Solver::new();
                    solver.solve(&mut project.sketch);

                    let response = serde_json::to_string(&project.sketch).unwrap();
                    drop(project);
                    let _ = socket.send(Message::Text(response)).await;
                }
                Ok(ClientMessage::ExportGCode) => {
                    let project = state.project.lock().await;
                    let tool = Tool { diameter: 6.0 };
                    let op = CamOperation {
                        id: "op1".to_string(),
                        strategy: CamStrategy::ProfileOutside,
                        tool_id: "t1".to_string(),
                        stepover: 0.5,
                        stepdown: 1.0,
                        target_depth: -5.0,
                    };

                    let contours = sketch_contours(&project);
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

fn project_history(project: &Project) -> Vec<String> {
    vec![format!(
        "{} entities in sketch",
        project.sketch.entities.len()
    )]
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
