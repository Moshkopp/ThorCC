use axum::{
    routing::get,
    Router,
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, State},
    response::IntoResponse,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::{
    trace::TraceLayer,
    cors::{CorsLayer, Any},
};
use rust_embed::RustEmbed;
use axum_embed::ServeEmbed;
use serde_json::Value;

mod project;
use project::Project;
use thor_geom::sketcher::{Solver, Entity};
use thor_geom::cam::{generate_profile, Tool, CamOperation, CamStrategy};
use thor_geom::post_processor::GCodeEmitter;
use thor_geom::chain::{ToolpathPoint};

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
            let v: Value = serde_json::from_str(&text).unwrap_or_default();
            
            match v["type"].as_str() {
                Some("AddObject") => {
                    let mut project = state.project.lock().await;
                    let response = serde_json::json!({
                        "type": "UpdateHistory",
                        "items": vec![format!("Added {:?}", v["object"]["type"])]
                    }).to_string();
                    let _ = socket.send(Message::Text(response)).await;
                }
                Some("UpdatePoint") => {
                    let id = v["id"].as_str().unwrap_or("");
                    let x = v["x"].as_f64().unwrap_or(0.0);
                    let y = v["y"].as_f64().unwrap_or(0.0);
                    
                    let mut project = state.project.lock().await;
                    
                    // Search through entities for the point
                    for entity in project.sketch.entities.iter_mut() {
                        if let Entity::Point { id: p_id, pos } = entity {
                            if p_id == id {
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
                Some("ExportGCode") => {
                    let tool = Tool { diameter: 6.0 };
                    let op = CamOperation {
                        id: "op1".to_string(),
                        strategy: CamStrategy::ProfileOutside,
                        tool_id: "t1".to_string(),
                        stepover: 0.5,
                        stepdown: 1.0,
                        target_depth: -5.0,
                    };
                    
                    let rect = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
                    let toolpath = generate_profile(&op, &tool, &rect);
                    
                    let mut points = Vec::new();
                    for segment in toolpath.segments {
                        for p in segment {
                            points.push(ToolpathPoint { x: p[0], y: p[1], z: p[2], feed: 1000.0 });
                        }
                    }
                    
                    let mut emitter = GCodeEmitter::new();
                    let gcode = emitter.emit(&points);
                    
                    let response = serde_json::json!({
                        "type": "GCode",
                        "content": gcode
                    }).to_string();
                    let _ = socket.send(Message::Text(response)).await;
                }
                _ => {}
            }
        } else {
            break;
        }
    }
}
