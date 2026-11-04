//! Voice filter boundary. Alternative circuit models can implement this same sample API.
use crate::ladder::Ladder;
pub struct Filter {
    ladder: Ladder,
    dc_input: f32,
    dc_output: f32,
}
impl Default for Filter {
    fn default() -> Self {
        Self::new()
    }
}

impl Filter {
    pub fn new() -> Self {
        Self {
            ladder: Ladder::new(),
            dc_input: 0.0,
            dc_output: 0.0,
        }
    }
    pub fn tick(&mut self, input: f32, cutoff: f32, resonance: f32, drive: f32, rate: f32) -> f32 {
        let g = (std::f32::consts::PI * cutoff.min(rate * 0.225) / rate).tan();
        let y = self.ladder.tick(input, g, resonance, drive) * (1.0 + resonance * 0.35);
        let dc = y - self.dc_input + (1.0 - 125.66 / rate) * self.dc_output;
        self.dc_input = y;
        self.dc_output = dc;
        dc
    }
}
