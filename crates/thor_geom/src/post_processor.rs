use crate::chain::ToolpathPoint;
use std::fmt::Write;

pub struct GCodeEmitter {
    pub active_g: Option<u8>,
    pub active_f: Option<f64>,
    pub active_s: Option<f64>,
}

impl GCodeEmitter {
    pub fn new() -> Self {
        Self {
            active_g: None,
            active_f: None,
            active_s: None,
        }
    }

    pub fn emit(&mut self, points: &Vec<ToolpathPoint>) -> String {
        let mut output = String::new();

        // Header
        writeln!(output, "G21 (Metric)").unwrap();
        writeln!(output, "G90 (Absolute Distance Mode)").unwrap();

        for p in points {
            let mut line = String::new();

            // Modal Tracking for G-code type (0 for rapid, 1 for linear)
            let g = if p.feed > 0.0 { 1 } else { 0 };
            if self.active_g != Some(g) {
                write!(line, "G{} ", g).unwrap();
                self.active_g = Some(g);
            }

            // Coordinates
            write!(line, "X{:.4} Y{:.4} Z{:.4}", p.x, p.y, p.z).unwrap();

            // Modal Tracking for Feedrate
            if g == 1 && self.active_f != Some(p.feed) {
                write!(line, " F{:.0}", p.feed).unwrap();
                self.active_f = Some(p.feed);
            }

            writeln!(output, "{}", line).unwrap();
        }

        // Footer
        writeln!(output, "M2 (Program End)").unwrap();

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emitter_tracks_modal_g_and_feed() {
        let points = vec![
            ToolpathPoint {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                feed: 0.0,
            },
            ToolpathPoint {
                x: 1.0,
                y: 0.0,
                z: -1.0,
                feed: 1000.0,
            },
            ToolpathPoint {
                x: 2.0,
                y: 0.0,
                z: -1.0,
                feed: 1000.0,
            },
        ];

        let mut emitter = GCodeEmitter::new();
        let gcode = emitter.emit(&points);

        assert!(gcode.contains("G21 (Metric)"));
        assert!(gcode.contains("G0 X0.0000 Y0.0000 Z0.0000"));
        assert!(gcode.contains("G1 X1.0000 Y0.0000 Z-1.0000 F1000"));
        assert!(gcode.contains("X2.0000 Y0.0000 Z-1.0000"));
        assert!(gcode.ends_with("M2 (Program End)\n"));
    }
}
